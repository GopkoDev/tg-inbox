import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { insertContact, insertReach } from '../../../test/fixtures/contacts.js';
import { insertWorkspace, twoWorkspaces } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createReachRepo } from './reach-repo.js';

const BOT = 9101n;
const OTHER_BOT = 9102n;
const T0 = new Date('2026-10-20T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe('contact reach repository (ADR-0002)', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: ReturnType<typeof createReachRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url, { max: 6 });
    repo = createReachRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const reachOf = async (workspaceId: string, contactId: string, telegramBotId = BOT) =>
    (await db
      .selectFrom('contact_bot_reach')
      .select(['wrote_at', 'blocked_at', 'changed_at'])
      .where('workspace_id', '=', workspaceId)
      .where('contact_id', '=', contactId)
      .where('telegram_bot_id', '=', String(telegramBotId))
      .executeTakeFirst()) ?? null;

  const contactIn = async (workspaceId?: string) => {
    const ws = workspaceId ?? (await insertWorkspace(db));
    return { ws, contactId: await insertContact(db, { workspaceId: ws }) };
  };

  const inTx = <T>(fn: (tx: Db) => Promise<T>) =>
    db.transaction().execute((tx) => fn(tx as unknown as Db));

  describe('upsertWrote (capture)', () => {
    it('a first message writes wrote_at = changed_at and clears nothing', async () => {
      const { ws, contactId } = await contactIn();
      expect(await inTx((tx) => repo.upsertWrote(ws, contactId, BOT, at(10), tx))).toBe(false);
      expect(await reachOf(ws, contactId)).toEqual({
        wrote_at: at(10),
        blocked_at: null,
        changed_at: at(10),
      });
    });

    it('keeps the earliest wrote_at and moves changed_at only for a newer message', async () => {
      const { ws, contactId } = await contactIn();
      await inTx((tx) => repo.upsertWrote(ws, contactId, BOT, at(10), tx));
      await inTx((tx) => repo.upsertWrote(ws, contactId, BOT, at(30), tx));
      expect(await reachOf(ws, contactId)).toMatchObject({ wrote_at: at(10), changed_at: at(30) });
      // An older message delivered late lowers wrote_at but leaves changed_at.
      await inTx((tx) => repo.upsertWrote(ws, contactId, BOT, at(5), tx));
      expect(await reachOf(ws, contactId)).toMatchObject({ wrote_at: at(5), changed_at: at(30) });
    });

    it('a newer message clears an older block and reports it', async () => {
      const { ws, contactId } = await contactIn();
      await insertReach(db, {
        workspaceId: ws,
        contactId,
        telegramBotId: BOT,
        wroteAt: at(1),
        blockedAt: at(20),
      });
      expect(await inTx((tx) => repo.upsertWrote(ws, contactId, BOT, at(25), tx))).toBe(true);
      expect(await reachOf(ws, contactId)).toEqual({
        wrote_at: at(1),
        blocked_at: null,
        changed_at: at(25),
      });
    });

    it('an older message does not clear a newer block', async () => {
      const { ws, contactId } = await contactIn();
      await insertReach(db, { workspaceId: ws, contactId, telegramBotId: BOT, blockedAt: at(20) });
      expect(await inTx((tx) => repo.upsertWrote(ws, contactId, BOT, at(15), tx))).toBe(false);
      expect(await reachOf(ws, contactId)).toEqual({
        wrote_at: at(15),
        blocked_at: at(20),
        changed_at: at(20),
      });
    });

    it('a second Telegram bot id gets its own row; the first one stays (AC-10)', async () => {
      const { ws, contactId } = await contactIn();
      await insertReach(db, { workspaceId: ws, contactId, telegramBotId: BOT, blockedAt: at(20) });
      expect(await inTx((tx) => repo.upsertWrote(ws, contactId, OTHER_BOT, at(30), tx))).toBe(
        false,
      );
      expect(await reachOf(ws, contactId, OTHER_BOT)).toEqual({
        wrote_at: at(30),
        blocked_at: null,
        changed_at: at(30),
      });
      expect(await reachOf(ws, contactId, BOT)).toMatchObject({ blocked_at: at(20) });
    });
  });

  describe('applyBlockChange (bots)', () => {
    it('blocks a contact with no row, then an equal-time repeat changes nothing', async () => {
      const { ws, contactId } = await contactIn();
      expect(await inTx((tx) => repo.applyBlockChange(ws, contactId, BOT, true, at(10), tx))).toBe(
        true,
      );
      expect(await reachOf(ws, contactId)).toEqual({
        wrote_at: null,
        blocked_at: at(10),
        changed_at: at(10),
      });
      expect(await inTx((tx) => repo.applyBlockChange(ws, contactId, BOT, true, at(12), tx))).toBe(
        false,
      );
      // Already blocked: "since when" stays the first block.
      expect(await reachOf(ws, contactId)).toEqual({
        wrote_at: null,
        blocked_at: at(10),
        changed_at: at(12),
      });
    });

    it('unblocks only when not older than changed_at', async () => {
      const { ws, contactId } = await contactIn();
      await insertReach(db, {
        workspaceId: ws,
        contactId,
        telegramBotId: BOT,
        wroteAt: at(1),
        blockedAt: at(20),
      });
      expect(await inTx((tx) => repo.applyBlockChange(ws, contactId, BOT, false, at(19), tx))).toBe(
        false,
      );
      expect(await reachOf(ws, contactId)).toMatchObject({
        blocked_at: at(20),
        changed_at: at(20),
      });
      expect(await inTx((tx) => repo.applyBlockChange(ws, contactId, BOT, false, at(20), tx))).toBe(
        true,
      );
      expect(await reachOf(ws, contactId)).toEqual({
        wrote_at: at(1),
        blocked_at: null,
        changed_at: at(20),
      });
    });

    it('a block older than the last message is ignored', async () => {
      const { ws, contactId } = await contactIn();
      await insertReach(db, { workspaceId: ws, contactId, telegramBotId: BOT, wroteAt: at(30) });
      expect(await inTx((tx) => repo.applyBlockChange(ws, contactId, BOT, true, at(29), tx))).toBe(
        false,
      );
      expect(await reachOf(ws, contactId)).toEqual({
        wrote_at: at(30),
        blocked_at: null,
        changed_at: at(30),
      });
    });

    it('an unblock of a contact not blocked writes the time but reports no change', async () => {
      const { ws, contactId } = await contactIn();
      expect(await inTx((tx) => repo.applyBlockChange(ws, contactId, BOT, false, at(40), tx))).toBe(
        false,
      );
      expect(await reachOf(ws, contactId)).toEqual({
        wrote_at: null,
        blocked_at: null,
        changed_at: at(40),
      });
      // So a block notice older than that unblock cannot flip the mark back.
      expect(await inTx((tx) => repo.applyBlockChange(ws, contactId, BOT, true, at(35), tx))).toBe(
        false,
      );
      expect(await reachOf(ws, contactId)).toMatchObject({ blocked_at: null });
    });

    it('two concurrent blocks of one contact report one change', async () => {
      const { ws, contactId } = await contactIn();
      const results = await Promise.all([
        inTx((tx) => repo.applyBlockChange(ws, contactId, BOT, true, at(10), tx)),
        inTx((tx) => repo.applyBlockChange(ws, contactId, BOT, true, at(10), tx)),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await reachOf(ws, contactId)).toMatchObject({ blocked_at: at(10) });
    });
  });

  it('scopes every write by workspace: a contact id of another workspace writes nothing', async () => {
    const { a, b } = await twoWorkspaces(db);
    const inA = await insertContact(db, { workspaceId: a });
    const inB = await insertContact(db, { workspaceId: b });
    await insertReach(db, { workspaceId: b, contactId: inB, telegramBotId: BOT, wroteAt: at(1) });

    // The contact of B named from A: the composite FK refuses, nothing of B changes.
    await expect(inTx((tx) => repo.upsertWrote(a, inB, BOT, at(5), tx))).rejects.toThrow();
    await expect(
      inTx((tx) => repo.applyBlockChange(a, inB, BOT, true, at(5), tx)),
    ).rejects.toThrow();
    expect(await reachOf(b, inB)).toEqual({ wrote_at: at(1), blocked_at: null, changed_at: at(1) });
    expect(await reachOf(a, inB)).toBeNull();

    // A's own writes never touch B's rows for the same Telegram bot.
    await inTx((tx) => repo.applyBlockChange(a, inA, BOT, true, at(9), tx));
    expect(await reachOf(a, inA)).toMatchObject({ blocked_at: at(9) });
    expect(await reachOf(b, inB)).toMatchObject({ blocked_at: null });
  });
});
