import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActiveMemberList,
  ConversationPage,
  ConversationStateChange,
  ConversationSummary,
  ErrorEnvelope,
  LiveFrame,
  ThreadActivity,
  ThreadPage,
  ThreadReply,
} from '@tg/shared';
import { buildApp } from '../app.js';
import { buildDeps, type Deps } from '../deps.js';
import { newId } from '../platform/ids.js';
import { sendAnswers, startFakeTelegram, type FakeTelegram } from '../test/fake-telegram.js';
import { insertAccount, insertSession } from '../test/fixtures/auth.js';
import { insertBot } from '../test/fixtures/bots.js';
import { insertMembership, insertWorkspace } from '../test/fixtures/workspaces.js';
import { signedDelivery, telegramEdit, telegramUpdate } from '../test/fixtures/telegram.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { integrityViolations, truncateAll } from './helpers.js';

const ORIGIN = 'http://localhost:5173';

type WebSocket = Awaited<ReturnType<FastifyInstance['injectWS']>>;

describe('assignment and status end-to-end stories (postgres + pg-boss worker + fake Bot API)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let deps: Deps;
  let app: FastifyInstance;
  let nextUpdate = 1;
  let touched: string[] = [];
  let sockets: WebSocket[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    const config = { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot };
    deps = buildDeps(config);
    app = await buildApp(config);
    await app.ready();
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
    touched = [];
    sockets = [];
  });
  afterEach(async () => {
    for (const s of sockets) s.terminate();
    // After every story: no assignment to a non-member and no customer lost in a closed conversation.
    expect(await integrityViolations(deps.db, touched)).toEqual([]);
  });

  const nowS = () => Math.floor(Date.now() / 1000);

  type Person = { accountId: string; cookies: { session: string } };

  async function person(
    ws: string,
    o: { name?: string; role?: 'owner' | 'operator'; state?: 'active' | 'deactivated' } = {},
  ): Promise<Person> {
    const account = await insertAccount(deps.db, { displayName: o.name ?? 'Olga Operator' });
    const session = await insertSession(deps.db, account.id, {
      createdAt: new Date(Date.now() - 3_600_000),
    });
    await insertMembership(deps.db, ws, {
      accountId: account.id,
      role: o.role ?? 'operator',
      state: o.state ?? 'active',
    });
    return { accountId: account.id, cookies: { session: session.token } };
  }

  /** A workspace with a connected bot (scripted on the fake) and one operator signed in. */
  async function workspace(name: string, operatorName = 'Olga Operator') {
    const ws = await insertWorkspace(deps.db, name);
    touched.push(ws);
    const { bot, token, webhookSecret } = await insertBot(deps.db, { workspaceId: ws });
    fake.bot(token).script({});
    const hook = { id: bot.id, secret: webhookSecret! };
    const operator = await person(ws, { name: operatorName });
    return { ws, token, hook, operator, base: `/api/workspaces/${ws}/inbox` };
  }
  type W = Awaited<ReturnType<typeof workspace>>;

  const get = (who: Person | null, url: string) =>
    app.inject({ method: 'GET', url, cookies: who?.cookies });
  const post = (who: Person | null, url: string, payload: object = {}) =>
    app.inject({ method: 'POST', url, cookies: who?.cookies, payload });

  const write = (
    hook: { id: string; secret: string },
    fromId: number,
    messageId: number,
    text: string,
    date = nowS(),
  ) =>
    signedDelivery(
      app,
      hook,
      telegramUpdate({ updateId: nextUpdate++, messageId, date, fromId, text }),
    );

  const list = async (w: W, query = '', who: Person = w.operator) => {
    const res = await get(who, `${w.base}/conversations${query}`);
    expect(res.statusCode).toBe(200);
    return ConversationPage.parse(res.json());
  };
  const summary = async (w: W, conv: string, who: Person = w.operator) => {
    const res = await get(who, `${w.base}/conversations/${conv}`);
    expect(res.statusCode).toBe(200);
    return ConversationSummary.parse(res.json());
  };
  const thread = async (w: W, conv: string) => {
    const res = await get(w.operator, `${w.base}/conversations/${conv}/items`);
    expect(res.statusCode).toBe(200);
    return ThreadPage.parse(res.json());
  };
  const activitiesOf = async (w: W, conv: string) =>
    (await thread(w, conv)).items.flatMap((i) => (i.type === 'activity' ? [i] : []));

  /** The first customer message of a fresh customer: the conversation id. */
  async function customer(w: W, fromId: number, text = 'Do you have tulips?') {
    expect((await write(w.hook, fromId, 1, text)).statusCode).toBe(200);
    const row = await deps.db
      .selectFrom('conversations')
      .select('id')
      .where('workspace_id', '=', w.ws)
      .where('telegram_chat_id', '=', String(fromId) as never)
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async function assign(w: W, who: Person, conv: string, to: Person) {
    const s = await summary(w, conv, who);
    const res = await post(who, `${w.base}/conversations/${conv}/assign`, {
      assignee_account_id: to.accountId,
      expected_state_version: s.state_version,
    });
    expect(res.statusCode).toBe(200);
    return ConversationStateChange.parse(res.json());
  }
  /** Closes with the snapshot the caller last saw; the confirm flag acknowledges any early close. */
  async function close(w: W, who: Person, conv: string) {
    const s = await summary(w, conv, who);
    const res = await post(who, `${w.base}/conversations/${conv}/close`, {
      expected_state_version: s.state_version,
      expected_close_snapshot: s.close_snapshot,
      confirm_close_reasons: true,
    });
    expect(res.statusCode).toBe(200);
    return ConversationStateChange.parse(res.json());
  }

  async function openSocket(w: W, who: Person) {
    const socket = await app.injectWS(`${w.base}/live`, {
      headers: { origin: ORIGIN, cookie: `session=${who.cookies.session}` },
    });
    sockets.push(socket);
    const frames: LiveFrame[] = [];
    socket.on('message', (data: Buffer) => frames.push(LiveFrame.parse(JSON.parse(String(data)))));
    return frames;
  }
  const activityFrames = (frames: LiveFrame[], conv: string) =>
    frames.flatMap((f) =>
      f.type === 'conversation.changed' && f.conversation_id === conv && f.item?.type === 'activity'
        ? [{ ...f, item: f.item }]
        : [],
    );

  const stateOf = (id: string) =>
    deps.db
      .selectFrom('replies')
      .select(['state', 'failure_reason'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  const settled = (id: string, timeout = 15_000) =>
    vi.waitFor(async () => expect((await stateOf(id)).state).not.toBe('sending'), {
      timeout,
      interval: 100,
    });
  const reply = (w: W, conv: string, text: string, lastSeen: string | null = null) =>
    post(w.operator, `${w.base}/conversations/${conv}/replies`, {
      client_key: newId(),
      body: text,
      last_seen_reply_id: lastSeen,
    });

  it('story 1 — a closed, assigned conversation reopens when the customer writes; an edit does not; a late redelivery does (AC-07)', async () => {
    const w = await workspace('Acme Flowers');
    const mate = await person(w.ws, { name: 'Tim Teammate' });
    const mateFrames = await openSocket(w, mate);
    // A socket of another workspace must hear nothing of this one.
    const other = await workspace('Bolt Bikes');
    const otherFrames = await openSocket(other, other.operator);

    const conv = await customer(w, 910101);
    await assign(w, w.operator, conv, w.operator);
    const closed = await close(w, w.operator, conv);
    expect(closed.conversation).toMatchObject({ status: 'closed' });
    expect((await list(w)).items).toHaveLength(0);
    expect((await list(w, '?status=closed')).items.map((c) => c.id)).toEqual([conv]);

    // The customer writes again: reopened by arrival, same assignee, unread and waiting.
    expect((await write(w.hook, 910101, 2, 'Hello? Anyone there?')).statusCode).toBe(200);
    const reopened = (await list(w)).items;
    expect(reopened.map((c) => c.id)).toEqual([conv]);
    expect(reopened[0]).toMatchObject({
      status: 'open',
      assignee: { account_id: w.operator.accountId },
      unread_count: 2,
      waiting_for_reply: true,
    });
    expect((await list(w, '?status=closed')).items).toHaveLength(0);
    // The teammate sees it under the whole-team lens without reloading: the activity frame arrived.
    await vi.waitFor(() =>
      expect(activityFrames(mateFrames, conv).length).toBeGreaterThanOrEqual(3),
    );
    const lines = await activitiesOf(w, conv);
    expect(lines.map((a) => [a.kind, a.cause])).toEqual([
      ['assigned', 'member'],
      ['closed', 'member'],
      ['reopened', 'customer_wrote'],
    ]);
    expect(lines.at(-1)).toMatchObject({ actor: null });
    const frame = activityFrames(mateFrames, conv).at(-1)!;
    expect(frame).toMatchObject({ type: 'conversation.changed', change: 'created' });
    const frameActivity = ThreadActivity.parse(
      (await get(mate, `${w.base}/conversations/${conv}/activities/${frame.item.id}`)).json(),
    );
    expect(frameActivity).toMatchObject({ kind: 'reopened', cause: 'customer_wrote' });

    // Close again: an edit of an earlier message stays closed and adds no line.
    await close(w, w.operator, conv);
    const before = (await activitiesOf(w, conv)).length;
    await signedDelivery(
      app,
      w.hook,
      telegramEdit({
        updateId: nextUpdate++,
        messageId: 1,
        date: nowS(),
        fromId: 910101,
        text: 'Do you have red tulips?',
        editDate: nowS() + 1,
      }),
    );
    expect((await summary(w, conv)).status).toBe('closed');
    expect(await activitiesOf(w, conv)).toHaveLength(before);

    // A late redelivery (dated an hour ago) reopens by its arrival and keeps its earlier place.
    expect((await write(w.hook, 910101, 3, 'Late one', nowS() - 3600)).statusCode).toBe(200);
    expect((await summary(w, conv)).status).toBe('open');
    const items = (await thread(w, conv)).items;
    const late = items.findIndex((i) => i.type === 'message' && i.body === 'Late one');
    const lastClose = items.findLastIndex((i) => i.type === 'activity' && i.kind === 'closed');
    expect(late).toBeGreaterThanOrEqual(0);
    expect(late).toBeLessThan(lastClose);
    const lastLine = items.at(-1)!;
    expect(lastLine).toMatchObject({ type: 'activity', kind: 'reopened', cause: 'customer_wrote' });
    const closeLine = items[lastClose]! as ThreadActivity;
    expect(Date.parse((lastLine as ThreadActivity).position_at)).toBeGreaterThanOrEqual(
      Date.parse(closeLine.position_at),
    );

    expect(otherFrames.filter((f) => f.workspace_id === w.ws)).toEqual([]);
    expect(otherFrames.filter((f) => f.type === 'conversation.changed')).toEqual([]);
  }, 30_000);

  const replyOutcomeStory = async (
    answer: ReturnType<typeof sendAnswers.blocked>,
    expectedState: 'not_delivered' | 'not_confirmed',
  ) => {
    const w = await workspace('Acme Flowers');
    const mate = await person(w.ws, { name: 'Tim Teammate' });
    const mateFrames = await openSocket(w, mate);
    const conv = await customer(w, 910201);
    await assign(w, w.operator, conv, mate);

    // Reply A holds the drain, so reply B stays "sending" while the conversation is closed.
    fake.bot(w.token).script({ sendMessage: [sendAnswers.hang(3000), answer] });
    const a = ThreadReply.parse((await reply(w, conv, 'First')).json());
    const b = ThreadReply.parse((await reply(w, conv, 'Second', a.id)).json());
    const seen = await summary(w, conv);
    expect(seen.close_snapshot.latest_reply).toEqual({ id: b.id, state: 'sending' });
    await close(w, w.operator, conv);
    expect((await summary(w, conv)).status).toBe('closed');

    await settled(b.id, 40_000);
    expect((await stateOf(b.id)).state).toBe(expectedState);
    const after = await summary(w, conv);
    expect(after).toMatchObject({
      status: 'open',
      assignee: { account_id: mate.accountId },
    });
    expect((await list(w)).items.map((c) => c.id)).toEqual([conv]);
    const lines = await activitiesOf(w, conv);
    expect(lines.map((x) => [x.kind, x.cause])).toEqual([
      ['assigned', 'member'],
      ['closed', 'member'],
      ['reopened', 'reply_not_delivered'],
    ]);
    await vi.waitFor(() =>
      expect(activityFrames(mateFrames, conv).length).toBeGreaterThanOrEqual(3),
    );
  };

  it('story 2 — a reply that ends not delivered after the close reopens the conversation with its assignee (AC-08)', async () => {
    await replyOutcomeStory(sendAnswers.blocked(), 'not_delivered');
  }, 60_000);

  it('story 2b — a reply of unknown outcome after the close reopens it the same way (AC-08)', async () => {
    await replyOutcomeStory(sendAnswers.resetAfterWrite(), 'not_confirmed');
  }, 90_000);

  it('story 3 — deactivating an assignee unassigns their open and closed conversations, in this workspace only (AC-10)', async () => {
    const w = await workspace('Acme Flowers');
    const owner = await person(w.ws, { name: 'Olga Owner', role: 'owner' });
    const pat = await person(w.ws, { name: 'Pat Planter' });
    const b = await workspace('Bolt Bikes');
    await insertMembership(deps.db, b.ws, { accountId: pat.accountId });
    const mate = await person(w.ws, { name: 'Tim Teammate' });
    const mateFrames = await openSocket(w, mate);

    const open1 = await customer(w, 910301);
    const closed1 = await customer(w, 910302);
    const kept = await customer(w, 910303);
    const elsewhere = await customer(b, 910304);
    await assign(w, owner, open1, pat);
    await assign(w, owner, closed1, pat);
    await close(w, owner, closed1);
    await assign(w, owner, kept, w.operator);
    await assign(b, pat, elsewhere, pat);

    const membership = await deps.db
      .selectFrom('memberships')
      .select('id')
      .where('workspace_id', '=', w.ws)
      .where('account_id', '=', pat.accountId)
      .executeTakeFirstOrThrow();
    const deactivated = await post(
      owner,
      `/api/workspaces/${w.ws}/memberships/${membership.id}/deactivate`,
    );
    expect(deactivated.statusCode).toBe(200);

    expect((await list(w, '?assignee=unassigned', owner)).items.map((c) => c.id)).toEqual([open1]);
    expect(
      (await list(w, '?status=closed&assignee=unassigned', owner)).items.map((c) => c.id),
    ).toEqual([closed1]);
    for (const conv of [open1, closed1]) {
      const lines = await activitiesOf(w, conv);
      expect(lines.at(-1)).toMatchObject({
        kind: 'unassigned',
        cause: 'member_deactivated',
        actor: null,
        previous_assignee: { account_id: pat.accountId },
        new_assignee: null,
      });
    }
    expect(await summary(w, closed1, owner)).toMatchObject({ status: 'closed', assignee: null });
    // Another assignee of the workspace and the same account's assignment elsewhere stay.
    expect(await summary(w, kept, owner)).toMatchObject({
      assignee: { account_id: w.operator.accountId },
    });
    expect(await summary(b, elsewhere, pat)).toMatchObject({
      assignee: { account_id: pat.accountId },
    });
    // The teammate's open list learns of it without reloading.
    await vi.waitFor(() => expect(activityFrames(mateFrames, open1).length).toBeGreaterThan(1));

    // Reactivating does not give the conversations back.
    expect(
      (await post(owner, `/api/workspaces/${w.ws}/memberships/${membership.id}/reactivate`))
        .statusCode,
    ).toBe(200);
    expect(await summary(w, open1, owner)).toMatchObject({ assignee: null });
    expect((await list(w, '?assignee=unassigned', owner)).items.map((c) => c.id)).toEqual([open1]);
    // The active-member list no longer offers a deactivated member's old state wrongly: Pat is back.
    const members = ActiveMemberList.parse((await get(owner, `${w.base}/members`)).json());
    expect(members.items.map((m) => m.account_id)).toContain(pat.accountId);
  }, 30_000);

  it('story 4 — outsider 404, deactivated member 403, signed out 401 on every new route and read; nothing changes (AC-11)', async () => {
    const w = await workspace('Acme Flowers', 'Olga Operator');
    const conv = await customer(w, 910401, 'Secret order');
    const assigned = await assign(w, w.operator, conv, w.operator);
    const activityId = assigned.activity!.id;
    const outsiderWs = await insertWorkspace(deps.db, 'Bolt Bikes');
    touched.push(outsiderWs);
    const outsider = await person(outsiderWs, { name: 'Zed Outsider' });
    const removed = await person(w.ws, { name: 'Rex Removed', state: 'deactivated' });

    const s = await summary(w, conv);
    const c = `${w.base}/conversations/${conv}`;
    const reads = [
      `${w.base}/conversations?assignee=mine`,
      `${w.base}/conversations?status=closed&q=order`,
      c,
      `${c}/items`,
      `${c}/activities/${activityId}`,
      `${w.base}/members`,
    ];
    const writes: [string, object][] = [
      [
        `${c}/assign`,
        { assignee_account_id: outsider.accountId, expected_state_version: s.state_version },
      ],
      [`${c}/unassign`, { expected_state_version: s.state_version }],
      [
        `${c}/close`,
        {
          expected_state_version: s.state_version,
          expected_close_snapshot: s.close_snapshot,
          confirm_close_reasons: true,
        },
      ],
      [`${c}/reopen`, { expected_state_version: s.state_version }],
    ];
    const rowCounts = async () => ({
      conv: await deps.db
        .selectFrom('conversations')
        .select(['status', 'assignee_account_id', 'state_version'])
        .where('id', '=', conv)
        .executeTakeFirstOrThrow(),
      activities: Number(
        (
          await deps.db
            .selectFrom('conversation_activities')
            .select((eb) => eb.fn.countAll().as('n'))
            .executeTakeFirstOrThrow()
        ).n,
      ),
    });
    const before = await rowCounts();
    const expectRefused = (
      res: { statusCode: number; body: string },
      status: number,
      code: string,
      url: string,
    ) => {
      expect(res.statusCode, url).toBe(status);
      expect(ErrorEnvelope.parse(JSON.parse(res.body)).error.code, url).toBe(code);
      for (const secret of ['Secret order', 'Olga Operator', 'Tim Teammate'])
        expect(res.body, url).not.toContain(secret);
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
    // A member of the other workspace cannot reach this conversation through their own workspace.
    const foreign = `/api/workspaces/${outsiderWs}/inbox/conversations/${conv}`;
    expectRefused(await get(outsider, foreign), 404, 'NOT_FOUND', foreign);
    expectRefused(
      await get(outsider, `${foreign}/activities/${activityId}`),
      404,
      'NOT_FOUND',
      foreign,
    );
    expectRefused(
      await post(outsider, `${foreign}/unassign`, { expected_state_version: s.state_version }),
      404,
      'NOT_FOUND',
      foreign,
    );
    // An active operator may not assign to an account of another workspace.
    const refusedAssign = await post(w.operator, `${c}/assign`, {
      assignee_account_id: outsider.accountId,
      expected_state_version: s.state_version,
    });
    expect(refusedAssign.statusCode).toBe(400);
    expect(ErrorEnvelope.parse(refusedAssign.json()).error.code).toBe('ASSIGNEE_NOT_ACTIVE');

    expect(await rowCounts()).toEqual(before);
  }, 30_000);
});
