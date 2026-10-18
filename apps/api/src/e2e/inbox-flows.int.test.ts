import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationPage, ErrorEnvelope, ThreadPage, ThreadReply } from '@tg/shared';
import { buildApp } from '../app.js';
import { buildDeps, type Deps } from '../deps.js';
import { newId } from '../platform/ids.js';
import { sendAnswers, startFakeTelegram, type FakeTelegram } from '../test/fake-telegram.js';
import { insertAccount, insertSession } from '../test/fixtures/auth.js';
import { insertBot } from '../test/fixtures/bots.js';
import { insertMembership, insertWorkspace } from '../test/fixtures/workspaces.js';
import { signedDelivery, telegramEdit, telegramUpdate } from '../test/fixtures/telegram.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { truncateAll } from './helpers.js';

const ORIGIN = 'http://localhost:5173';

describe('shared-inbox end-to-end stories (postgres + pg-boss worker + fake Bot API)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let deps: Deps;
  let app: FastifyInstance;
  let nextUpdate = 1;

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    const config = { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot };
    deps = buildDeps(config);
    app = await buildApp(config);
  });
  afterAll(async () => {
    await app?.close();
    await deps?.destroy();
    await fake?.stop();
    await database?.stop();
  });
  beforeEach(async () => {
    await truncateAll(deps.db);
    fake.reset();
  });

  const nowS = () => Math.floor(Date.now() / 1000);

  /** A workspace with a connected bot (scripted on the fake) and one operator signed in. */
  async function workspace(name: string, state: 'active' | 'deactivated' = 'active') {
    const ws = await insertWorkspace(deps.db, name);
    const { bot, token, webhookSecret } = await insertBot(deps.db, { workspaceId: ws });
    fake.bot(token).script({});
    const hook = { id: bot.id, secret: webhookSecret! };
    const operator = await signedIn(ws, state);
    return { ws, token, hook, operator, base: `/api/workspaces/${ws}/inbox` };
  }
  async function signedIn(ws: string, state: 'active' | 'deactivated' = 'active') {
    const account = await insertAccount(deps.db, { displayName: 'Olga Operator' });
    const session = await insertSession(deps.db, account.id, {
      createdAt: new Date(Date.now() - 3_600_000),
    });
    await insertMembership(deps.db, ws, { accountId: account.id, state });
    return { accountId: account.id, cookies: { session: session.token } };
  }
  type Operator = Awaited<ReturnType<typeof signedIn>>;

  const write = (
    hook: { id: string; secret: string },
    fromId: number,
    messageId: number,
    text: string,
  ) =>
    signedDelivery(
      app,
      hook,
      telegramUpdate({ updateId: nextUpdate++, messageId, date: nowS(), fromId, text }),
    );
  const get = (who: Operator | null, url: string) =>
    app.inject({ method: 'GET', url, cookies: who?.cookies });
  const post = (who: Operator | null, url: string, payload: object) =>
    app.inject({ method: 'POST', url, cookies: who?.cookies, payload });
  const list = async (w: { base: string; operator: Operator }) => {
    const res = await get(w.operator, `${w.base}/conversations`);
    expect(res.statusCode).toBe(200);
    return ConversationPage.parse(res.json());
  };
  const thread = async (w: { base: string; operator: Operator }, conv: string) => {
    const res = await get(w.operator, `${w.base}/conversations/${conv}/items`);
    expect(res.statusCode).toBe(200);
    return ThreadPage.parse(res.json());
  };
  const reply = (
    w: { base: string; operator: Operator },
    conv: string,
    text: string,
    key = newId(),
  ) =>
    post(w.operator, `${w.base}/conversations/${conv}/replies`, {
      client_key: key,
      body: text,
      last_seen_reply_id: null,
    });
  const sends = (token: string) => fake.calls(token).filter((c) => c.method === 'sendMessage');
  const stateOf = (id: string) =>
    deps.db
      .selectFrom('replies')
      .select(['state', 'failure_reason'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  const settled = (id: string, timeout = 8_000) =>
    vi.waitFor(async () => expect((await stateOf(id)).state).not.toBe('sending'), {
      timeout,
      interval: 100,
    });

  it('story 1 — customer writes, operator replies, customer answers in the same conversation (AC-17)', async () => {
    const w = await workspace('Acme Flowers');
    expect((await write(w.hook, 910001, 1, 'Do you have tulips?')).statusCode).toBe(200);

    const first = await list(w);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ unread_count: 1, waiting_for_reply: true });
    const conv = first.items[0]!.id;

    const text = 'Hello!\nYes, we have red tulips.\n\nAnything else?';
    const sent = await reply(w, conv, text);
    expect(sent.statusCode).toBe(201);
    const sentReply = ThreadReply.parse(sent.json());
    const id = sentReply.id;
    await settled(id);
    expect((await stateOf(id)).state).toBe('sent');

    // One plain-text sendMessage to the customer's chat: exact text, no author name, no markup.
    const calls = sends(w.token);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual({ chat_id: 910001, text });
    expect(JSON.stringify(calls[0]!.params)).not.toContain('Olga');

    // The customer answers (and edits the answer): the same conversation, the edit shows without reorder.
    // Telegram dates have second precision and a message in the reply's second sorts before it
    // (ADR-0008), so the answer is dated at least one second after the reply.
    const answerAt = Math.max(nowS(), Math.floor(Date.parse(sentReply.position_at) / 1000) + 1);
    expect(
      (
        await signedDelivery(
          app,
          w.hook,
          telegramUpdate({
            updateId: nextUpdate++,
            messageId: 2,
            date: answerAt,
            fromId: 910001,
            text: 'Great, two please',
          }),
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await signedDelivery(
          app,
          w.hook,
          telegramEdit({
            updateId: nextUpdate++,
            messageId: 2,
            date: answerAt,
            fromId: 910001,
            text: 'Great, three please',
            editDate: answerAt + 1,
          }),
        )
      ).statusCode,
    ).toBe(200);
    const after = await list(w);
    expect(after.items.map((c) => c.id)).toEqual([conv]);
    const items = (await thread(w, conv)).items;
    expect(items.map((i) => i.type)).toEqual(['message', 'reply', 'message']);
    expect(items.at(-1)).toMatchObject({ body: 'Great, three please' });
    expect(after.items[0]).toMatchObject({ waiting_for_reply: true });
  });

  it('story 1b — a sent reply clears "waiting for a reply" and moves its conversation to the top (AC-01, AC-06)', async () => {
    const w = await workspace('Acme Tulips');
    expect((await write(w.hook, 920001, 1, 'First customer')).statusCode).toBe(200);
    expect((await write(w.hook, 920002, 1, 'Second customer')).statusCode).toBe(200);
    const before = await list(w);
    expect(before.items).toHaveLength(2);
    const [newer, older] = [before.items[0]!, before.items[1]!];
    expect(older).toMatchObject({ waiting_for_reply: true });

    const sent = await reply(w, older.id, 'On it!');
    expect(sent.statusCode).toBe(201);
    const id = ThreadReply.parse(sent.json()).id;
    await settled(id);
    expect((await stateOf(id)).state).toBe('sent');

    const after = await list(w);
    expect(after.items.map((c) => c.id)).toEqual([older.id, newer.id]);
    expect(after.items[0]).toMatchObject({
      waiting_for_reply: false,
      last_item: { type: 'reply', id },
    });
  });

  it('story 2 — one person writes to two workspaces: separate inboxes, replies only through their own bot (AC-18)', async () => {
    const a = await workspace('Acme Flowers');
    const b = await workspace('Bolt Bikes');
    // One account is a member of both.
    const both = a.operator;
    await insertMembership(deps.db, b.ws, { accountId: both.accountId });
    b.operator = both;

    await write(a.hook, 910002, 1, 'Hello Acme');
    await write(b.hook, 910002, 1, 'Hello Bolt');
    const pa = await list(a);
    const pb = await list(b);
    expect(pa.items).toHaveLength(1);
    expect(pb.items).toHaveLength(1);
    expect(pa.items[0]!.id).not.toBe(pb.items[0]!.id);
    expect(JSON.stringify(await thread(a, pa.items[0]!.id))).not.toContain('Hello Bolt');
    expect(JSON.stringify(await thread(b, pb.items[0]!.id))).not.toContain('Hello Acme');
    // A conversation of one workspace is not reachable through the other.
    expect((await get(both, `${b.base}/conversations/${pa.items[0]!.id}`)).statusCode).toBe(404);

    const id = ThreadReply.parse((await reply(a, pa.items[0]!.id, 'From Acme')).json()).id;
    await settled(id);
    expect(sends(a.token).map((c) => c.params.text)).toEqual(['From Acme']);
    expect(sends(b.token)).toHaveLength(0);
    expect(JSON.stringify(await thread(b, pb.items[0]!.id))).not.toContain('From Acme');
    // Writing again does not make a second conversation per workspace.
    await write(a.hook, 910002, 2, 'Again');
    expect((await list(a)).items).toHaveLength(1);
  });

  it('story 3 — a blocked customer: not delivered, still waiting, every further reply fails the same way (AC-10)', async () => {
    const w = await workspace('Acme Flowers');
    await write(w.hook, 910003, 1, 'Hi');
    const conv = (await list(w)).items[0]!.id;
    fake.bot(w.token).script({ sendMessage: [sendAnswers.blocked(), sendAnswers.blocked()] });

    const one = ThreadReply.parse((await reply(w, conv, 'First')).json()).id;
    await settled(one);
    expect(await stateOf(one)).toEqual({
      state: 'not_delivered',
      failure_reason: 'customer_blocked',
    });
    expect((await list(w)).items[0]).toMatchObject({ waiting_for_reply: true });

    const two = await reply(w, conv, 'Second');
    expect(two.statusCode).toBe(201); // the reply box stays usable
    await settled(two.json().id);
    expect(await stateOf(two.json().id)).toEqual({
      state: 'not_delivered',
      failure_reason: 'customer_blocked',
    });
    expect((await list(w)).items[0]).toMatchObject({ waiting_for_reply: true });
  });

  it('story 4 — double submit and lost response send once; unknown outcome is never resent without a warning (AC-11)', async () => {
    const w = await workspace('Acme Flowers');
    await write(w.hook, 910004, 1, 'Hi');
    const conv = (await list(w)).items[0]!.id;

    // Double press: one client key, two requests, one reply, one sendMessage.
    const key = newId();
    const [x, y] = await Promise.all([reply(w, conv, 'Once', key), reply(w, conv, 'Once', key)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 201]);
    expect(x.json().id).toBe(y.json().id);
    await settled(x.json().id);
    expect(sends(w.token).map((c) => c.params.text)).toEqual(['Once']);

    // The answer never reaches us: not confirmed, never resent automatically, and a retry of the
    // same key finds the existing reply.
    fake.bot(w.token).script({ sendMessage: [sendAnswers.resetAfterWrite()] });
    const lostKey = newId();
    const lost = await reply(w, conv, 'Maybe', lostKey);
    expect(lost.statusCode).toBe(201);
    const lostId = lost.json().id as string;
    await settled(lostId, 25_000);
    expect((await stateOf(lostId)).state).toBe('not_confirmed');
    const retried = await reply(w, conv, 'Maybe', lostKey);
    expect(retried.statusCode).toBe(200);
    expect(retried.json().id).toBe(lostId);
    await new Promise((r) => setTimeout(r, 1500));
    expect(sends(w.token).map((c) => c.params.text)).toEqual(['Once', 'Maybe']);

    // Sending it again needs the warning; with it the customer may get it twice by choice.
    const resend = `${w.base}/conversations/${conv}/replies/${lostId}/resend`;
    const warned = await post(w.operator, resend, {});
    expect(warned.statusCode).toBe(409);
    expect(warned.json().error.code).toBe('DUPLICATE_RISK_CONFIRMATION_REQUIRED');
    expect(sends(w.token)).toHaveLength(2);
    expect((await post(w.operator, resend, { confirm_duplicate_risk: true })).statusCode).toBe(200);
    await settled(lostId);
    expect(sends(w.token).map((c) => c.params.text)).toEqual(['Once', 'Maybe', 'Maybe']);
  }, 60_000);

  it('story 4b — 31 concurrent sends: 30 accepted, the 31st refused with Retry-After (QG-2)', async () => {
    const w = await workspace('Acme Flowers');
    await write(w.hook, 910005, 1, 'Hi');
    const conv = (await list(w)).items[0]!.id;
    const results = await Promise.all(
      Array.from({ length: 31 }, (_, i) => reply(w, conv, `Reply ${i}`)),
    );
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(30);
    const refused = results.filter((r) => r.statusCode === 429);
    expect(refused).toHaveLength(1);
    expect(ErrorEnvelope.parse(refused[0]!.json()).error.code).toBe('REPLY_LIMIT_REACHED');
    expect(refused[0]!.headers['retry-after']).toBeDefined();
    const stored = await deps.db
      .selectFrom('replies')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('workspace_id', '=', w.ws)
      .executeTakeFirstOrThrow();
    expect(Number(stored.n)).toBe(30);
  }, 30_000);

  it('story 5 — guard trio on every inbox route, media and socket: signed out 401, outsider 404, deactivated 403 (AC-08)', async () => {
    const w = await workspace('Acme Flowers');
    await write(w.hook, 910006, 1, 'Secret order');
    const conv = (await list(w)).items[0]!.id;
    const msg = (await thread(w, conv)).items[0]!.id;
    const sentReply = ThreadReply.parse((await reply(w, conv, 'Private answer')).json()).id;
    await settled(sentReply);
    const before = sends(w.token).length;

    const outsider = await signedIn(await insertWorkspace(deps.db, 'Bolt Bikes'));
    const removed = await signedIn(w.ws, 'deactivated');
    const c = `${w.base}/conversations/${conv}`;
    const reads = [
      `${w.base}/conversations`,
      c,
      `${c}/items`,
      `${c}/messages/${msg}`,
      `${c}/replies/${sentReply}`,
      `${c}/messages/${msg}/media`,
      `${w.base}/bot`,
    ];
    const writes: [string, object][] = [
      [`${c}/read`, { read_through_at: new Date().toISOString() }],
      [`${c}/replies`, { client_key: newId(), body: 'Intruder', last_seen_reply_id: null }],
      [`${c}/replies/${sentReply}/resend`, { confirm_duplicate_risk: true }],
    ];
    const expectRefused = (
      res: { statusCode: number; body: string },
      status: number,
      code: string,
      url: string,
    ) => {
      expect(res.statusCode, url).toBe(status);
      expect(JSON.parse(res.body).error.code, url).toBe(code);
      expect(res.body, url).not.toContain('Secret order');
      expect(res.body, url).not.toContain('Private answer');
    };
    for (const url of reads) {
      expectRefused(await get(null, url), 401, 'UNAUTHENTICATED', url);
      expectRefused(await get(outsider, url), 404, 'NOT_FOUND', url);
      expectRefused(await get(removed, url), 403, 'ACCESS_REMOVED', url);
    }
    for (const [url, payload] of writes) {
      expectRefused(await post(null, url, payload), 401, 'UNAUTHENTICATED', url);
      expectRefused(await post(outsider, url, payload), 404, 'NOT_FOUND', url);
      expectRefused(await post(removed, url, payload), 403, 'ACCESS_REMOVED', url);
    }
    // The socket: refused before the handshake, same trio.
    const socket = (token: string | null) =>
      app
        .injectWS(`${w.base}/live`, {
          headers: { origin: ORIGIN, ...(token && { cookie: `session=${token}` }) },
        })
        .then(
          (s) => {
            s.terminate();
            return 'opened';
          },
          (err: Error) => err.message,
        );
    expect(await socket(null)).toContain('401');
    expect(await socket(outsider.cookies.session)).toContain('404');
    expect(await socket(removed.cookies.session)).toContain('403');

    // Nothing was sent to any customer by the refused attempts.
    await new Promise((r) => setTimeout(r, 1000));
    expect(sends(w.token)).toHaveLength(before);
    const replies = await deps.db
      .selectFrom('replies')
      .select('body')
      .where('workspace_id', '=', w.ws)
      .execute();
    expect(replies.map((r) => r.body)).toEqual(['Private answer']);
  }, 30_000);
});
