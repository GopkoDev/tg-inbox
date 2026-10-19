import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { hashToken } from '../../../platform/tokens.js';
import {
  insertConnectLink,
  insertTelegramLink,
  twoWorkspacesWithLinks,
} from '../../../test/fixtures/notifications.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createConnectLinkRepo } from './connect-link-repo.js';
import { createTelegramLinkRepo } from './telegram-link-repo.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

describe('notifications link repositories (Postgres)', () => {
  let database: TestDatabase;
  let db: Db;
  let links: ReturnType<typeof createTelegramLinkRepo>;
  let connects: ReturnType<typeof createConnectLinkRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url, { max: 10 });
    links = createTelegramLinkRepo(db);
    connects = createConnectLinkRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const raw = (id: string) =>
    db.selectFrom('telegram_links').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  describe('telegramLinkRepo', () => {
    it('findLiveByAccount and findLiveByTelegramUser return each workspace its own link', async () => {
      const { accountId, telegramUserId, a, b } = await twoWorkspacesWithLinks(db);
      expect((await links.findLiveByAccount(a.workspaceId, accountId))?.id).toBe(a.linkId);
      expect((await links.findLiveByAccount(b.workspaceId, accountId))?.id).toBe(b.linkId);
      expect((await links.findLiveByTelegramUser(a.workspaceId, telegramUserId))?.id).toBe(
        a.linkId,
      );
      expect((await links.findLiveByTelegramUser(b.workspaceId, telegramUserId))?.id).toBe(
        b.linkId,
      );
      const other = await insertWorkspace(db);
      expect(await links.findLiveByAccount(other, accountId)).toBeNull();
      expect(await links.findLiveByTelegramUser(other, telegramUserId)).toBeNull();
    });

    it('findLiveByAccount returns the record, never a removed link, and can lock the row', async () => {
      const w = await insertWorkspace(db);
      const { accountId } = await insertMembership(db, w);
      const removed = await insertTelegramLink(db, {
        workspaceId: w,
        accountId,
        removed: { at: at(5), reason: 'deactivated' },
      });
      expect(await links.findLiveByAccount(w, accountId)).toBeNull();
      const live = await insertTelegramLink(db, {
        workspaceId: w,
        accountId,
        telegramBotId: 7002n,
        telegramUserId: 99001n,
        displayName: 'Test User',
        linkedAt: at(6),
      });
      expect(await links.findLiveByAccount(w, accountId)).toEqual({
        id: live.id,
        workspaceId: w,
        accountId,
        telegramBotId: 7002n,
        telegramUserId: 99001n,
        displayName: 'Test User',
        linkedAt: at(6),
        blockedAt: null,
        lastNoticeAt: null,
        removedAt: null,
        removedReason: null,
      });
      expect(removed.id).not.toBe(live.id);
      await db.transaction().execute(async (tx) => {
        expect((await links.findLiveByAccount(w, accountId, { lock: true }, tx))?.id).toBe(live.id);
      });
    });

    it('a lock waits for the other transaction that holds the live link', async () => {
      const { accountId, a } = await twoWorkspacesWithLinks(db);
      let releaseFirst!: () => void;
      const held = new Promise<void>((r) => (releaseFirst = r));
      const order: string[] = [];
      const first = db.transaction().execute(async (tx) => {
        await links.findLiveByAccount(a.workspaceId, accountId, { lock: true }, tx);
        order.push('first locked');
        await held;
        order.push('first done');
      });
      await new Promise((r) => setTimeout(r, 100));
      const second = db.transaction().execute(async (tx) => {
        await links.findLiveByAccount(a.workspaceId, accountId, { lock: true }, tx);
        order.push('second locked');
      });
      await new Promise((r) => setTimeout(r, 200));
      expect(order).toEqual(['first locked']);
      releaseFirst();
      await Promise.all([first, second]);
      expect(order).toEqual(['first locked', 'first done', 'second locked']);
    });

    it('findById is scoped by workspace', async () => {
      const { a, b } = await twoWorkspacesWithLinks(db);
      expect((await links.findById(a.workspaceId, a.linkId))?.id).toBe(a.linkId);
      expect(await links.findById(b.workspaceId, a.linkId)).toBeNull();
    });

    it('listLive returns only the workspace live links, not removed ones', async () => {
      const { a, b } = await twoWorkspacesWithLinks(db);
      const { accountId: second } = await insertMembership(db, a.workspaceId);
      await insertTelegramLink(db, {
        workspaceId: a.workspaceId,
        accountId: second,
        removed: { at: at(1), reason: 'member' },
        telegramUserId: 424242n,
      });
      expect((await links.listLive(a.workspaceId)).map((l) => l.id)).toEqual([a.linkId]);
      expect((await links.listLive(b.workspaceId)).map((l) => l.id)).toEqual([b.linkId]);
    });

    it('insert refuses a second live link for a member and a second member for one Telegram user, allows both in another workspace', async () => {
      const w = await insertWorkspace(db);
      const m1 = await insertMembership(db, w);
      const m2 = await insertMembership(db, w);
      const w2 = await insertWorkspace(db);
      await insertMembership(db, w2, { accountId: m1.accountId });
      const base = {
        telegramBotId: 7001n,
        displayName: 'Test User',
        linkedAt: at(0),
      };
      expect(
        await links.insert(w, {
          id: newId(),
          accountId: m1.accountId,
          telegramUserId: 31001n,
          ...base,
        }),
      ).toEqual({ ok: true });
      expect(
        await links.insert(w, {
          id: newId(),
          accountId: m1.accountId,
          telegramUserId: 31002n,
          ...base,
        }),
      ).toEqual({ ok: false, reason: 'account_linked' });
      expect(
        await links.insert(w, {
          id: newId(),
          accountId: m2.accountId,
          telegramUserId: 31001n,
          ...base,
        }),
      ).toEqual({ ok: false, reason: 'telegram_user_linked' });
      expect(
        await links.insert(w2, {
          id: newId(),
          accountId: m1.accountId,
          telegramUserId: 31001n,
          ...base,
        }),
      ).toEqual({ ok: true });
    });

    it('remove clears the name and, except for a member removal, the Telegram id; only a live link of the workspace', async () => {
      for (const reason of ['member', 'deactivated', 'bot_replaced'] as const) {
        const { a, b } = await twoWorkspacesWithLinks(db);
        expect(await links.remove(b.workspaceId, a.linkId, reason, at(3))).toBe(false);
        expect((await raw(a.linkId)).removed_at).toBeNull();
        expect(await links.remove(a.workspaceId, a.linkId, reason, at(3))).toBe(true);
        const row = await raw(a.linkId);
        expect(row).toMatchObject({
          removed_at: at(3),
          removed_reason: reason,
          display_name: null,
          telegram_user_id: reason === 'member' ? expect.any(String) : null,
        });
        expect(await links.remove(a.workspaceId, a.linkId, reason, at(4))).toBe(false);
        expect((await raw(b.linkId)).removed_at).toBeNull();
      }
    });

    it('markBlocked keeps the first block time; clearBlocked clears it; neither crosses workspaces', async () => {
      const { a, b } = await twoWorkspacesWithLinks(db);
      expect(await links.markBlocked(b.workspaceId, a.linkId, at(5))).toBe(false);
      expect((await raw(a.linkId)).blocked_at).toBeNull();
      expect(await links.markBlocked(a.workspaceId, a.linkId, at(5))).toBe(true);
      await links.markBlocked(a.workspaceId, a.linkId, at(9));
      expect((await raw(a.linkId)).blocked_at).toEqual(at(5));
      expect(await links.clearBlocked(b.workspaceId, a.linkId)).toBe(false);
      expect((await raw(a.linkId)).blocked_at).toEqual(at(5));
      expect(await links.clearBlocked(a.workspaceId, a.linkId)).toBe(true);
      expect((await raw(a.linkId)).blocked_at).toBeNull();
      expect((await raw(b.linkId)).blocked_at).toBeNull();
    });

    it('claimNotice has one winner per hour, even concurrently, and only in its own workspace', async () => {
      const { a, b } = await twoWorkspacesWithLinks(db);
      expect(await links.claimNotice(b.workspaceId, a.linkId, at(0))).toBe(false);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => links.claimNotice(a.workspaceId, a.linkId, at(0))),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await raw(a.linkId)).last_notice_at).toEqual(at(0));
      expect(await links.claimNotice(a.workspaceId, a.linkId, at(59))).toBe(false);
      expect(await links.claimNotice(a.workspaceId, a.linkId, at(61))).toBe(true);
      expect((await raw(b.linkId)).last_notice_at).toBeNull();
    });

    it('clearRemovedUserId clears a member-removed link only, in its own workspace', async () => {
      const { a, b } = await twoWorkspacesWithLinks(db);
      expect(await links.clearRemovedUserId(a.workspaceId, a.linkId)).toBe(false);
      await links.remove(a.workspaceId, a.linkId, 'member', at(1));
      expect(await links.clearRemovedUserId(b.workspaceId, a.linkId)).toBe(false);
      expect((await raw(a.linkId)).telegram_user_id).not.toBeNull();
      expect(await links.clearRemovedUserId(a.workspaceId, a.linkId)).toBe(true);
      expect((await raw(a.linkId)).telegram_user_id).toBeNull();
      expect((await raw(b.linkId)).telegram_user_id).not.toBeNull();
    });

    it('listLiveWithOtherBot returns the workspace live links of a different bot', async () => {
      const { a, b } = await twoWorkspacesWithLinks(db);
      expect((await links.listLiveWithOtherBot(a.workspaceId, 7001n)).map((l) => l.id)).toEqual([]);
      expect((await links.listLiveWithOtherBot(a.workspaceId, 8888n)).map((l) => l.id)).toEqual([
        a.linkId,
      ]);
      expect((await links.listLiveWithOtherBot(b.workspaceId, 8888n)).map((l) => l.id)).toEqual([
        b.linkId,
      ]);
    });

    it('workspacesWithLiveLink (the sixth exception) returns the workspace ids with a live link, nothing else', async () => {
      const { a, b } = await twoWorkspacesWithLinks(db);
      const w = await insertWorkspace(db);
      const { accountId } = await insertMembership(db, w);
      await insertTelegramLink(db, {
        workspaceId: w,
        accountId,
        removed: { at: at(1), reason: 'deactivated' },
      });
      const ids = await links.workspacesWithLiveLink();
      expect(ids).toEqual(expect.arrayContaining([a.workspaceId, b.workspaceId]));
      expect(ids).not.toContain(w);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(typeof id).toBe('string');
    });
  });

  describe('connectLinkRepo', () => {
    async function member() {
      const w = await insertWorkspace(db);
      const { accountId } = await insertMembership(db, w);
      const other = await insertWorkspace(db);
      await insertMembership(db, other, { accountId });
      return { w, accountId, other };
    }

    it('insert and findByHash round-trip; the hash is looked up only inside its workspace', async () => {
      const { w, accountId, other } = await member();
      const hash = hashToken('tok-1');
      const id = newId();
      await connects.insert(w, {
        id,
        accountId,
        tokenHash: hash,
        createdAt: at(0),
        expiresAt: at(10),
      });
      expect(await connects.findByHash(w, hash)).toEqual({
        id,
        workspaceId: w,
        accountId,
        createdAt: at(0),
        expiresAt: at(10),
        usedAt: null,
        replacedAt: null,
      });
      expect(await connects.findByHash(other, hash)).toBeNull();
      expect(await connects.findByHash(w, hashToken('nope'))).toBeNull();
    });

    it('lockById locks and returns the row of its workspace only', async () => {
      const { w, accountId, other } = await member();
      const link = await insertConnectLink(db, { workspaceId: w, accountId });
      await db.transaction().execute(async (tx) => {
        expect((await connects.lockById(w, link.id, tx))?.id).toBe(link.id);
        expect(await connects.lockById(other, link.id, tx)).toBeNull();
      });
    });

    it('countSince counts this member’s links in the window with the oldest, not other members, workspaces or older links', async () => {
      const { w, accountId, other } = await member();
      const { accountId: mate } = await insertMembership(db, w);
      await insertConnectLink(db, { workspaceId: w, accountId, createdAt: at(-30) });
      await insertConnectLink(db, { workspaceId: w, accountId, createdAt: at(-5) });
      await insertConnectLink(db, { workspaceId: w, accountId, createdAt: at(-2) });
      await insertConnectLink(db, { workspaceId: w, accountId: mate, createdAt: at(-1) });
      await insertConnectLink(db, { workspaceId: other, accountId, createdAt: at(-1) });
      await db.transaction().execute(async (tx) => {
        expect(await connects.countSince(w, accountId, at(-10), tx)).toEqual({
          count: 2,
          oldestCreatedAt: at(-5),
        });
        expect(await connects.countSince(w, accountId, at(1), tx)).toEqual({
          count: 0,
          oldestCreatedAt: null,
        });
      });
    });

    it('markUnusedReplaced replaces only this member’s unused links in the workspace', async () => {
      const { w, accountId, other } = await member();
      const { accountId: mate } = await insertMembership(db, w);
      const unused = await insertConnectLink(db, { workspaceId: w, accountId, createdAt: at(0) });
      const used = await insertConnectLink(db, {
        workspaceId: w,
        accountId,
        createdAt: at(0),
        usedAt: at(1),
      });
      const mates = await insertConnectLink(db, { workspaceId: w, accountId: mate });
      const foreign = await insertConnectLink(db, { workspaceId: other, accountId });
      const state = (id: string) =>
        db
          .selectFrom('connect_links')
          .select(['used_at', 'replaced_at'])
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
      expect(await connects.markUnusedReplaced(w, accountId, at(2))).toBe(1);
      expect((await state(unused.id)).replaced_at).toEqual(at(2));
      expect((await state(used.id)).replaced_at).toBeNull();
      expect((await state(mates.id)).replaced_at).toBeNull();
      expect((await state(foreign.id)).replaced_at).toBeNull();
      expect(await connects.markUnusedReplaced(w, accountId, at(3))).toBe(0);
    });

    it('markUsed uses a link once, never a replaced one, and only in its workspace', async () => {
      const { w, accountId, other } = await member();
      const link = await insertConnectLink(db, { workspaceId: w, accountId });
      const replaced = await insertConnectLink(db, {
        workspaceId: w,
        accountId,
        replacedAt: at(1),
      });
      expect(await connects.markUsed(other, link.id, at(2))).toBe(false);
      expect(await connects.markUsed(w, link.id, at(2))).toBe(true);
      expect(await connects.markUsed(w, link.id, at(3))).toBe(false);
      expect(await connects.markUsed(w, replaced.id, at(2))).toBe(false);
      const row = await db
        .selectFrom('connect_links')
        .select('used_at')
        .where('id', '=', link.id)
        .executeTakeFirstOrThrow();
      expect(row.used_at).toEqual(at(2));
    });

    it('lockIssuing serialises transactions of one member and lets another member through', async () => {
      const { w, accountId } = await member();
      const { accountId: mate } = await insertMembership(db, w);
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      const order: string[] = [];
      const first = db.transaction().execute(async (tx) => {
        await connects.lockIssuing(w, accountId, tx);
        order.push('first');
        await held;
      });
      await new Promise((r) => setTimeout(r, 100));
      const same = db.transaction().execute(async (tx) => {
        await connects.lockIssuing(w, accountId, tx);
        order.push('same member');
      });
      await db.transaction().execute(async (tx) => {
        await connects.lockIssuing(w, mate, tx);
        order.push('other member');
      });
      await new Promise((r) => setTimeout(r, 150));
      expect(order).toEqual(['first', 'other member']);
      release();
      await Promise.all([first, same]);
      expect(order).toEqual(['first', 'other member', 'same member']);
    });
  });
});
