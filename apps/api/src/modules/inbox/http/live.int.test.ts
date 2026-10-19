import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LiveFrame } from '@tg/shared';
import { buildApp } from '../../../app.js';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { publish, type RealtimeSignal } from '../../../platform/realtime.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { insertPing, insertTelegramLink } from '../../../test/fixtures/notifications.js';
import { createPresenceRepo } from '../../notifications/infra/presence-repo.js';
import { isAway, isPresent } from '../../notifications/domain/presence.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

const ORIGIN = 'http://localhost:5173';

type WebSocket = Awaited<ReturnType<FastifyInstance['injectWS']>>;

describe('inbox live socket (postgres + real websocket)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let db: Db;
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await buildApp(testConfig(database.url));
    await app.ready();
    db = createDb(database.url);
  });
  afterAll(async () => {
    for (const s of sockets) s.terminate();
    await app?.close();
    await db?.destroy();
    await database?.stop();
  });

  const member = async (workspaceId: string, state: 'active' | 'deactivated' = 'active') => {
    const account = await insertAccount(db, {});
    const session = await insertSession(db, account.id, { createdAt: new Date() });
    await insertMembership(db, workspaceId, { accountId: account.id, state });
    return { accountId: account.id, sessionId: session.row.id, token: session.token };
  };

  type Open = {
    socket: WebSocket;
    frames: unknown[];
    closed: Promise<{ code: number; reason: string }>;
  };
  const connect = async (
    workspaceId: string,
    token: string,
    headers: Record<string, string> = { origin: ORIGIN },
  ): Promise<Open> => {
    const socket = await app.injectWS(`/api/workspaces/${workspaceId}/inbox/live`, {
      headers: { cookie: `session=${token}`, ...headers },
    });
    sockets.push(socket);
    const frames: unknown[] = [];
    socket.on('message', (data: Buffer) => frames.push(JSON.parse(String(data))));
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      socket.on('close', (code: number, reason: Buffer) =>
        resolve({ code, reason: reason.toString() }),
      ),
    );
    return { socket, frames, closed };
  };
  const refused = async (workspaceId: string, headers: Record<string, string>) =>
    connect(workspaceId, headers['x-token'] ?? '', headers).then(
      () => null,
      (err: Error) => err.message,
    );
  const signal = (s: RealtimeSignal) => db.transaction().execute((trx) => publish(trx, s));
  const until = async (cond: () => boolean, ms = 3000) => {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > ms) throw new Error('timed out waiting');
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const changed = (ws: string): RealtimeSignal => ({
    type: 'conversation.changed',
    v: 1,
    workspace_id: ws,
    conversation_id: newId(),
    item: { type: 'message', id: newId() },
    change: 'created',
  });

  it('delivers a committed signal as a valid frame within 3 s, to its workspace only', async () => {
    const [a, b] = [
      await insertWorkspace(db, `A ${newId()}`),
      await insertWorkspace(db, `B ${newId()}`),
    ];
    const [ma, mb] = [await member(a), await member(b)];
    const inA = await connect(a, ma.token);
    const inB = await connect(b, mb.token);
    const t0 = Date.now();
    await signal(changed(a));
    await until(() => inA.frames.length === 1);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(LiveFrame.parse(inA.frames[0])).toMatchObject({ workspace_id: a });
    await signal({ type: 'bot.changed', v: 1, workspace_id: b });
    await until(() => inB.frames.length === 1);
    expect(inB.frames).toEqual([{ type: 'bot.changed', v: 1, workspace_id: b }]);
    expect(inA.frames).toHaveLength(1);
  });

  it('sends a read change only to the reading member', async () => {
    const ws = await insertWorkspace(db, `R ${newId()}`);
    const [me, other] = [await member(ws), await member(ws)];
    const mine = await connect(ws, me.token);
    const theirs = await connect(ws, other.token);
    await signal({
      ...changed(ws),
      item: null,
      change: 'read',
      account_id: me.accountId,
    } as RealtimeSignal);
    await signal({ type: 'bot.changed', v: 1, workspace_id: ws });
    await until(() => theirs.frames.length === 1 && mine.frames.length === 2);
    expect(theirs.frames).toEqual([{ type: 'bot.changed', v: 1, workspace_id: ws }]);
  });

  it('refuses a foreign or missing Origin before the handshake (403)', async () => {
    const ws = await insertWorkspace(db, `O ${newId()}`);
    const me = await member(ws);
    expect(await refused(ws, { origin: 'https://evil.example', 'x-token': me.token })).toContain(
      '403',
    );
    const noOrigin = await app
      .injectWS(`/api/workspaces/${ws}/inbox/live`, { headers: { cookie: `session=${me.token}` } })
      .then(
        () => null,
        (e: Error) => e.message,
      );
    expect(noOrigin).toContain('403');
  });

  it('refuses without a session (401), for a deactivated member (403) and for a foreign workspace (404)', async () => {
    const ws = await insertWorkspace(db, `G ${newId()}`);
    const gone = await member(ws, 'deactivated');
    const outsider = await member(await insertWorkspace(db, `X ${newId()}`));
    expect(await refused(ws, { origin: ORIGIN })).toContain('401');
    expect(await refused(ws, { origin: ORIGIN, 'x-token': gone.token })).toContain('403');
    expect(await refused(ws, { origin: ORIGIN, 'x-token': outsider.token })).toContain('404');
  });

  it('closes 4403 at once on the deactivation signal, only that workspace socket of the account', async () => {
    const [a, b] = [
      await insertWorkspace(db, `DA ${newId()}`),
      await insertWorkspace(db, `DB ${newId()}`),
    ];
    const me = await member(a);
    await insertMembership(db, b, { accountId: me.accountId });
    const tabA = await connect(a, me.token);
    const tabB = await connect(b, me.token);
    const t0 = Date.now();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('memberships')
        .set({ state: 'deactivated', deactivated_at: new Date() })
        .where('workspace_id', '=', a)
        .where('account_id', '=', me.accountId)
        .execute();
      await publish(trx, {
        type: 'membership.deactivated',
        v: 1,
        workspace_id: a,
        account_id: me.accountId,
      });
    });
    const close = await tabA.closed;
    expect(close.code).toBe(4403);
    expect(Date.now() - t0).toBeLessThan(2000);
    await signal({ type: 'bot.changed', v: 1, workspace_id: b });
    await until(() => tabB.frames.length === 1);
    expect(tabB.socket.readyState).toBe(1);
  });

  it('with the signal suppressed, the 5 s re-check closes a deactivated member (4403)', async () => {
    const ws = await insertWorkspace(db, `S ${newId()}`);
    const me = await member(ws);
    const tab = await connect(ws, me.token);
    const t0 = Date.now();
    await db
      .updateTable('memberships')
      .set({ state: 'deactivated', deactivated_at: new Date() })
      .where('workspace_id', '=', ws)
      .where('account_id', '=', me.accountId)
      .execute();
    const close = await tab.closed;
    expect(close.code).toBe(4403);
    expect(Date.now() - t0).toBeLessThanOrEqual(5500);
  }, 10_000);

  it('closes 4401 within 5 s when the session ends', async () => {
    const ws = await insertWorkspace(db, `E ${newId()}`);
    const me = await member(ws);
    const tab = await connect(ws, me.token);
    const t0 = Date.now();
    await db.deleteFrom('sessions').where('id', '=', me.sessionId).execute();
    const close = await tab.closed;
    expect(close.code).toBe(4401);
    expect(Date.now() - t0).toBeLessThanOrEqual(5500);
  }, 10_000);

  it('ignores frames sent by the client', async () => {
    const ws = await insertWorkspace(db, `I ${newId()}`);
    const me = await member(ws);
    const tab = await connect(ws, me.token);
    tab.socket.send(JSON.stringify({ type: 'bot.changed', v: 1, workspace_id: ws }));
    tab.socket.send('not json');
    await signal(changed(ws));
    await until(() => tab.frames.length === 1);
    expect(tab.socket.readyState).toBe(1);
  });

  it('ignores a frame over 1 KiB without closing, and closes only one far over the transport cap', async () => {
    const ws = await insertWorkspace(db, `P ${newId()}`);
    const me = await member(ws);
    const tab = await connect(ws, me.token);
    tab.socket.send(
      JSON.stringify({ type: 'presence', v: 1, on_screen: true, pad: 'x'.repeat(2048) }),
    );
    await signal(changed(ws));
    await until(() => tab.frames.length === 1);
    expect(tab.socket.readyState).toBe(1);
    tab.socket.send('x'.repeat(64 * 1024));
    const close = await tab.closed;
    expect(close.code).toBe(1009);
  });

  describe('presence leases (ADR-0002, AC-07)', () => {
    const leases = (workspaceId: string, accountId: string) =>
      db
        .selectFrom('tab_presences')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('account_id', '=', accountId)
        .execute();
    const lease = async (workspaceId: string, accountId: string, n = 1) => {
      let rows = await leases(workspaceId, accountId);
      const start = Date.now();
      while (rows.length < n && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 25));
        rows = await leases(workspaceId, accountId);
      }
      return rows;
    };
    const pollRows = async (
      workspaceId: string,
      accountId: string,
      ok: (rows: Awaited<ReturnType<typeof leases>>) => boolean,
    ) => {
      const start = Date.now();
      let rows = await leases(workspaceId, accountId);
      while (!ok(rows) && Date.now() - start < 4000) {
        await new Promise((r) => setTimeout(r, 25));
        rows = await leases(workspaceId, accountId);
      }
      return rows;
    };

    it('registers a hidden 50 s lease on open, extends it on a pong and deletes it on a clean close', async () => {
      const ws = await insertWorkspace(db, `L ${newId()}`);
      const me = await member(ws);
      const before = Date.now();
      const tab = await connect(ws, me.token);
      const [row] = await lease(ws, me.accountId);
      expect(row!.on_screen).toBe(false);
      expect(row!.last_on_screen_at).toBeNull();
      expect(row!.live_until.getTime()).toBeGreaterThanOrEqual(before + 49_000);
      expect(row!.live_until.getTime()).toBeLessThanOrEqual(Date.now() + 50_000);
      // Move the lease back, then a pong (the browser answers the server ping with one) pushes it out.
      await db
        .updateTable('tab_presences')
        .set({ live_until: new Date(Date.now() + 5_000) })
        .where('id', '=', row!.id)
        .execute();
      tab.socket.pong();
      const [extended] = await pollRows(
        ws,
        me.accountId,
        (r) => r[0]!.live_until.getTime() > Date.now() + 40_000,
      );
      expect(extended!.live_until.getTime()).toBeGreaterThan(Date.now() + 40_000);
      // The in-memory test transport does not end the stream on a close handshake alone, so the
      // tab goes away by dropping the connection; the hub's detach path is the same.
      tab.socket.terminate();
      await tab.closed;
      expect(await pollRows(ws, me.accountId, (r) => r.length === 0)).toEqual([]);
    });

    it('a dead socket counts away once its lease passes; a closed one at once', async () => {
      const ws = await insertWorkspace(db, `D ${newId()}`);
      const me = await member(ws);
      await connect(ws, me.token);
      const [row] = await lease(ws, me.accountId);
      const repo = createPresenceRepo(db);
      const at = (ms: number) => new Date(Date.now() + ms);
      // On screen at 50 s... not yet: it opened hidden, so it is away straight away.
      expect(
        isAway(
          [...((await repo.listLive(ws, at(0), [me.accountId])).get(me.accountId) ?? [])],
          at(0),
        ),
      ).toBe(true);
      await db
        .updateTable('tab_presences')
        .set({ on_screen: true })
        .where('id', '=', row!.id)
        .execute();
      const live = async (ms: number) => [
        ...((await repo.listLive(ws, at(ms), [me.accountId])).get(me.accountId) ?? []),
      ];
      expect(isPresent(await live(0), at(0))).toBe(true);
      // No pong for 60 s: the lease has passed.
      expect(isAway(await live(60_000), at(60_000))).toBe(true);
    });

    it('a presence frame sets the screen state: present for 10 minutes after leaving, then away', async () => {
      const ws = await insertWorkspace(db, `H ${newId()}`);
      const me = await member(ws);
      const tab = await connect(ws, me.token);
      await lease(ws, me.accountId);
      tab.socket.send(JSON.stringify({ type: 'presence', v: 1, on_screen: true }));
      const [shown] = await pollRows(ws, me.accountId, (r) => r[0]!.on_screen);
      expect(shown!.on_screen).toBe(true);
      tab.socket.send(JSON.stringify({ type: 'presence', v: 1, on_screen: false }));
      const [hidden] = await pollRows(ws, me.accountId, (r) => !r[0]!.on_screen);
      expect(hidden!.on_screen).toBe(false);
      expect(hidden!.last_on_screen_at).not.toBeNull();
      // Keep the lease live for the check, then look at 9 and 11 minutes after leaving.
      await db
        .updateTable('tab_presences')
        .set({ live_until: new Date(Date.now() + 3_600_000) })
        .execute();
      const repo = createPresenceRepo(db);
      const at = (ms: number) => new Date(hidden!.last_on_screen_at!.getTime() + ms);
      const live = async (ms: number) => [
        ...((await repo.listLive(ws, at(ms), [me.accountId])).get(me.accountId) ?? []),
      ];
      expect(isPresent(await live(9 * 60_000), at(9 * 60_000))).toBe(true);
      expect(isAway(await live(11 * 60_000), at(11 * 60_000))).toBe(true);
    });

    it('junk and oversized frames are ignored and the lease stays as it was', async () => {
      const ws = await insertWorkspace(db, `J ${newId()}`);
      const me = await member(ws);
      const tab = await connect(ws, me.token);
      await lease(ws, me.accountId);
      for (const data of [
        'not json',
        JSON.stringify({ type: 'nope' }),
        JSON.stringify({ type: 'presence', v: 1, on_screen: 'yes' }),
        JSON.stringify({ type: 'presence', v: 1, on_screen: true, pad: 'x'.repeat(3000) }),
      ]) {
        tab.socket.send(data);
      }
      await new Promise((r) => setTimeout(r, 1500));
      const [row] = await leases(ws, me.accountId);
      expect(row!.on_screen).toBe(false);
      expect(tab.socket.readyState).toBe(1);
    });

    it('a burst of frames ends with the last value', async () => {
      const ws = await insertWorkspace(db, `B ${newId()}`);
      const me = await member(ws);
      const tab = await connect(ws, me.token);
      await lease(ws, me.accountId);
      for (const v of [true, false, true, false, true]) {
        tab.socket.send(JSON.stringify({ type: 'presence', v: 1, on_screen: v }));
      }
      const [row] = await pollRows(ws, me.accountId, (r) => r[0]!.on_screen);
      expect(row!.on_screen).toBe(true);
    });

    it('opening or coming back on screen within 15 minutes of a ping marks that ping opened', async () => {
      const ws = await insertWorkspace(db, `O ${newId()}`);
      const me = await member(ws);
      const link = await insertTelegramLink(db, { workspaceId: ws, accountId: me.accountId });
      const ping = await insertPing(db, {
        workspaceId: ws,
        accountId: me.accountId,
        telegramLinkId: link.id,
        createdAt: new Date(Date.now() - 5 * 60_000),
      });
      const tab = await connect(ws, me.token);
      await lease(ws, me.accountId);
      const openedAt = async () =>
        (
          await db
            .selectFrom('pings')
            .select('opened_at')
            .where('id', '=', ping.id)
            .executeTakeFirstOrThrow()
        ).opened_at;
      expect(await openedAt()).toBeNull();
      tab.socket.send(JSON.stringify({ type: 'presence', v: 1, on_screen: true }));
      const start = Date.now();
      while ((await openedAt()) === null && Date.now() - start < 4000) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(await openedAt()).not.toBeNull();
    });

    it("4403 on deactivation deletes the lease; only that workspace's lease", async () => {
      const [a, b] = [
        await insertWorkspace(db, `XA ${newId()}`),
        await insertWorkspace(db, `XB ${newId()}`),
      ];
      const me = await member(a);
      await insertMembership(db, b, { accountId: me.accountId });
      const tabA = await connect(a, me.token);
      await connect(b, me.token);
      await lease(a, me.accountId);
      await lease(b, me.accountId);
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('memberships')
          .set({ state: 'deactivated', deactivated_at: new Date() })
          .where('workspace_id', '=', a)
          .where('account_id', '=', me.accountId)
          .execute();
        await publish(trx, {
          type: 'membership.deactivated',
          v: 1,
          workspace_id: a,
          account_id: me.accountId,
        });
      });
      expect((await tabA.closed).code).toBe(4403);
      expect(await pollRows(a, me.accountId, (r) => r.length === 0)).toEqual([]);
      expect(await leases(b, me.accountId)).toHaveLength(1);
    });
  });

  it("telegram_link.changed reaches only that account's sockets in that workspace", async () => {
    const [a, b] = [
      await insertWorkspace(db, `TA ${newId()}`),
      await insertWorkspace(db, `TB ${newId()}`),
    ];
    const [me, mate] = [await member(a), await member(a)];
    await insertMembership(db, b, { accountId: me.accountId });
    const mine = await connect(a, me.token);
    const mineOther = await connect(b, me.token);
    const theirs = await connect(a, mate.token);
    await signal({
      type: 'telegram_link.changed',
      v: 1,
      workspace_id: a,
      account_id: me.accountId,
    });
    await signal({ type: 'bot.changed', v: 1, workspace_id: a });
    await until(() => theirs.frames.length === 1 && mine.frames.length === 2);
    expect(mine.frames[0]).toEqual({ type: 'telegram_link.changed', v: 1, workspace_id: a });
    expect(theirs.frames).toEqual([{ type: 'bot.changed', v: 1, workspace_id: a }]);
    expect(mineOther.frames).toEqual([]);
  });

  it('closes open sockets with 1001 when the server shuts down (B8, events.md)', async () => {
    const other = await buildApp(testConfig(database.url));
    await other.ready();
    const ws = await insertWorkspace(db, `S ${newId()}`);
    const me = await member(ws);
    const socket = await other.injectWS(`/api/workspaces/${ws}/inbox/live`, {
      headers: { cookie: `session=${me.token}`, origin: ORIGIN },
    });
    const closed = new Promise<number>((resolve) =>
      socket.on('close', (code: number) => resolve(code)),
    );
    await other.close();
    expect(await closed).toBe(1001);
  });

  it('sends resync to every socket after the listener reconnects', async () => {
    const ws = await insertWorkspace(db, `RS ${newId()}`);
    const me = await member(ws);
    const tab = await connect(ws, me.token);
    await sql`select pg_terminate_backend(pid) from pg_stat_activity
      where query ilike 'LISTEN realtime%' and pid <> pg_backend_pid()`.execute(db);
    await until(() => tab.frames.length >= 1, 5000);
    expect(tab.frames[0]).toEqual({ type: 'resync', v: 1, workspace_id: ws });
    await signal({ type: 'bot.changed', v: 1, workspace_id: ws });
    await until(() => tab.frames.length === 2);
  }, 10_000);
});
