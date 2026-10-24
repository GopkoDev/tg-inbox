import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { insertBot, testBotKey, twoWorkspacesWithBots } from '../../../test/fixtures/bots.js';
import { insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createBotRepo } from './bot-repo.js';
import { createTokenCipher } from './token-cipher.js';
import { createWebhookSecrets } from './webhook-secret.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
let nextBotId = 300000n;
const fakeToken = (id: bigint) => `${id}:TEST-${'r'.repeat(35)}`;

describe('bot repository', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: ReturnType<typeof createBotRepo>;
  const secrets = createWebhookSecrets(testBotKey.key);

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    repo = createBotRepo(db, createTokenCipher(testBotKey));
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  function newBot(telegramBotId = nextBotId++) {
    const id = newId();
    return {
      id,
      telegramBotId,
      name: 'Test Bot',
      username: `test_bot_${telegramBotId}`,
      state: 'connected' as const,
      token: fakeToken(telegramBotId),
      webhookSecret: secrets.secretFor(id, at(0)),
      connectedAt: at(0),
      lastCheckedAt: at(0),
      createdAt: at(0),
    };
  }

  const rawRow = (id: string) =>
    db.selectFrom('bots').selectAll().where('id', '=', id).executeTakeFirst();

  it('insert stores the token encrypted and the secret hashed, and findByWorkspace returns neither', async () => {
    const w = await insertWorkspace(db);
    const bot = newBot();
    expect(await repo.insert(w, bot)).toEqual({ ok: true });
    const found = await repo.findByWorkspace(w);
    expect(found).toEqual({
      id: bot.id,
      workspaceId: w,
      telegramBotId: bot.telegramBotId,
      name: 'Test Bot',
      username: bot.username,
      state: 'connected',
      connectedAt: at(0),
      lastCheckedAt: at(0),
      createdAt: at(0),
      sendPausedUntil: null,
      stoppedWorkingAt: null,
    });
    expect(
      JSON.stringify(found, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v)),
    ).not.toMatch(/TEST-|token|secret/i);
    const raw = await rawRow(bot.id);
    expect(raw?.token_encrypted?.includes(Buffer.from(bot.token))).toBe(false);
    expect(raw?.webhook_secret_hash).toHaveLength(32);
    expect(raw?.webhook_secret_hash?.includes(Buffer.from(bot.webhookSecret))).toBe(false);
  });

  it('insert of a bot bound to another workspace is bound_elsewhere and reads nothing of it (AC-04)', async () => {
    const { a, botA } = await twoWorkspacesWithBots(db);
    const bolt = await insertWorkspace(db);
    const before = await rawRow(botA.bot.id);
    const result = await repo.insert(bolt, newBot(botA.bot.telegramBotId));
    expect(result).toEqual({ ok: false, reason: 'bound_elsewhere' });
    expect(JSON.stringify(result)).not.toContain(a.workspaceId);
    expect(await rawRow(botA.bot.id)).toEqual(before);
    expect(await repo.findByWorkspace(bolt)).toBeNull();
  });

  it('two workspaces inserting the same bot concurrently: one ok, the other bound_elsewhere', async () => {
    const [w1, w2] = [await insertWorkspace(db), await insertWorkspace(db)];
    const telegramBotId = nextBotId++;
    const results = await Promise.all([
      repo.insert(w1, newBot(telegramBotId)),
      repo.insert(w2, newBot(telegramBotId)),
    ]);
    expect(results).toEqual(
      expect.arrayContaining([{ ok: true }, { ok: false, reason: 'bound_elsewhere' }]),
    );
  });

  it('a second bot for one workspace is refused by the unique constraint (AC-05 backstop)', async () => {
    const w = await insertWorkspace(db);
    await repo.insert(w, newBot());
    expect(await repo.insert(w, newBot())).toEqual({ ok: false, reason: 'workspace_has_bot' });
    expect(await db.selectFrom('bots').where('workspace_id', '=', w).execute()).toHaveLength(1);
  });

  it('pauseSends stores the pause, keeps the later of two, and findByWorkspace returns it', async () => {
    const w = await insertWorkspace(db);
    const { bot } = await insertBot(db, { workspaceId: w });
    expect((await repo.findByWorkspace(w))?.sendPausedUntil).toBeNull();
    expect(await repo.pauseSends(w, bot.id, at(10))).toBe(true);
    expect((await repo.findByWorkspace(w))?.sendPausedUntil).toEqual(at(10));
    await repo.pauseSends(w, bot.id, at(5));
    expect((await repo.findByWorkspace(w))?.sendPausedUntil).toEqual(at(10));
    await repo.pauseSends(w, bot.id, at(20));
    expect((await repo.findByWorkspace(w))?.sendPausedUntil).toEqual(at(20));
  });

  it('pauseSends never touches the other workspace (isolation)', async () => {
    const { a, b, botA } = await twoWorkspacesWithBots(db);
    expect(await repo.pauseSends(b.workspaceId, botA.bot.id, at(10))).toBe(false);
    expect((await repo.findByWorkspace(a.workspaceId))?.sendPausedUntil).toBeNull();
    expect((await repo.findByWorkspace(b.workspaceId))?.sendPausedUntil).toBeNull();
  });

  it('concurrent pauses keep the latest', async () => {
    const w = await insertWorkspace(db);
    const { bot } = await insertBot(db, { workspaceId: w });
    await Promise.all([1, 9, 4, 7, 2].map((m) => repo.pauseSends(w, bot.id, at(m))));
    expect((await repo.findByWorkspace(w))?.sendPausedUntil).toEqual(at(9));
  });

  it('isolation: findByWorkspace, update, setState, findForCheck, clearOnDisconnect and delete never touch the other workspace (AC-13)', async () => {
    const { a, b, botA, botB } = await twoWorkspacesWithBots(db);
    const beforeB = await rawRow(botB.bot.id);

    expect((await repo.findByWorkspace(a.workspaceId))?.id).toBe(botA.bot.id);
    expect(await repo.update(b.workspaceId, botA.bot.id, { name: 'Hijack' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await repo.setState(b.workspaceId, botA.bot.id, 'needs_token', at(5))).toBe(false);
    expect(await repo.findForCheck(b.workspaceId, botA.bot.id)).toBeNull();
    expect(await repo.clearOnDisconnect(b.workspaceId, botA.bot.id)).toBe(false);
    expect(await repo.delete(b.workspaceId, botA.bot.id)).toBe(false);

    expect(await rawRow(botA.bot.id)).toMatchObject({ name: botA.bot.name, state: 'connected' });
    expect(await rawRow(botB.bot.id)).toEqual(beforeB);
  });

  it('update rotates the token and patches fields of the own bot', async () => {
    const w = await insertWorkspace(db);
    const bot = newBot();
    await repo.insert(w, bot);
    const rotated = fakeToken(bot.telegramBotId).replace('rrr', 'sss');
    expect(
      await repo.update(w, bot.id, {
        token: rotated,
        name: 'Renamed',
        state: 'connected',
        lastCheckedAt: at(2),
      }),
    ).toEqual({ ok: true });
    expect(await repo.findForCheck(w, bot.id)).toMatchObject({
      bot: { name: 'Renamed', lastCheckedAt: at(2) },
      token: rotated,
    });
  });

  it('update can start a new capture epoch with a new secret (connect again)', async () => {
    const w = await insertWorkspace(db);
    const { bot } = await insertBot(db, { workspaceId: w, state: 'disconnected' });
    const secret = secrets.secretFor(bot.id, at(9));
    expect(
      await repo.update(w, bot.id, {
        state: 'connected',
        token: fakeToken(bot.telegramBotId),
        webhookSecret: secret,
        connectedAt: at(9),
        lastCheckedAt: at(9),
      }),
    ).toEqual({ ok: true });
    expect(await repo.findByWebhookId(bot.id, secret)).toMatchObject({
      workspaceId: w,
      connectedAt: at(9),
    });
  });

  it('setState records the outcome of a Bot API exchange, with the identity when given', async () => {
    const w = await insertWorkspace(db);
    const { bot } = await insertBot(db, { workspaceId: w });
    expect(await repo.setState(w, bot.id, 'taken_over', at(4))).toBe(true);
    expect(await repo.findByWorkspace(w)).toMatchObject({
      state: 'taken_over',
      lastCheckedAt: at(4),
      name: bot.name,
    });
    expect(
      await repo.setState(w, bot.id, 'connected', at(5), {
        identity: { name: 'New Name', username: 'new_name_bot' },
      }),
    ).toBe(true);
    expect(await repo.findByWorkspace(w)).toMatchObject({
      state: 'connected',
      lastCheckedAt: at(5),
      name: 'New Name',
      username: 'new_name_bot',
    });
  });

  it('setState to needs_token records when the bot stopped working; a later state keeps it (AC-12)', async () => {
    const w = await insertWorkspace(db);
    const { bot } = await insertBot(db, { workspaceId: w });
    expect((await repo.findByWorkspace(w))?.stoppedWorkingAt).toBeNull();
    expect(await repo.setState(w, bot.id, 'needs_token', at(4))).toBe(true);
    expect((await repo.findByWorkspace(w))?.stoppedWorkingAt).toEqual(at(4));
    expect(await repo.setState(w, bot.id, 'connected', at(6))).toBe(true);
    expect(await repo.findByWorkspace(w)).toMatchObject({
      state: 'connected',
      stoppedWorkingAt: at(4),
    });
  });

  it('setState with ifLastCheckedAt writes only when the row is unchanged since it was read', async () => {
    const w = await insertWorkspace(db);
    const { bot } = await insertBot(db, { workspaceId: w, lastCheckedAt: at(1) });
    // An owner action wrote in between: the stale outcome is not written.
    await db
      .updateTable('bots')
      .set({ last_checked_at: at(3) })
      .where('id', '=', bot.id)
      .execute();
    expect(await repo.setState(w, bot.id, 'needs_token', at(4), { ifLastCheckedAt: at(1) })).toBe(
      false,
    );
    expect(await repo.findByWorkspace(w)).toMatchObject({
      state: 'connected',
      lastCheckedAt: at(3),
    });
    expect(await repo.setState(w, bot.id, 'needs_token', at(4), { ifLastCheckedAt: at(3) })).toBe(
      true,
    );
    expect(await repo.findByWorkspace(w)).toMatchObject({ state: 'needs_token' });
  });

  it('findForCheck gives a null token when the stored one cannot be decrypted (ADR-0006)', async () => {
    const w = await insertWorkspace(db);
    const { bot } = await insertBot(db, { workspaceId: w });
    const otherKey = createBotRepo(
      db,
      createTokenCipher({ id: 'ffffffff', key: Buffer.alloc(32, 7) }),
    );
    expect(await otherKey.findForCheck(w, bot.id)).toMatchObject({
      bot: { id: bot.id },
      token: null,
    });
  });

  it('update with ifRead writes only onto the row the caller decided on', async () => {
    const w = await insertWorkspace(db);
    const { bot } = await insertBot(db, { workspaceId: w, connectedAt: at(1) });
    // Live with another epoch, or expected disconnected: not_found, nothing written.
    expect(await repo.update(w, bot.id, { name: 'X' }, undefined, { connectedAt: at(2) })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await repo.update(w, bot.id, { name: 'X' }, undefined, 'disconnected')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await repo.findByWorkspace(w)).toMatchObject({ name: bot.name });
    expect(await repo.update(w, bot.id, { name: 'Y' }, undefined, { connectedAt: at(1) })).toEqual({
      ok: true,
    });
    // A disconnect in between: a rotation decided on the live row no longer matches.
    await repo.clearOnDisconnect(w, bot.id);
    expect(await repo.update(w, bot.id, { name: 'Z' }, undefined, { connectedAt: at(1) })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await repo.findByWorkspace(w)).toMatchObject({ name: 'Y', state: 'disconnected' });
  });

  it('delete and clearOnDisconnect with ifWritten act only on the row as that writer left it', async () => {
    const w = await insertWorkspace(db);
    const { bot } = await insertBot(db, {
      workspaceId: w,
      connectedAt: at(1),
      lastCheckedAt: at(2),
    });
    const other = { connectedAt: at(1), lastCheckedAt: at(3) };
    expect(await repo.clearOnDisconnect(w, bot.id, undefined, other)).toBe(false);
    expect(await repo.delete(w, bot.id, undefined, other)).toBe(false);
    expect(await repo.findByWorkspace(w)).toMatchObject({ state: 'connected' });
    const mine = { connectedAt: at(1), lastCheckedAt: at(2) };
    expect(await repo.clearOnDisconnect(w, bot.id, undefined, mine)).toBe(true);
    // Now disconnected: an undo keyed on the live row no longer matches.
    expect(await repo.delete(w, bot.id, undefined, mine)).toBe(false);
    expect(await repo.findByWorkspace(w)).toMatchObject({ state: 'disconnected' });
  });

  it('setState does not touch a disconnected row', async () => {
    const w = await insertWorkspace(db);
    const { bot } = await insertBot(db, { workspaceId: w, state: 'disconnected' });
    expect(await repo.setState(w, bot.id, 'connected', at(5))).toBe(false);
    expect(await repo.findByWorkspace(w)).toMatchObject({ state: 'disconnected' });
  });

  it('clearOnDisconnect drops token, secret hash and capture epoch, keeping the binding (AC-18)', async () => {
    const w = await insertWorkspace(db);
    const { bot, webhookSecret } = await insertBot(db, { workspaceId: w });
    expect(await repo.clearOnDisconnect(w, bot.id)).toBe(true);
    expect(await rawRow(bot.id)).toMatchObject({
      state: 'disconnected',
      token_encrypted: null,
      webhook_secret_hash: null,
      connected_at: null,
      telegram_bot_id: String(bot.telegramBotId),
    });
    expect(await repo.findByWebhookId(bot.id, webhookSecret!)).toBeNull();
    expect(await repo.findForCheck(w, bot.id)).toBeNull();
  });

  it('delete removes the own row', async () => {
    const w = await insertWorkspace(db);
    const { bot } = await insertBot(db, { workspaceId: w });
    expect(await repo.delete(w, bot.id)).toBe(true);
    expect(await repo.findByWorkspace(w)).toBeNull();
  });

  it('findForCheck decrypts the token of a live bot of the workspace', async () => {
    const w = await insertWorkspace(db);
    const { bot, token } = await insertBot(db, { workspaceId: w, state: 'needs_token' });
    expect(await repo.findForCheck(w, bot.id)).toEqual({ bot, token });
  });

  describe('controlled exception: findByWebhookId (AC-14)', () => {
    it('returns the bot, and so exactly its workspace id, only for the matching secret', async () => {
      const { a, b, botA, botB } = await twoWorkspacesWithBots(db);
      expect(await repo.findByWebhookId(botA.bot.id, botA.webhookSecret!)).toEqual(botA.bot);
      expect((await repo.findByWebhookId(botB.bot.id, botB.webhookSecret!))?.workspaceId).toBe(
        b.workspaceId,
      );
      expect(a.workspaceId).not.toBe(b.workspaceId);
    });

    it.each([
      ['another bot’s secret', (x: string) => x],
      ['a wrong secret', () => 'wrong-secret'],
      ['an empty secret', () => ''],
      ['no secret', () => undefined],
    ])('returns null for %s', async (_name, pick) => {
      const { botA, botB } = await twoWorkspacesWithBots(db);
      expect(await repo.findByWebhookId(botB.bot.id, pick(botA.webhookSecret!))).toBeNull();
    });

    it.each(['not-a-uuid', '', 'x'.repeat(64), newId()])(
      'returns null for the id %s',
      async (id) => {
        expect(await repo.findByWebhookId(id, 'any')).toBeNull();
      },
    );

    it('still authenticates a needs_token or taken_over bot', async () => {
      const w = await insertWorkspace(db);
      const { bot, webhookSecret } = await insertBot(db, { workspaceId: w, state: 'taken_over' });
      expect(await repo.findByWebhookId(bot.id, webhookSecret!)).toMatchObject({
        state: 'taken_over',
      });
    });
  });

  describe('controlled exception: listDueForCheck (AC-15)', () => {
    it('lists only connected / taken-over bots last checked at least 3 minutes ago, with their workspace ids', async () => {
      const now = at(60);
      const rows = await Promise.all(
        (
          [
            ['connected', at(57)], // exactly 3 min → due
            ['connected', at(58)], // 2 min → not due
            ['taken_over', at(10)], // due
            ['needs_token', at(10)], // never
            ['disconnected', null], // never
          ] as const
        ).map(async ([state, lastCheckedAt]) => {
          const w = await insertWorkspace(db);
          return insertBot(db, {
            workspaceId: w,
            state,
            lastCheckedAt: lastCheckedAt ?? undefined,
          });
        }),
      );
      const due = await repo.listDueForCheck(now);
      const ids = new Set(due.map((d) => d.botId));
      expect(ids.has(rows[0]!.bot.id)).toBe(true);
      expect(ids.has(rows[1]!.bot.id)).toBe(false);
      expect(ids.has(rows[2]!.bot.id)).toBe(true);
      expect(ids.has(rows[3]!.bot.id)).toBe(false);
      expect(ids.has(rows[4]!.bot.id)).toBe(false);
      expect(due.find((d) => d.botId === rows[0]!.bot.id)).toEqual({
        botId: rows[0]!.bot.id,
        workspaceId: rows[0]!.bot.workspaceId,
      });
    });
  });
});
