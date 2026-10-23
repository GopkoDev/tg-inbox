import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AttentionCount,
  ErrorEnvelope,
  IssuedConnectLink,
  LiveFrame,
  MembershipPage,
  NotificationSettings,
} from '@tg/shared';
import { buildApp } from '../app.js';
import { buildDeps, type Deps } from '../deps.js';
import {
  answerText,
  type AnswerKind,
  type CannotConnectReason,
} from '../modules/notifications/domain/answers.js';
import { fixedClock, type FixedClock } from '../platform/clock.js';
import { newId } from '../platform/ids.js';
import { sendAnswers, startFakeTelegram, type FakeTelegram } from '../test/fake-telegram.js';
import { insertAccount, insertSession } from '../test/fixtures/auth.js';
import { fakeBotToken, insertBot } from '../test/fixtures/bots.js';
import { insertContact } from '../test/fixtures/contacts.js';
import { insertConversation } from '../test/fixtures/conversations.js';
import {
  insertConnectLink,
  insertPing,
  insertTelegramLink,
} from '../test/fixtures/notifications.js';
import { signedDelivery, telegramEdit, telegramUpdate } from '../test/fixtures/telegram.js';
import { insertMembership, insertWorkspace } from '../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { integrityViolations, notificationIntegrity, truncateAll } from './helpers.js';

const ORIGIN = 'http://localhost:5173';
const MINUTE = 60_000;
type WebSocket = Awaited<ReturnType<FastifyInstance['injectWS']>>;

/**
 * Operator-notifications end-to-end stories (test-plan §E2E): the real routes, the real webhook,
 * the pg-boss workers and the sweep against Postgres and the fake Bot API. The clock starts at the
 * real time (so queued chain jobs stay close to real time) and the stories move it forward.
 */
describe('operator-notifications end-to-end stories (postgres + pg-boss worker + fake Bot API)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let clock: FixedClock;
  let deps: Deps;
  let app: FastifyInstance;
  let nextUpdate = 1;
  let nextMessage = 1;
  let nextBot = 960000n;
  let nextTelegramUser = 880100;
  let touched: string[] = [];
  let sockets: WebSocket[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    clock = fixedClock(new Date());
    const config = { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot };
    deps = buildDeps(config, { clock });
    app = await buildApp(config, { clock });
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
    clock.set(new Date());
    touched = [];
    sockets = [];
  });
  afterEach(async () => {
    for (const s of sockets) s.terminate();
    // After every story: the eight notification integrity queries (and the earlier two) find no row.
    expect(await integrityViolations(deps.db, touched, clock.now())).toEqual([]);
  });

  const nowS = () => Math.floor(clock.now().getTime() / 1000);
  const panel = () => deps.config.PUBLIC_WEB_URL;

  type Person = { accountId: string; membershipId: string; cookies: { session: string } };

  async function person(
    ws: string,
    o: { name?: string; role?: 'owner' | 'operator'; state?: 'active' | 'deactivated' } = {},
  ): Promise<Person> {
    const account = await insertAccount(deps.db, { displayName: o.name ?? 'Olga Operator' });
    const session = await insertSession(deps.db, account.id, {
      createdAt: new Date(clock.now().getTime() - 3_600_000),
    });
    const m = await insertMembership(deps.db, ws, {
      accountId: account.id,
      role: o.role ?? 'operator',
      state: o.state ?? 'active',
    });
    return { accountId: account.id, membershipId: m.id, cookies: { session: session.token } };
  }

  /** A workspace with a connected bot (scripted on the fake), an owner and one operator. */
  async function workspace(name = 'Acme Flowers') {
    const ws = await insertWorkspace(deps.db, name);
    touched.push(ws);
    const { bot, token, webhookSecret } = await insertBot(deps.db, {
      workspaceId: ws,
      username: `bot_${ws.slice(-8)}`,
    });
    fake.bot(token).script({});
    return {
      ws,
      name,
      token,
      bot,
      hook: { id: bot.id, secret: webhookSecret! },
      owner: await person(ws, { name: 'Olga Owner', role: 'owner' }),
      operator: await person(ws, { name: 'Oleh Operator' }),
    };
  }
  type W = Awaited<ReturnType<typeof workspace>>;

  const call = (who: Person | null, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, cookies: who?.cookies, ...(payload && { payload }) });
  const api = (w: W, tail: string) => `/api/workspaces/${w.ws}/${tail}`;

  const settingsOf = async (w: W, who: Person) => {
    const res = await call(who, 'GET', api(w, 'notifications'));
    expect(res.statusCode).toBe(200);
    return NotificationSettings.parse(res.json());
  };

  async function issue(w: W, who: Person) {
    const res = await call(who, 'POST', api(w, 'notifications/telegram/connect-link'));
    expect(res.statusCode).toBe(201);
    const issued = IssuedConnectLink.parse(res.json());
    return `/start ${new URL(issued.url).searchParams.get('start')}`;
  }

  const FROM = (id: number) => ({
    first_name: 'Maria',
    last_name: 'Stone',
    username: `maria_${id}`,
  });
  const deliver = (w: W, fromId: number, text: string, kind = 'text') =>
    signedDelivery(
      app,
      w.hook,
      telegramUpdate({
        updateId: nextUpdate++,
        messageId: nextMessage++,
        date: nowS(),
        fromId,
        text,
        kind,
        from: FROM(fromId),
      }),
    );

  /** Every text the fake recorded for this Telegram chat on this workspace's bot. */
  const sentTo = (w: W, tgId: number) =>
    fake
      .calls(w.token)
      .filter((c) => c.method === 'sendMessage' && c.params.chat_id === tgId)
      .map((c) => String(c.params.text));
  const answerFor = (w: W, kind: AnswerKind, reason?: CannotConnectReason) =>
    answerText(kind, {
      workspaceName: w.name,
      workspaceId: w.ws,
      panelUrl: panel(),
      ...(reason && { reason }),
    });
  const waitFor = (fn: () => void | Promise<void>) =>
    vi.waitFor(fn, { timeout: 15_000, interval: 50 });

  /** Connect → webhook start → the `connected` answer: the member is linked with `tgId`. */
  async function connect(w: W, who: Person, tgId = nextTelegramUser++) {
    expect((await deliver(w, tgId, await issue(w, who))).statusCode).toBe(200);
    await waitFor(() => expect(sentTo(w, tgId)).toContain(answerFor(w, 'connected')));
    return tgId;
  }

  const countsOf = async (ws: string) => {
    const n = async (table: 'contacts' | 'conversations' | 'messages') =>
      Number(
        (
          await deps.db
            .selectFrom(table)
            .select((eb) => eb.fn.countAll().as('n'))
            .where('workspace_id', '=', ws)
            .executeTakeFirstOrThrow()
        ).n,
      );
    return {
      contacts: await n('contacts'),
      conversations: await n('conversations'),
      messages: await n('messages'),
    };
  };
  const liveLinks = (ws: string) =>
    deps.db
      .selectFrom('telegram_links')
      .selectAll()
      .where('workspace_id', '=', ws)
      .where('removed_at', 'is', null)
      .execute();

  async function openSocket(w: W, who: Person) {
    const socket = await app.injectWS(api(w, 'inbox/live'), {
      headers: { origin: ORIGIN, cookie: `session=${who.cookies.session}` },
    });
    sockets.push(socket);
    const frames: LiveFrame[] = [];
    socket.on('message', (data: Buffer) => frames.push(LiveFrame.parse(JSON.parse(String(data)))));
    return { socket, frames };
  }

  /** A customer's first message through the webhook: the conversation id. */
  async function customerWrites(w: W, fromId: number, text = 'Do you have tulips?') {
    expect((await deliver(w, fromId, text)).statusCode).toBe(200);
    return (
      await deps.db
        .selectFrom('conversations')
        .select('id')
        .where('workspace_id', '=', w.ws)
        .where('telegram_chat_id', '=', String(fromId) as never)
        .executeTakeFirstOrThrow()
    ).id;
  }
  const sweep = (w: W) => deps.sendPings.runSweep(w.ws);
  const pingsOf = (w: W, tgId: number) =>
    sentTo(w, tgId).filter((t) => t.includes('/inbox') && !t.startsWith('This chat only'));
  const teamOf = async (w: W) => {
    const res = await call(w.owner, 'GET', api(w, 'memberships'));
    expect(res.statusCode).toBe(200);
    return {
      body: res.body,
      byId: new Map(MembershipPage.parse(res.json()).items.map((m) => [m.id, m.telegram_pings])),
    };
  };

  it('story 1 — connect through a webhook start, the answer, the live panel, Team on/off, disconnect (AC-04, AC-12)', async () => {
    const w = await workspace();
    const mate = await person(w.ws, { name: 'Tim Teammate' });
    const mine = await openSocket(w, w.operator);
    const theirs = await openSocket(w, mate);
    expect(await settingsOf(w, w.operator)).toMatchObject({
      telegram: { state: 'not_connected' },
      can_connect: true,
      caller_role: 'operator',
    });

    const tgId = await connect(w, w.operator);
    const connected = await settingsOf(w, w.operator);
    expect(connected).toMatchObject({
      telegram: { state: 'connected', display_name: 'Maria Stone', pings: 'on', blocked_at: null },
      can_connect: false,
    });
    expect(connected.telegram).toMatchObject({ linked_at: expect.any(String) });
    // The member's own tabs hear it; a teammate's tabs do not.
    await waitFor(() =>
      expect(mine.frames.some((f) => f.type === 'telegram_link.changed')).toBe(true),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(theirs.frames.filter((f) => f.type === 'telegram_link.changed')).toEqual([]);
    // The start created no contact or conversation and nothing shows in the inbox.
    expect(await countsOf(w.ws)).toEqual({ contacts: 0, conversations: 0, messages: 0 });
    const inbox = await call(w.operator, 'GET', api(w, 'inbox/conversations'));
    expect(inbox.json().items).toEqual([]);

    // The owner sees on/off per member and never the Telegram account.
    const team = await teamOf(w);
    expect(team.byId.get(w.operator.membershipId)).toBe(true);
    expect(team.byId.get(mate.membershipId)).toBe(false);
    expect(team.byId.get(w.owner.membershipId)).toBe(false);
    for (const secret of ['Maria', String(tgId)]) expect(team.body).not.toContain(secret);
    // The owner's own settings are the owner's: no way to see or remove the operator's link.
    expect((await settingsOf(w, w.owner)).telegram).toEqual({ state: 'not_connected' });
    const byOwner = await call(w.owner, 'POST', api(w, 'notifications/telegram/disconnect'));
    expect(byOwner.statusCode).toBe(200);
    expect(await liveLinks(w.ws)).toHaveLength(1);

    // Disconnect: removed at once, told in the chat, the Telegram id cleared once the job ran.
    const off = await call(w.operator, 'POST', api(w, 'notifications/telegram/disconnect'));
    expect(NotificationSettings.parse(off.json())).toMatchObject({
      telegram: { state: 'not_connected' },
      can_connect: true,
    });
    await waitFor(() => expect(sentTo(w, tgId)).toContain(answerFor(w, 'notifications_off')));
    await waitFor(async () => {
      const row = await deps.db
        .selectFrom('telegram_links')
        .select(['telegram_user_id', 'display_name'])
        .where('workspace_id', '=', w.ws)
        .where('account_id', '=', w.operator.accountId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ telegram_user_id: null, display_name: null });
    });
    expect((await teamOf(w)).byId.get(w.operator.membershipId)).toBe(false);
    // A second Disconnect changes nothing and sends nothing.
    const sends = sentTo(w, tgId).length;
    expect(
      (await call(w.operator, 'POST', api(w, 'notifications/telegram/disconnect'))).statusCode,
    ).toBe(200);
    expect(sentTo(w, tgId)).toHaveLength(sends);
  }, 60_000);

  it('story 2 — every redeem refusal answers in the chat and links nothing (AC-05, AC-06)', async () => {
    const w = await workspace();
    const a = await person(w.ws, { name: 'Anna A' });
    const b = await person(w.ws, { name: 'Boris B' });
    const [tgA, tgB, tgX, tgY] = [
      nextTelegramUser++,
      nextTelegramUser++,
      nextTelegramUser++,
      nextTelegramUser++,
    ];
    const expectOnly = async (tgId: number, kind: AnswerKind, reason?: CannotConnectReason) => {
      await waitFor(() => expect(sentTo(w, tgId)).toContain(answerFor(w, kind, reason)));
    };

    // Replaced: the older of two links answers "expired"; the newer still works.
    const older = await issue(w, a);
    const newer = await issue(w, a);
    expect((await deliver(w, tgX, older)).statusCode).toBe(200);
    await expectOnly(tgX, 'link_expired');
    expect(await liveLinks(w.ws)).toHaveLength(0);

    // Expired: past 10 minutes. (Another Telegram user: one refusal of a kind per user a minute.)
    clock.advance(11 * MINUTE);
    expect((await deliver(w, tgY, newer)).statusCode).toBe(200);
    await expectOnly(tgY, 'link_expired');
    expect(await liveLinks(w.ws)).toHaveLength(0);

    // Used: a link works once.
    const once = await issue(w, a);
    expect((await deliver(w, tgA, once)).statusCode).toBe(200);
    await expectOnly(tgA, 'connected');
    // Same Telegram account, same member, a second unused link: "already connected", link used up.
    const spare = await insertConnectLink(deps.db, {
      workspaceId: w.ws,
      accountId: a.accountId,
      createdAt: clock.now(),
    });
    expect((await deliver(w, tgA, `/start ${spare.startPayload}`)).statusCode).toBe(200);
    await expectOnly(tgA, 'already_connected');
    expect((await deliver(w, tgA, `/start ${spare.startPayload}`)).statusCode).toBe(200);
    await waitFor(() =>
      expect(sentTo(w, tgA).filter((t) => t === answerFor(w, 'link_expired')).length).toBe(1),
    );

    // The member is already connected from another Telegram account.
    const other = await insertConnectLink(deps.db, {
      workspaceId: w.ws,
      accountId: a.accountId,
      createdAt: clock.now(),
    });
    expect((await deliver(w, tgX, `/start ${other.startPayload}`)).statusCode).toBe(200);
    await expectOnly(tgX, 'cannot_connect', 'member_linked_elsewhere');

    // A teammate presses Start from the Telegram account that is linked to Anna.
    const mine = await issue(w, b);
    expect((await deliver(w, tgA, mine)).statusCode).toBe(200);
    await expectOnly(tgA, 'cannot_connect', 'telegram_linked_to_teammate');

    // A link of a member deactivated since it was issued.
    const doomed = await issue(w, b);
    const off = await call(w.owner, 'POST', api(w, `memberships/${b.membershipId}/deactivate`));
    expect(off.statusCode).toBe(200);
    expect((await deliver(w, tgB, doomed)).statusCode).toBe(200);
    await expectOnly(tgB, 'link_expired');

    // Through all of it: only Anna is linked, and no refusal captured a contact or a conversation.
    expect((await liveLinks(w.ws)).map((l) => l.account_id)).toEqual([a.accountId]);
    expect(await countsOf(w.ws)).toEqual({ contacts: 0, conversations: 0, messages: 0 });
    expect(await settingsOf(w, a)).toMatchObject({ telegram: { state: 'connected', pings: 'on' } });
    expect((await call(b, 'GET', api(w, 'notifications'))).statusCode).toBe(403);
  }, 90_000);

  it('story 3 — an away member is pinged at 5 minutes; blocked, then recovered (AC-04, AC-10)', async () => {
    const w = await workspace();
    const tgId = await connect(w, w.operator);
    const NAME = 'Zelda Phishing https://evil.example/login';
    const TEXT = 'Please confirm your card number 4111';
    const phish = await insertContact(deps.db, {
      workspaceId: w.ws,
      telegramUserId: 555001n,
      firstName: NAME,
    });
    expect(phish).toBeTruthy();
    const conv1 = await customerWrites(w, 555001, TEXT);

    // Not yet due at 4 minutes, due at 5.
    clock.advance(4 * MINUTE);
    await sweep(w);
    expect(pingsOf(w, tgId)).toEqual([]);
    clock.advance(MINUTE);
    fake.bot(w.token).script({ sendMessage: [sendAnswers.blocked()] });
    await sweep(w);
    // The blocked answer: attempted, counted for the period, never retried; the panel says so.
    await waitFor(async () =>
      expect(await settingsOf(w, w.operator)).toMatchObject({
        telegram: { state: 'connected', pings: 'not_reachable', blocked_at: expect.any(String) },
      }),
    );
    const blocked = await deps.db
      .selectFrom('pings')
      .select('outcome')
      .where('workspace_id', '=', w.ws)
      .execute();
    expect(blocked.map((p) => p.outcome)).toEqual(['blocked']);
    const attempted = fake.calls(w.token).filter((c) => String(c.params.text).includes('/inbox'));
    expect(attempted).toHaveLength(1);
    expect(String(attempted[0]!.params.text)).toContain(`/w/${w.ws}/inbox/${conv1}`);

    // A second customer; 10 minutes after the first attempt a ping goes out and the member recovers.
    clock.advance(MINUTE);
    await customerWrites(w, 555002, 'Second customer text');
    clock.advance(9 * MINUTE);
    await sweep(w);
    clock.advance(5 * MINUTE);
    await sweep(w);
    await waitFor(async () =>
      expect(await settingsOf(w, w.operator)).toMatchObject({
        telegram: { state: 'connected', pings: 'on', blocked_at: null },
      }),
    );
    const pings = fake.calls(w.token).filter((c) => String(c.params.text).includes('/inbox'));
    expect(pings).toHaveLength(2);
    // The first conversation's blocked attempt counts: the second ping carries only the second one.
    expect(String(pings[1]!.params.text)).toContain('/inbox/');
    expect(String(pings[1]!.params.text)).not.toContain(`/inbox/${conv1}`);

    // Ping content: counts and a link only. Never a message text or a contact's name.
    for (const c of fake.calls(w.token)) {
      const text = String(c.params.text ?? '');
      for (const secret of [TEXT, 'Second customer text', NAME, 'Zelda', 'evil.example']) {
        expect(text).not.toContain(secret);
      }
    }
    expect(await liveLinks(w.ws)).toHaveLength(1);
  }, 90_000);

  it('story 4 — a member deactivated while a ping is due gets none, and reactivation restores no link (AC-10)', async () => {
    const w = await workspace();
    const tgId = await connect(w, w.operator);
    await customerWrites(w, 555101);
    clock.advance(5 * MINUTE);

    const off = await call(
      w.owner,
      'POST',
      api(w, `memberships/${w.operator.membershipId}/deactivate`),
    );
    expect(off.statusCode).toBe(200);
    await sweep(w);
    await new Promise((r) => setTimeout(r, 300));
    expect(pingsOf(w, tgId)).toEqual([]);
    const row = await deps.db
      .selectFrom('telegram_links')
      .select(['removed_reason', 'telegram_user_id', 'display_name'])
      .where('workspace_id', '=', w.ws)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      removed_reason: 'deactivated',
      telegram_user_id: null,
      display_name: null,
    });
    expect(
      await deps.db.selectFrom('pings').select('id').where('workspace_id', '=', w.ws).execute(),
    ).toEqual([]);

    const on = await call(
      w.owner,
      'POST',
      api(w, `memberships/${w.operator.membershipId}/reactivate`),
    );
    expect(on.statusCode).toBe(200);
    expect(on.json().telegram_pings).toBe(false);
    expect(await settingsOf(w, w.operator)).toMatchObject({ telegram: { state: 'not_connected' } });
    await sweep(w);
    expect(pingsOf(w, tgId)).toEqual([]);
  }, 60_000);

  it('story 5 — connecting a different bot removes the links made with the old one (AC-10)', async () => {
    const w = await workspace();
    const tgId = await connect(w, w.operator);
    // No customer has written yet: a workspace with history keeps its bot for good.

    // Disconnecting the bot keeps the link (pings pause); only a different bot removes it.
    expect((await call(w.owner, 'POST', api(w, 'bot/disconnect'))).statusCode).toBe(200);
    expect(await liveLinks(w.ws)).toHaveLength(1);
    expect(await settingsOf(w, w.operator)).toMatchObject({
      telegram: { state: 'connected', pings: 'paused' },
    });

    const newToken = fakeBotToken(nextBot++);
    fake.bot(newToken).script({ me: { first_name: 'Second Bot', username: 'second_flowers_bot' } });
    const paste = await call(w.owner, 'POST', api(w, 'bot/token'), {
      token: newToken,
      confirm_takeover: true,
    });
    expect(paste.statusCode).toBe(200);

    expect(await liveLinks(w.ws)).toHaveLength(0);
    const removed = await deps.db
      .selectFrom('telegram_links')
      .select(['removed_reason', 'telegram_user_id'])
      .where('workspace_id', '=', w.ws)
      .executeTakeFirstOrThrow();
    expect(removed).toEqual({ removed_reason: 'bot_replaced', telegram_user_id: null });
    expect(await settingsOf(w, w.operator)).toMatchObject({
      telegram: { state: 'not_connected' },
      can_connect: true,
    });
    // No answer is sent for a link that went with the old bot, and no ping is attempted.
    clock.advance(6 * MINUTE);
    await sweep(w);
    await new Promise((r) => setTimeout(r, 300));
    expect(
      fake.calls().filter((c) => c.method === 'sendMessage' && c.params.chat_id === tgId),
    ).toHaveLength(1);
    expect(
      fake.calls(newToken).filter((c) => c.method === 'sendMessage' && c.params.chat_id === tgId),
    ).toEqual([]);
  }, 60_000);

  it("story 6 — a linked member's messages are not captured, with one notice an hour; after Disconnect they are (AC-11)", async () => {
    const w = await workspace();
    const tgId = await connect(w, w.operator);
    const notice = answerFor(w, 'chat_only_notifications');
    const notices = () => sentTo(w, tgId).filter((t) => t === notice);

    // Text, media, an edit and a campaign start: all consumed.
    expect((await deliver(w, tgId, 'ok')).statusCode).toBe(200);
    expect((await deliver(w, tgId, 'photo caption', 'photo')).statusCode).toBe(200);
    const edit = await signedDelivery(
      app,
      w.hook,
      telegramEdit({
        updateId: nextUpdate++,
        messageId: 1,
        date: nowS(),
        editDate: nowS() + 1,
        fromId: tgId,
        text: 'ok, edited',
        from: FROM(tgId),
      }),
    );
    expect(edit.statusCode).toBe(200);
    expect((await deliver(w, tgId, '/start summer_sale')).statusCode).toBe(200);
    await waitFor(() => expect(notices()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 300));
    expect(notices()).toHaveLength(1);
    expect(await countsOf(w.ws)).toEqual({ contacts: 0, conversations: 0, messages: 0 });

    // An hour later the notice is allowed again.
    clock.advance(61 * MINUTE);
    expect((await deliver(w, tgId, 'still me')).statusCode).toBe(200);
    await waitFor(() => expect(notices()).toHaveLength(2));
    expect(await countsOf(w.ws)).toEqual({ contacts: 0, conversations: 0, messages: 0 });

    // After Disconnect the same person is an ordinary customer again.
    await call(w.operator, 'POST', api(w, 'notifications/telegram/disconnect'));
    await waitFor(() => expect(sentTo(w, tgId)).toContain(answerFor(w, 'notifications_off')));
    expect((await deliver(w, tgId, 'hello as a customer')).statusCode).toBe(200);
    expect(await countsOf(w.ws)).toEqual({ contacts: 1, conversations: 1, messages: 1 });
    expect(notices()).toHaveLength(2);
  }, 60_000);

  it('story 7 — another workspace gets no hint and changes nothing; links do not cross workspaces (AC-12)', async () => {
    const a = await workspace('Acme Flowers');
    const b = await workspace('Bolt Bikes');
    const sharedUser = nextTelegramUser++;
    await connect(a, a.operator, sharedUser);
    await connect(b, b.operator, sharedUser);
    expect(await liveLinks(a.ws)).toHaveLength(1);
    expect(await liveLinks(b.ws)).toHaveLength(1);

    // Bolt's members against Acme's routes: 404 with the same body as an unknown workspace.
    const unknown = api({ ...a, ws: newId() } as W, 'notifications');
    const hidden = await call(b.operator, 'GET', unknown);
    expect(hidden.statusCode).toBe(404);
    for (const [method, tail] of [
      ['GET', 'inbox/attention'],
      ['GET', 'notifications'],
      ['POST', 'notifications/telegram/connect-link'],
      ['POST', 'notifications/telegram/disconnect'],
    ] as const) {
      const res = await call(b.operator, method, api(a, tail));
      expect(res.statusCode, tail).toBe(404);
      expect(ErrorEnvelope.parse(res.json()).error.code).toBe('NOT_FOUND');
      expect(res.body).toBe(hidden.body);
    }
    const team = await call(b.owner, 'GET', api(a, 'memberships'));
    expect(team.statusCode).toBe(404);
    // Nothing of Acme changed, and Bolt's disconnect leaves Acme's link for the same Telegram user.
    expect(await liveLinks(a.ws)).toHaveLength(1);
    await call(b.operator, 'POST', api(b, 'notifications/telegram/disconnect'));
    expect(await liveLinks(b.ws)).toHaveLength(0);
    expect(await liveLinks(a.ws)).toHaveLength(1);
    expect(await settingsOf(a, a.operator)).toMatchObject({ telegram: { state: 'connected' } });
    expect((await teamOf(a)).byId.get(a.operator.membershipId)).toBe(true);
    expect((await teamOf(b)).byId.get(b.operator.membershipId)).toBe(false);
    // The signed-out visitor is sent to sign in.
    expect((await call(null, 'GET', api(a, 'notifications'))).statusCode).toBe(401);
  }, 60_000);

  it('story 8 — a captured customer message reaches a connected socket and the attention count within 3 s (NFR in-web latency)', async () => {
    const w = await workspace();
    const { frames } = await openSocket(w, w.operator);
    const attention = async () => {
      const res = await call(w.operator, 'GET', api(w, 'inbox/attention'));
      expect(res.statusCode).toBe(200);
      return AttentionCount.parse(res.json());
    };
    expect(await attention()).toEqual({ workspace_id: w.ws, count: 0 });

    for (const [i, fromId] of [555301, 555302].entries()) {
      const started = Date.now();
      const seen = frames.length;
      expect((await deliver(w, fromId, `message ${i}`)).statusCode).toBe(200);
      await vi.waitFor(
        () =>
          expect(
            frames
              .slice(seen)
              .some((f) => f.type === 'conversation.changed' && f.change === 'created'),
          ).toBe(true),
        { timeout: 3000, interval: 20 },
      );
      expect((await attention()).count).toBe(i + 1);
      expect(Date.now() - started).toBeLessThan(3000);
    }
    // A teammate's conversation never counts for the operator; the owner counts only unassigned.
    const owner = await call(w.owner, 'GET', api(w, 'inbox/attention'));
    expect(AttentionCount.parse(owner.json()).count).toBe(2);
  }, 60_000);

  describe('integrity queries find what they are meant to find (non-vacuity)', () => {
    const rowsOf = async (run: (ws: string) => Promise<unknown[]>, ws: string) =>
      (await run(ws)).length;

    it('each of the eight queries returns the planted violation, and nothing for a clean workspace', async () => {
      const db = deps.db;
      const w = await workspace('Planted Violations');
      const clean = await workspace('Clean Workspace');
      const asOf = clock.now();
      const q = notificationIntegrity;
      // A clean workspace with a live link, a ping and a waiting conversation: no row anywhere.
      const cleanLink = await insertTelegramLink(db, {
        workspaceId: clean.ws,
        accountId: clean.operator.accountId,
        telegramBotId: clean.bot.telegramBotId,
      });
      const cleanContact = await insertContact(db, { workspaceId: clean.ws });
      const cleanConv = await insertConversation(db, {
        workspaceId: clean.ws,
        contactId: cleanContact,
        waitingSince: asOf,
        waitingStartedBy: 'message',
      });
      await insertPing(db, {
        workspaceId: clean.ws,
        accountId: clean.operator.accountId,
        telegramLinkId: cleanLink.id,
        createdAt: asOf,
        items: [{ conversationId: cleanConv, waitingSince: asOf }],
      });
      expect(await integrityViolations(db, [clean.ws], asOf)).toEqual([]);

      // 1. a ping to a member who was deactivated before it
      const gone = await person(w.ws, { name: 'Gone G', state: 'deactivated' });
      await db
        .updateTable('memberships')
        .set({ deactivated_at: new Date(asOf.getTime() - 3_600_000) })
        .where('id', '=', gone.membershipId)
        .execute();
      const goneLink = await insertTelegramLink(db, {
        workspaceId: w.ws,
        accountId: gone.accountId,
        telegramBotId: w.bot.telegramBotId,
        linkedAt: new Date(asOf.getTime() - 7_200_000),
        removed: { at: new Date(asOf.getTime() - 3_000_000), reason: 'deactivated' },
      });
      await insertPing(db, {
        workspaceId: w.ws,
        accountId: gone.accountId,
        telegramLinkId: goneLink.id,
        createdAt: asOf,
      });
      expect(await rowsOf((ws) => q.pingsToInactiveMembers(db, ws), w.ws)).toBe(1);
      expect(await rowsOf((ws) => q.pingsToInactiveMembers(db, ws), clean.ws)).toBe(0);

      // 3. two pings to one member, 1 minute apart
      const link = await insertTelegramLink(db, {
        workspaceId: w.ws,
        accountId: w.operator.accountId,
        telegramBotId: w.bot.telegramBotId,
        telegramUserId: 990001n,
      });
      const conv = await insertConversation(db, {
        workspaceId: w.ws,
        contactId: await insertContact(db, { workspaceId: w.ws, telegramUserId: 990002n }),
        waitingSince: asOf,
        waitingStartedBy: 'message',
      });
      const base = { workspaceId: w.ws, accountId: w.operator.accountId, telegramLinkId: link.id };
      await insertPing(db, {
        ...base,
        createdAt: asOf,
        items: [{ conversationId: conv, waitingSince: asOf }],
      });
      await insertPing(db, { ...base, createdAt: new Date(asOf.getTime() + MINUTE) });
      expect(await rowsOf((ws) => q.pingsTooClose(db, ws), w.ws)).toBe(1);
      expect(await rowsOf((ws) => q.pingsTooClose(db, ws), clean.ws)).toBe(0);

      // 2. the same conversation and period twice in the ledger. The unique key refuses it at the
      // database, so the key is dropped inside a transaction that is rolled back.
      await expect(
        db.transaction().execute(async (tx) => {
          await tx.schema
            .alterTable('ping_items')
            .dropConstraint('ping_items_conversation_id_waiting_since_account_id_key')
            .execute();
          const second = await insertPing(tx, {
            ...base,
            createdAt: new Date(asOf.getTime() + 20 * MINUTE),
          });
          await tx
            .insertInto('ping_items')
            .values({
              id: newId(),
              workspace_id: w.ws,
              ping_id: second.id,
              account_id: w.operator.accountId,
              conversation_id: conv,
              waiting_since: asOf,
            })
            .execute();
          expect(await rowsOf((ws) => q.duplicateLedgerItems(tx, ws), w.ws)).toBe(1);
          expect(await rowsOf((ws) => q.duplicateLedgerItems(tx, ws), clean.ws)).toBe(0);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await rowsOf((ws) => q.duplicateLedgerItems(db, ws), w.ws)).toBe(0);

      // 4. a contact that is the linked member's Telegram account
      await insertContact(db, { workspaceId: w.ws, telegramUserId: 990001n });
      expect(await rowsOf((ws) => q.contactsOfLinkedMembers(db, ws), w.ws)).toBe(1);
      expect(await rowsOf((ws) => q.contactsOfLinkedMembers(db, ws), clean.ws)).toBe(0);

      // 5. a live link made with another bot
      const other = await person(w.ws, { name: 'Other O' });
      await insertTelegramLink(db, {
        workspaceId: w.ws,
        accountId: other.accountId,
        telegramBotId: 424242n,
      });
      expect(await rowsOf((ws) => q.linksOfAnotherBot(db, ws), w.ws)).toBe(1);
      expect(await rowsOf((ws) => q.linksOfAnotherBot(db, ws), clean.ws)).toBe(0);

      // 6. a live link of a deactivated member
      const stale = await person(w.ws, { name: 'Stale S', state: 'deactivated' });
      await insertTelegramLink(db, {
        workspaceId: w.ws,
        accountId: stale.accountId,
        telegramBotId: w.bot.telegramBotId,
      });
      expect(await rowsOf((ws) => q.liveLinksOfInactiveMembers(db, ws), w.ws)).toBe(1);
      expect(await rowsOf((ws) => q.liveLinksOfInactiveMembers(db, ws), clean.ws)).toBe(0);

      // 7. a member-removed link that kept its Telegram id for over an hour
      const lingering = await person(w.ws, { name: 'Lingering L' });
      await insertTelegramLink(db, {
        workspaceId: w.ws,
        accountId: lingering.accountId,
        telegramBotId: w.bot.telegramBotId,
        telegramUserId: 990003n,
        linkedAt: new Date(asOf.getTime() - 10_800_000),
        removed: { at: new Date(asOf.getTime() - 7_200_000), reason: 'member' },
      });
      expect(await rowsOf((ws) => q.memberRemovedLinksHoldingId(db, ws, asOf), w.ws)).toBe(1);
      expect(await rowsOf((ws) => q.memberRemovedLinksHoldingId(db, ws, asOf), clean.ws)).toBe(0);
      // Within the hour it is not (yet) a violation.
      expect(
        await rowsOf(
          (ws) => q.memberRemovedLinksHoldingId(db, ws, new Date(asOf.getTime() - 4_000_000)),
          w.ws,
        ),
      ).toBe(0);

      // 8. an open conversation that waits by the marker but has no period
      await insertConversation(db, {
        workspaceId: w.ws,
        contactId: await insertContact(db, { workspaceId: w.ws, telegramUserId: 990004n }),
      });
      expect(await rowsOf((ws) => q.waitingWithoutPeriod(db, ws), w.ws)).toBe(1);
      expect(await rowsOf((ws) => q.waitingWithoutPeriod(db, ws), clean.ws)).toBe(0);

      expect(new Set((await integrityViolations(db, [w.ws], asOf)).map((v) => v.check))).toEqual(
        new Set([
          'pings-to-inactive-members',
          'pings-less-than-10-min-apart',
          'contacts-of-linked-members',
          'links-of-another-bot',
          'live-links-of-inactive-members',
          'member-removed-links-holding-id',
          'waiting-without-period',
        ]),
      );
      touched = [];
    });
  });
});
