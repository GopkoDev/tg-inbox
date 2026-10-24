import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AttentionCount,
  Broadcast,
  BroadcastDraft,
  BroadcastGroupMatching,
  BroadcastGroupMatchingAdded,
  BroadcastGroupPage,
  BroadcastLaunched,
  BroadcastRecipientPage,
  BroadcastStopped,
  ContactPage,
  ContactProfile,
  ConversationStateChange,
  ConversationSummary,
  ErrorEnvelope,
  LaunchConfirmation,
  LiveFrame,
  ThreadBroadcastItem,
  ThreadPage,
  type LaunchedBroadcast,
} from '@tg/shared';
import { buildApp } from '../app.js';
import { buildDeps, type Deps } from '../deps.js';
import { sendAnswers, startFakeTelegram, type FakeTelegram } from '../test/fake-telegram.js';
import { insertAccount, insertSession } from '../test/fixtures/auth.js';
import { insertBot } from '../test/fixtures/bots.js';
import { insertBroadcast, launchBroadcastFixture } from '../test/fixtures/broadcasts.js';
import { insertTelegramLink } from '../test/fixtures/notifications.js';
import { signedDelivery, telegramMyChatMember, telegramUpdate } from '../test/fixtures/telegram.js';
import { insertMembership, insertWorkspace } from '../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../test/postgres.js';
import { integrityViolations, truncateAll } from './helpers.js';

const ORIGIN = 'http://localhost:5173';
const TEXT = 'New prices from Monday.';
type WebSocket = Awaited<ReturnType<FastifyInstance['injectWS']>>;

/**
 * Broadcasts end-to-end stories (test-plan §E2E, T27): the real routes, the real webhook, the
 * real sending chain on pg-boss, the live socket and the fake Bot API against Postgres. After every
 * story the integrity queries (`broadcastIntegrity` among them) of every touched workspace find no
 * row.
 */
describe('broadcasts end-to-end stories (postgres + pg-boss chain + fake Bot API + live socket)', () => {
  let database: TestDatabase;
  let fake: FakeTelegram;
  let deps: Deps;
  let app: FastifyInstance;
  let nextUpdate = 1;
  let nextMessage = 1;
  let touched: string[] = [];
  let sockets: WebSocket[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    fake = await startFakeTelegram();
    const config = { ...testConfig(database.url), TELEGRAM_API_ROOT: fake.apiRoot };
    deps = buildDeps(config);
    app = await buildApp(config);
    await app.ready();
  }, 120_000);
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
    expect(await integrityViolations(deps.db, touched)).toEqual([]);
  });

  type Person = { accountId: string; name: string; cookies: { session: string } };
  const nowS = () => Math.floor(Date.now() / 1000);

  async function person(
    ws: string,
    o: { name: string; role?: 'owner' | 'operator' },
  ): Promise<Person> {
    const account = await insertAccount(deps.db, { displayName: o.name });
    const session = await insertSession(deps.db, account.id, {
      createdAt: new Date(Date.now() - 3_600_000),
    });
    await insertMembership(deps.db, ws, { accountId: account.id, role: o.role ?? 'operator' });
    return { accountId: account.id, name: o.name, cookies: { session: session.token } };
  }

  /** "Acme Flowers": a connected bot (scripted on the fake), two owners and an operator. */
  async function workspace(name = 'Acme Flowers') {
    const ws = await insertWorkspace(deps.db, name);
    touched.push(ws);
    const { bot, token, webhookSecret } = await insertBot(deps.db, { workspaceId: ws });
    fake.bot(token).script({});
    return {
      ws,
      token,
      telegramBotId: bot.telegramBotId,
      hook: { id: bot.id, secret: webhookSecret! },
      owner: await person(ws, { name: 'Olga Owner', role: 'owner' }),
      coOwner: await person(ws, { name: 'Petro Partner', role: 'owner' }),
      operator: await person(ws, { name: 'Oleh Operator' }),
    };
  }
  type W = Awaited<ReturnType<typeof workspace>>;

  const call = (who: Person | null, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, cookies: who?.cookies, ...(payload && { payload }) });
  const api = (w: W, tail: string) => `/api/workspaces/${w.ws}/${tail}`;
  const errorOf = (res: { json: () => unknown }) => ErrorEnvelope.parse(res.json()).error;
  const ok = async <T>(
    schema: { parse: (v: unknown) => T },
    who: Person,
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
  ): Promise<T> => {
    const res = await call(who, method, url, payload);
    expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
    return schema.parse(res.json());
  };

  type Customer = { fromId: number; contactId: string; conversationId: string };
  /** A customer's message through the webhook: the contact and its conversation. */
  async function customerWrites(
    w: W,
    fromId: number,
    text = 'Do you have tulips?',
  ): Promise<Customer> {
    const res = await signedDelivery(
      app,
      w.hook,
      telegramUpdate({
        updateId: nextUpdate++,
        messageId: nextMessage++,
        date: nowS(),
        fromId,
        text,
        from: { first_name: 'Olena', last_name: `K${fromId}`, username: `olena_${fromId}` },
      }),
    );
    expect(res.statusCode).toBe(200);
    const contact = await deps.db
      .selectFrom('contacts')
      .select('id')
      .where('workspace_id', '=', w.ws)
      .where('telegram_user_id', '=', BigInt(fromId) as never)
      .executeTakeFirstOrThrow();
    const conversation = await deps.db
      .selectFrom('conversations')
      .select('id')
      .where('workspace_id', '=', w.ws)
      .where('contact_id', '=', contact.id)
      .executeTakeFirstOrThrow();
    return { fromId, contactId: contact.id, conversationId: conversation.id };
  }
  const customers = async (w: W, fromIds: number[]) => {
    const out: Customer[] = [];
    for (const id of fromIds) out.push(await customerWrites(w, id));
    return out;
  };
  /** A private `my_chat_member` update: `kicked` = she blocked the bot, `member` = unblocked. */
  async function blockNotice(w: W, fromId: number, status: 'kicked' | 'member') {
    const res = await signedDelivery(
      app,
      w.hook,
      telegramMyChatMember({ updateId: nextUpdate++, fromId, date: nowS(), status }),
    );
    expect(res.statusCode).toBe(200);
  }

  async function openSocket(w: W, who: Person) {
    const socket = await app.injectWS(api(w, 'inbox/live'), {
      headers: { origin: ORIGIN, cookie: `session=${who.cookies.session}` },
    });
    sockets.push(socket);
    const frames: LiveFrame[] = [];
    const raw: string[] = [];
    socket.on('message', (data: Buffer) => {
      raw.push(String(data));
      frames.push(LiveFrame.parse(JSON.parse(String(data))));
    });
    return { socket, frames, raw };
  }
  const waitFor = (fn: () => void | Promise<void>, timeout = 5_000) =>
    vi.waitFor(fn, { timeout, interval: 50 });

  const tag = async (w: W, who: Person, contactId: string, name: string) => {
    const res = await call(who, 'POST', api(w, `contacts/${contactId}/tags`), {
      name,
      source: 'profile',
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { tag: { id: string } }).tag.id;
  };
  const untag = async (w: W, who: Person, contactId: string, tagId: string) => {
    const res = await call(who, 'POST', api(w, `contacts/${contactId}/tags/${tagId}/remove`), {
      source: 'profile',
    });
    expect(res.statusCode, res.body).toBe(200);
  };
  const profile = (w: W, who: Person, contactId: string) =>
    ok(ContactProfile, who, 'GET', api(w, `contacts/${contactId}`));
  const summary = (w: W, who: Person, conversationId: string) =>
    ok(ConversationSummary, who, 'GET', api(w, `inbox/conversations/${conversationId}`));
  const attention = async (w: W, who: Person) =>
    (await ok(AttentionCount, who, 'GET', api(w, 'inbox/attention'))).count;
  const thread = async (w: W, who: Person, conversationId: string) =>
    (await ok(ThreadPage, who, 'GET', api(w, `inbox/conversations/${conversationId}/items`))).items;

  const draft = (w: W, who: Person, name = 'Spring prices', text = TEXT) =>
    ok(BroadcastDraft, who, 'POST', api(w, 'broadcasts'), { name, text });
  const tagAudience = (
    w: W,
    who: Person,
    d: { id: string; version: number },
    mode: 'any' | 'all' | 'none',
    tagIds: string[] = [],
  ) =>
    ok(BroadcastDraft, who, 'POST', api(w, `broadcasts/${d.id}/audience`), {
      expected_version: d.version,
      kind: 'tags',
      mode,
      tag_ids: tagIds,
      exclude_tag_ids: [],
    });
  const groupAudience = (w: W, who: Person, d: { id: string; version: number }) =>
    ok(BroadcastDraft, who, 'POST', api(w, `broadcasts/${d.id}/audience`), {
      expected_version: d.version,
      kind: 'group',
    });
  const addToGroup = async (w: W, who: Person, id: string, contactId: string) => {
    const res = await call(who, 'POST', api(w, `broadcasts/${id}/group/contacts`), {
      contact_id: contactId,
    });
    expect(res.statusCode, res.body).toBe(200);
  };
  const confirmation = (w: W, who: Person, id: string) =>
    ok(LaunchConfirmation, who, 'GET', api(w, `broadcasts/${id}/launch-confirmation`));
  const launch = (w: W, who: Person, c: LaunchConfirmation) =>
    call(who, 'POST', api(w, `broadcasts/${c.broadcast_id}/launch`), {
      expected_version: c.version,
      fingerprint: c.fingerprint,
    });
  /** Confirmation then launch by `who`; the launched broadcast. */
  async function confirmAndLaunch(w: W, who: Person, id: string) {
    const res = await launch(w, who, await confirmation(w, who, id));
    expect(res.statusCode, res.body).toBe(200);
    const launched = BroadcastLaunched.parse(res.json());
    expect(launched.outcome).toBe('launched');
    return launched.broadcast;
  }
  const read = (w: W, who: Person, id: string) =>
    ok(Broadcast, who, 'GET', api(w, `broadcasts/${id}`));
  /** The launched broadcast once the chain has given every recipient an outcome. */
  async function ended(
    w: W,
    who: Person,
    id: string,
    timeout = 20_000,
  ): Promise<LaunchedBroadcast> {
    let last: Broadcast | undefined;
    await waitFor(async () => {
      last = await read(w, who, id);
      expect(last.status).not.toBe('sending');
      // An ending lets the sends already in flight finish and record their outcome (AC-18).
      expect(last.status !== 'draft' && last.totals).toMatchObject({ waiting: 0, sending: 0 });
    }, timeout);
    if (last!.status === 'draft') throw new Error('a launched broadcast read as a draft');
    return last!;
  }
  const recipients = async (w: W, who: Person, id: string, state?: string) =>
    (
      await ok(
        BroadcastRecipientPage,
        who,
        'GET',
        api(w, `broadcasts/${id}/recipients${state ? `?state=${state}` : ''}`),
      )
    ).items;
  const recipientRows = (w: W, id: string) =>
    deps.db
      .selectFrom('broadcast_recipients')
      .selectAll()
      .where('workspace_id', '=', w.ws)
      .where('broadcast_id', '=', id)
      .orderBy('position')
      .execute();
  const sends = (w: W) => fake.calls(w.token).filter((c) => c.method === 'sendMessage');
  const sentChats = (w: W) => sends(w).map((c) => String(c.params.chat_id));
  /** The broadcast's sends (a linked member may also get the bot's own notices). */
  const broadcastSends = (w: W, text = TEXT) => sends(w).filter((c) => c.params.text === text);
  const chatsOf = (cs: Customer[]) => cs.map((c) => String(c.fromId));
  const sorted = (xs: string[]) => [...xs].sort();
  const groupOf = async (w: W, who: Person, id: string) =>
    (await ok(BroadcastGroupPage, who, 'GET', api(w, `broadcasts/${id}/group`))).items.map(
      (r) => r.contact.id,
    );
  const pings = async (w: W) =>
    Number(
      (
        await deps.db
          .selectFrom('pings')
          .select((eb) => eb.fn.countAll().as('n'))
          .where('workspace_id', '=', w.ws)
          .executeTakeFirstOrThrow()
      ).n,
    );

  it('story 1 — a tag audience is drafted, confirmed, launched and sent once to each reachable customer; the report, the thread and the socket tell it (AC-06, AC-11, AC-14, AC-16, AC-17)', async () => {
    const w = await workspace();
    const [olena, maria, taras, ivan] = await customers(w, [810001, 810002, 810003, 810004]);
    const vip = await tag(w, w.operator, olena!.contactId, 'VIP');
    await tag(w, w.operator, maria!.contactId, 'VIP');
    await tag(w, w.operator, taras!.contactId, 'VIP');
    // Taras blocked the bot: counted, left out of the launch.
    await blockNotice(w, taras!.fromId, 'kicked');
    // A member's own Telegram account linked for pings: its block notice and its messages are
    // never a contact, so never a recipient.
    const memberTelegramId = 810099;
    await insertTelegramLink(deps.db, {
      workspaceId: w.ws,
      accountId: w.coOwner.accountId,
      telegramBotId: w.telegramBotId,
      telegramUserId: BigInt(memberTelegramId),
    });
    await blockNotice(w, memberTelegramId, 'kicked');
    await blockNotice(w, memberTelegramId, 'member');
    await signedDelivery(
      app,
      w.hook,
      telegramUpdate({
        updateId: nextUpdate++,
        messageId: nextMessage++,
        date: nowS(),
        fromId: memberTelegramId,
        text: 'hi',
      }),
    );
    // Olena's conversation is closed and unassigned before the broadcast reaches her (AC-16).
    const before = await summary(w, w.operator, olena!.conversationId);
    const closed = await ok(
      ConversationStateChange,
      w.operator,
      'POST',
      api(w, `inbox/conversations/${olena!.conversationId}/close`),
      {
        expected_state_version: before.state_version,
        expected_close_snapshot: before.close_snapshot,
        confirm_close_reasons: true,
      },
    );
    expect(closed.conversation.status).toBe('closed');

    const live = await openSocket(w, w.operator);
    const created = await draft(w, w.operator);
    const withTags = await tagAudience(w, w.operator, created, 'any', [vip]);
    expect(withTags.breakdown).toEqual({
      audience_size: 3,
      reach: { blocked_count: 1, never_wrote_count: 0, reachable_count: 2 },
    });

    const c = await confirmation(w, w.owner, created.id);
    expect(c).toMatchObject({
      text: TEXT,
      breakdown: { audience_size: 3, blocked_count: 1, never_wrote_count: 0, recipient_count: 2 },
    });
    const conversationsBefore = {
      olena: await summary(w, w.operator, olena!.conversationId),
      maria: await summary(w, w.operator, maria!.conversationId),
    };
    const attentionBefore = await attention(w, w.operator);
    const launchedRes = await launch(w, w.owner, c);
    expect(launchedRes.statusCode, launchedRes.body).toBe(200);
    const launched = BroadcastLaunched.parse(launchedRes.json());
    expect(launched).toMatchObject({
      outcome: 'launched',
      broadcast: {
        status: 'sending',
        text: TEXT,
        launched_by: { account_id: w.owner.accountId },
        launch_breakdown: c.breakdown,
      },
    });

    const done = await ended(w, w.operator, created.id);
    expect(done).toMatchObject({
      status: 'sent',
      end_reason: 'completed',
      totals: { waiting: 0, sending: 0, delivered: 2, blocked: 0, failed: 0 },
    });
    expect(done.ended_at).not.toBeNull();
    // One message per recipient, plain text only: no member name, no other recipient (AC-17).
    expect(sorted(broadcastSends(w).map((c) => String(c.params.chat_id)))).toEqual(
      sorted(chatsOf([olena!, maria!])),
    );
    for (const s of broadcastSends(w)) {
      expect(Object.keys(s.params).sort()).toEqual(['chat_id', 'text']);
      expect(s.params.text).toBe(TEXT);
    }
    const report = await recipients(w, w.owner, created.id);
    expect(report.map((r) => [r.contact.id, r.state])).toEqual(
      sorted([olena!.contactId, maria!.contactId]).map((id) => [id, 'delivered']),
    );
    for (const r of report) expect(r.outcome_at).not.toBeNull();
    // The linked member is no contact and no recipient.
    const contactIds = (
      await deps.db
        .selectFrom('contacts')
        .select('telegram_user_id')
        .where('workspace_id', '=', w.ws)
        .execute()
    ).map((r) => String(r.telegram_user_id));
    expect(contactIds).not.toContain(String(memberTelegramId));
    expect(
      sends(w).filter((s) => String(s.params.chat_id) === String(memberTelegramId)),
    ).not.toContainEqual(
      expect.objectContaining({ params: expect.objectContaining({ text: TEXT }) }),
    );

    // The thread shows the broadcast item: name, text, launching owner, delivered (AC-16)…
    for (const who of [olena!, maria!]) {
      const items = (await thread(w, w.operator, who.conversationId)).filter(
        (i) => i.type === 'broadcast',
      );
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        broadcast_id: created.id,
        broadcast_name: 'Spring prices',
        text: TEXT,
        launched_by: { account_id: w.owner.accountId, display_name: 'Olga Owner' },
        state: 'delivered',
      });
      const one = await ok(
        ThreadBroadcastItem,
        w.operator,
        'GET',
        api(w, `inbox/conversations/${who.conversationId}/broadcast-items/${items[0]!.id}`),
      );
      expect(one).toEqual(items[0]);
    }
    // …without reopening, assigning, marking waiting or unread, and with no ping.
    expect(await summary(w, w.operator, olena!.conversationId)).toEqual(conversationsBefore.olena);
    expect(await summary(w, w.operator, maria!.conversationId)).toEqual(conversationsBefore.maria);
    expect(await attention(w, w.operator)).toBe(attentionBefore);
    expect(await pings(w)).toBe(0);

    // The socket told the operator: the launch, the report, the two items; ids only.
    await waitFor(() => {
      const mine = live.frames.filter(
        (f) => f.type === 'broadcast.changed' && f.broadcast_id === created.id,
      );
      expect(mine.map((f) => f.type === 'broadcast.changed' && f.change)).toEqual(
        expect.arrayContaining(['status', 'report']),
      );
      const items = live.frames.filter(
        (f) => f.type === 'conversation.changed' && f.item?.type === 'broadcast',
      );
      expect(
        sorted(items.map((f) => (f.type === 'conversation.changed' ? f.conversation_id : ''))),
      ).toEqual(sorted([olena!.conversationId, maria!.conversationId]));
    });
    for (const frame of live.raw) {
      for (const secret of [TEXT, 'Olena', 'olena_', String(olena!.fromId)]) {
        expect(frame.includes(secret), `a frame carries ${secret}`).toBe(false);
      }
    }

    // After the launch: retags, a new customer and an unblock leave the recipients as frozen (AC-09).
    const frozen = await recipientRows(w, created.id);
    await untag(w, w.operator, olena!.contactId, vip);
    await tag(w, w.operator, ivan!.contactId, 'VIP');
    const newcomer = await customerWrites(w, 810005);
    await tag(w, w.operator, newcomer.contactId, 'VIP');
    await blockNotice(w, taras!.fromId, 'member');
    // Every edit path on the launched broadcast is refused as read-only, and so is delete.
    const b = `broadcasts/${created.id}`;
    const edits: [string, object?][] = [
      [`${b}/save`, { expected_version: c.version, name: 'Hijacked', text: 'Other text' }],
      [
        `${b}/audience`,
        {
          expected_version: c.version,
          kind: 'tags',
          mode: 'none',
          tag_ids: [],
          exclude_tag_ids: [],
        },
      ],
      [`${b}/audience`, { expected_version: c.version, kind: 'group' }],
      [`${b}/group/contacts`, { contact_id: ivan!.contactId }],
      [`${b}/group/contacts/${olena!.contactId}/remove`],
      [`${b}/group/add-matching`, { mode: 'any', tag_ids: [vip], expected_count: 3 }],
      [`${b}/delete`],
    ];
    for (const [tail, payload] of edits) {
      const res = await call(w.owner, 'POST', api(w, tail), payload);
      expect(res.statusCode, tail).toBe(409);
      expect(errorOf(res).code, tail).toBe('BROADCAST_NOT_A_DRAFT');
    }
    expect(await recipientRows(w, created.id)).toEqual(frozen);
    const after = await read(w, w.owner, created.id);
    expect(after).toMatchObject({ name: 'Spring prices', text: TEXT, status: 'sent' });
    expect(after.status !== 'draft' && after.launch_breakdown).toEqual(c.breakdown);
    expect(broadcastSends(w)).toHaveLength(2);

    // Her answer is an ordinary customer message: it reopens the conversation and counts (AC-16).
    await customerWrites(w, olena!.fromId, 'Thanks, how much are tulips?');
    const answered = await summary(w, w.operator, olena!.conversationId);
    expect(answered.status).toBe('open');
    expect(answered.unread_count).toBeGreaterThan(conversationsBefore.olena.unread_count);
    expect(await attention(w, w.operator)).toBeGreaterThan(attentionBefore);
  }, 60_000);

  it('story 2 — a my_chat_member block and a send refused as blocked mark the contact; an unblock and a new message clear it; a group with add-all-matching, and a removal changes nothing on the contact (AC-04, AC-11, AC-14)', async () => {
    const w = await workspace();
    const [olena, maria, petro] = await customers(w, [820001, 820002, 820003]);
    const live = await openSocket(w, w.operator);
    const conversationBefore = await summary(w, w.operator, olena!.conversationId);
    const messagesBefore = await deps.db
      .selectFrom('messages')
      .select('id')
      .where('workspace_id', '=', w.ws)
      .execute();

    // Olena blocks the bot in Telegram.
    await blockNotice(w, olena!.fromId, 'kicked');
    const blocked = await profile(w, w.operator, olena!.contactId);
    expect(blocked.blocked_since).not.toBeNull();
    const row = (await ok(ContactPage, w.operator, 'GET', api(w, 'contacts'))).items.find(
      (r) => r.id === olena!.contactId,
    );
    expect(row?.blocked_since).toBe(blocked.blocked_since);
    await waitFor(() =>
      expect(
        live.frames.some(
          (f) =>
            f.type === 'contact.changed' &&
            f.contact_id === olena!.contactId &&
            f.change === 'reach',
        ),
      ).toBe(true),
    );
    // No customer message, no conversation change, no unread, no ping.
    expect(
      await deps.db.selectFrom('messages').select('id').where('workspace_id', '=', w.ws).execute(),
    ).toEqual(messagesBefore);
    expect(await summary(w, w.operator, olena!.conversationId)).toEqual(conversationBefore);
    expect(await pings(w)).toBe(0);

    // A hand-picked group: Olena and Maria one by one, then everyone matching "Wholesale".
    const wholesale = await tag(w, w.operator, maria!.contactId, 'Wholesale');
    await tag(w, w.operator, petro!.contactId, 'Wholesale');
    const g = await groupAudience(w, w.operator, await draft(w, w.operator, 'Wholesale catch-up'));
    await addToGroup(w, w.operator, g.id, olena!.contactId);
    await addToGroup(w, w.operator, g.id, maria!.contactId);
    const matching = await ok(
      BroadcastGroupMatching,
      w.operator,
      'GET',
      api(w, `broadcasts/${g.id}/group/matching?mode=any&tag=${wholesale}`),
    );
    expect(matching).toMatchObject({
      matching_count: 2,
      already_in_group_count: 1,
      to_add_count: 1,
    });
    const added = await ok(
      BroadcastGroupMatchingAdded,
      w.operator,
      'POST',
      api(w, `broadcasts/${g.id}/group/add-matching`),
      { mode: 'any', tag_ids: [wholesale], expected_count: 1 },
    );
    expect(added).toMatchObject({ added_count: 1, group_size: 3 });
    expect(sorted(await groupOf(w, w.operator, g.id))).toEqual(
      sorted([olena!.contactId, maria!.contactId, petro!.contactId]),
    );
    // Olena is counted unreachable and left out of the launch.
    const c = await confirmation(w, w.owner, g.id);
    expect(c.breakdown).toEqual({
      audience_size: 3,
      blocked_count: 1,
      never_wrote_count: 0,
      recipient_count: 2,
    });

    // Maria blocked the bot meanwhile: Telegram refuses her send as blocked.
    fake.bot(w.token).script({ sendMessage: [sendAnswers.blocked()] });
    const reachFramesBefore = live.frames.length;
    expect((await launch(w, w.owner, c)).statusCode).toBe(200);
    const done = await ended(w, w.owner, g.id);
    expect(done.totals).toMatchObject({ delivered: 1, blocked: 1 });
    const outcomes = await recipients(w, w.owner, g.id);
    const refused = outcomes.find((r) => r.state === 'blocked')!;
    const delivered = outcomes.find((r) => r.state === 'delivered')!;
    expect(sends(w)).toHaveLength(2);
    const marked = await profile(w, w.operator, refused.contact.id);
    expect(marked.blocked_since).not.toBeNull();
    await waitFor(() =>
      expect(
        live.frames
          .slice(reachFramesBefore)
          .some(
            (f) =>
              f.type === 'contact.changed' &&
              f.contact_id === refused.contact.id &&
              f.change === 'reach',
          ),
      ).toBe(true),
    );
    // No broadcast item for the blocked recipient, one for the delivered one (AC-16).
    const conversationOf = (contactId: string) =>
      [olena!, maria!, petro!].find((x) => x.contactId === contactId)!.conversationId;
    expect(
      (await thread(w, w.operator, conversationOf(refused.contact.id))).some(
        (i) => i.type === 'broadcast',
      ),
    ).toBe(false);
    expect(
      (await thread(w, w.operator, conversationOf(delivered.contact.id))).filter(
        (i) => i.type === 'broadcast',
      ),
    ).toHaveLength(1);

    // Olena unblocks, the refused one writes again: both marks are gone, a draft counts them again.
    await blockNotice(w, olena!.fromId, 'member');
    // Telegram dates messages in whole seconds: hers is written in a later second than the block.
    await new Promise((r) => setTimeout(r, 1100));
    await customerWrites(
      w,
      [maria!, petro!].find((x) => x.contactId === refused.contact.id)!.fromId,
      'Sorry, unblocked',
    );
    expect((await profile(w, w.operator, olena!.contactId)).blocked_since).toBeNull();
    expect((await profile(w, w.operator, refused.contact.id)).blocked_since).toBeNull();
    const next = await groupAudience(w, w.operator, await draft(w, w.operator, 'Follow-up'));
    await addToGroup(w, w.operator, next.id, olena!.contactId);
    await addToGroup(w, w.operator, next.id, refused.contact.id);
    const counted = await read(w, w.operator, next.id);
    expect(counted.status === 'draft' && counted.breakdown).toEqual({
      audience_size: 2,
      reach: { blocked_count: 0, never_wrote_count: 0, reachable_count: 2 },
    });

    // Removing Olena from the group changes nothing on her contact (AC-04).
    const profileBefore = await profile(w, w.operator, olena!.contactId);
    const contactRowBefore = await deps.db
      .selectFrom('contacts')
      .selectAll()
      .where('id', '=', olena!.contactId)
      .executeTakeFirstOrThrow();
    const removed = await call(
      w.operator,
      'POST',
      api(w, `broadcasts/${next.id}/group/contacts/${olena!.contactId}/remove`),
    );
    expect(removed.statusCode, removed.body).toBe(200);
    expect(await groupOf(w, w.operator, next.id)).toEqual([refused.contact.id]);
    expect(await profile(w, w.operator, olena!.contactId)).toEqual(profileBefore);
    expect(
      await deps.db
        .selectFrom('contacts')
        .selectAll()
        .where('id', '=', olena!.contactId)
        .executeTakeFirstOrThrow(),
    ).toEqual(contactRowBefore);
  }, 60_000);

  it('story 3 — an owner stops a broadcast mid-send: sends in flight finish, the waiting are stopped, nothing is sent later; an operator cannot stop; "did not reach" copies the stopped (AC-13, AC-18)', async () => {
    const w = await workspace();
    const all = await customers(
      w,
      Array.from({ length: 12 }, (_, i) => 830001 + i),
    );
    // The first 8 sends (all a link keeps in flight) wait 3 s at Telegram.
    fake
      .bot(w.token)
      .script({ sendMessage: Array.from({ length: 8 }, () => sendAnswers.hang(3000)) });
    const d = await tagAudience(w, w.operator, await draft(w, w.operator), 'none');
    expect(d.breakdown.audience_size).toBe(12);
    await confirmAndLaunch(w, w.owner, d.id);
    await waitFor(() => expect(sends(w)).toHaveLength(8), 10_000);

    // An operator has no stop.
    const refused = await call(w.operator, 'POST', api(w, `broadcasts/${d.id}/stop`));
    expect(refused.statusCode).toBe(403);
    expect(errorOf(refused).code).toBe('OWNER_ONLY');

    const stopped = await ok(BroadcastStopped, w.owner, 'POST', api(w, `broadcasts/${d.id}/stop`));
    const stoppedAt = Date.now();
    expect(stopped.outcome).toBe('stopped');
    expect(stopped.broadcast).toMatchObject({
      status: 'stopped',
      end_reason: 'stopped',
      stopped_by: { account_id: w.owner.accountId },
    });
    if (stopped.broadcast.status === 'draft') throw new Error('stopped broadcast read as a draft');
    expect(stopped.broadcast.totals.stopped).toBe(4);

    // The 8 in flight finish and are recorded as delivered; the other 4 stay stopped.
    await waitFor(async () => {
      const b = await read(w, w.owner, d.id);
      expect(b.status !== 'draft' && b.totals).toMatchObject({
        waiting: 0,
        sending: 0,
        delivered: 8,
        stopped: 4,
      });
    }, 10_000);
    await new Promise((r) => setTimeout(r, 1500));
    expect(sends(w)).toHaveLength(8);
    for (const at of fake.sendTimes(w.token)) expect(at).toBeLessThan(stoppedAt);
    const final = await read(w, w.owner, d.id);
    expect(final).toMatchObject({ status: 'stopped', end_reason: 'stopped' });
    const stoppedRecipients = await recipients(w, w.owner, d.id, 'stopped');
    expect(stoppedRecipients).toHaveLength(4);
    // A second stop changes nothing.
    const again = await ok(BroadcastStopped, w.owner, 'POST', api(w, `broadcasts/${d.id}/stop`));
    expect(again.outcome).toBe('unchanged');

    // "Only recipients it did not reach" copies the 4 stopped into a group (AC-13).
    const copy = await ok(
      BroadcastDraft,
      w.operator,
      'POST',
      api(w, `broadcasts/${d.id}/duplicate`),
      {
        audience: 'not_reached',
        include_not_confirmed: false,
      },
    );
    expect(copy).toMatchObject({
      name: 'Copy of Spring prices',
      text: TEXT,
      author: { account_id: w.operator.accountId },
      audience: { kind: 'group', size: 4 },
    });
    expect(sorted(await groupOf(w, w.operator, copy.id))).toEqual(
      sorted(stoppedRecipients.map((r) => r.contact.id)),
    );
    expect(all).toHaveLength(12);
  }, 60_000);

  it('story 4 — a token revoked mid-send aborts the broadcast with the waiting failed as "bot stopped"; "did not reach" copies them (AC-12, AC-13)', async () => {
    const w = await workspace();
    const all = await customers(w, [840001, 840002, 840003, 840004]);
    fake.bot(w.token).script({ sendMessage: [sendAnswers.unauthorized()] });
    const d = await tagAudience(w, w.operator, await draft(w, w.operator), 'none');
    await confirmAndLaunch(w, w.owner, d.id);

    const done = await ended(w, w.owner, d.id);
    expect(done).toMatchObject({ status: 'sent', end_reason: 'bot_stopped' });
    const failed = await recipients(w, w.owner, d.id, 'failed');
    expect(failed.length).toBeGreaterThanOrEqual(1);
    for (const r of failed) expect(r.failure_reason).toBe('bot_stopped');
    expect(done.totals.delivered + done.totals.failed).toBe(4);
    expect(done.not_reached_count).toBe(failed.length);
    // Nobody was sent it twice; the refused send reached Telegram once.
    expect(new Set(sentChats(w)).size).toBe(sends(w).length);

    // An operator duplicates "only recipients it did not reach": a group of the failed.
    const copy = await ok(
      BroadcastDraft,
      w.operator,
      'POST',
      api(w, `broadcasts/${d.id}/duplicate`),
      {
        audience: 'not_reached',
        include_not_confirmed: false,
      },
    );
    expect(copy.audience).toEqual({ kind: 'group', size: failed.length });
    expect(sorted(await groupOf(w, w.operator, copy.id))).toEqual(
      sorted(failed.map((r) => r.contact.id)),
    );
    // The original is unchanged.
    expect(await read(w, w.owner, d.id)).toEqual(done);
    expect(all).toHaveLength(4);
  }, 60_000);

  it('story 5 — a send with no answer ends "not confirmed" and is never resent; a link killed between claim and outcome leaves its recipient "not confirmed" with the item at the claim time (AC-11, AC-16)', async () => {
    const w = await workspace();
    const [olena, maria, taras] = await customers(w, [850001, 850002, 850003]);

    // A broadcast left by a dead link: Olena claimed 30 s ago, never answered; Maria waiting.
    const killed = await insertBroadcast(deps.db, {
      workspaceId: w.ws,
      authorAccountId: w.owner.accountId,
      name: 'Killed link',
      text: TEXT,
    });
    const claimedAt = new Date(Date.now() - 30_000);
    await launchBroadcastFixture(deps.db, {
      broadcast: killed,
      launchedByAccountId: w.owner.accountId,
      telegramBotId: w.telegramBotId,
      launchedAt: new Date(),
      recipients: [
        { contactId: olena!.contactId, state: 'sending', claimedAt },
        { contactId: maria!.contactId },
      ],
    });

    // The next link (queued by a new launch to Taras) resolves Olena, then serves the rest.
    const g = await groupAudience(w, w.operator, await draft(w, w.operator, 'Next link'));
    await addToGroup(w, w.operator, g.id, taras!.contactId);
    await confirmAndLaunch(w, w.owner, g.id);

    const k = await ended(w, w.owner, killed);
    expect(k).toMatchObject({ status: 'sent', end_reason: 'completed' });
    const kr = await recipients(w, w.owner, killed);
    expect(kr.find((r) => r.contact.id === olena!.contactId)).toMatchObject({
      state: 'not_confirmed',
      failure_reason: null,
    });
    expect(kr.find((r) => r.contact.id === maria!.contactId)?.state).toBe('delivered');
    const olenaItem = (await thread(w, w.operator, olena!.conversationId)).find(
      (i) => i.type === 'broadcast',
    );
    expect(olenaItem).toMatchObject({ state: 'not_confirmed', broadcast_id: killed });
    expect(olenaItem && new Date(olenaItem.position_at).getTime()).toBe(claimedAt.getTime());
    expect((await ended(w, w.owner, g.id)).totals.delivered).toBe(1);
    // The next link never sent Olena the broadcast again.
    expect(sorted(sentChats(w))).toEqual(sorted(chatsOf([maria!, taras!])));

    // Taras's send of the next broadcast gets no answer at all.
    fake.bot(w.token).script({ sendMessage: [sendAnswers.resetAfterWrite()] });
    const n = await groupAudience(w, w.operator, await draft(w, w.operator, 'No answer'));
    await addToGroup(w, w.operator, n.id, taras!.contactId);
    await confirmAndLaunch(w, w.owner, n.id);
    const unanswered = await ended(w, w.owner, n.id);
    expect(unanswered).toMatchObject({ status: 'sent', end_reason: 'completed' });
    expect(unanswered.totals).toMatchObject({ not_confirmed: 1, delivered: 0 });
    const [r] = await recipients(w, w.owner, n.id);
    expect(r).toMatchObject({ state: 'not_confirmed', failure_reason: null });
    const tarasItem = (await thread(w, w.operator, taras!.conversationId)).find(
      (i): i is ThreadBroadcastItem => i.type === 'broadcast' && i.broadcast_id === n.id,
    );
    expect(tarasItem).toMatchObject({ state: 'not_confirmed' });
    // Placed at the time the send was made: the claim, not the outcome.
    const row = (await recipientRows(w, n.id))[0]!;
    expect(tarasItem && new Date(tarasItem.position_at).getTime()).toBe(row.claimed_at!.getTime());

    // Never sent again automatically.
    await new Promise((r) => setTimeout(r, 1500));
    expect(sorted(sentChats(w))).toEqual(sorted(chatsOf([maria!, taras!, taras!])));
  }, 60_000);

  it('story 6 — a retag between confirmation and launch launches nothing; two owners launching at once launch once and send each recipient one message (AC-06)', async () => {
    const w = await workspace();
    const [a, b, c, d] = await customers(w, [860001, 860002, 860003, 860004]);
    const vip = await tag(w, w.operator, a!.contactId, 'VIP');
    await tag(w, w.operator, b!.contactId, 'VIP');
    await tag(w, w.operator, c!.contactId, 'VIP');
    const created = await tagAudience(w, w.operator, await draft(w, w.operator), 'any', [vip]);

    // The set changes, the number does not.
    const stale = await confirmation(w, w.owner, created.id);
    await untag(w, w.operator, c!.contactId, vip);
    await tag(w, w.operator, d!.contactId, 'VIP');
    const changed = await launch(w, w.owner, stale);
    expect(changed.statusCode).toBe(409);
    expect(errorOf(changed).code).toBe('BROADCAST_AUDIENCE_CHANGED');
    const fresh = LaunchConfirmation.parse(
      (errorOf(changed).details as { confirmation: unknown }).confirmation,
    );
    expect(fresh.breakdown.recipient_count).toBe(3);
    expect(fresh.fingerprint).not.toBe(stale.fingerprint);
    expect((await read(w, w.owner, created.id)).status).toBe('draft');
    expect(await recipientRows(w, created.id)).toEqual([]);

    // Both owners confirm the same version at once.
    const [one, two] = await Promise.all([launch(w, w.owner, fresh), launch(w, w.coOwner, fresh)]);
    const outcomes = [one, two].map((r) => {
      expect(r.statusCode, r.body).toBe(200);
      return BroadcastLaunched.parse(r.json()).outcome;
    });
    expect(outcomes.sort()).toEqual(['already_launched', 'launched']);
    const done = await ended(w, w.owner, created.id);
    expect(done.totals.delivered).toBe(3);
    expect(sorted(sentChats(w))).toEqual(sorted(chatsOf([a!, b!, d!])));
    expect(await recipientRows(w, created.id)).toHaveLength(3);
  }, 60_000);
});
