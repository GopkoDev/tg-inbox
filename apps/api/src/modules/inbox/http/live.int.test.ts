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

  it('closes a socket that sends a frame over 1 KiB: the channel is server to client (B7)', async () => {
    const ws = await insertWorkspace(db, `P ${newId()}`);
    const me = await member(ws);
    const tab = await connect(ws, me.token);
    tab.socket.send('x'.repeat(2048));
    const close = await tab.closed;
    expect(close.code).toBe(1009);
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
