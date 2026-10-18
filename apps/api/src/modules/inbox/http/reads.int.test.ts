import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConversationPage,
  Conversation,
  ErrorEnvelope,
  InboxBotStatus,
  ReadState,
  ThreadMessage,
  ThreadPage,
  ThreadReply,
} from '@tg/shared';
import { buildApp } from '../../../app.js';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { insertBot } from '../../../test/fixtures/bots.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import {
  insertConversation,
  insertMessage,
  insertReply,
  twoWorkspacesWithInbox,
} from '../../../test/fixtures/conversations.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

const NOW = new Date('2026-10-18T10:00:00Z');
const at = (hhmm: string) => new Date(`2026-10-18T${hhmm}:00Z`);

describe('inbox read routes (postgres)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let db: Db;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await buildApp(testConfig(database.url), { clock: fixedClock(NOW) });
    db = createDb(database.url);
  });
  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await database?.stop();
  });

  type Who = { accountId: string; sessionToken: string; cookies: { session: string } };
  const member = async (
    workspaceId: string,
    role: 'owner' | 'operator' = 'operator',
    state: 'active' | 'deactivated' = 'active',
    displayName = 'Test User',
  ): Promise<Who> => {
    const account = await insertAccount(db, { displayName });
    const session = await insertSession(db, account.id, { createdAt: at('09:00') });
    await insertMembership(db, workspaceId, { accountId: account.id, role, state });
    return {
      accountId: account.id,
      sessionToken: session.token,
      cookies: { session: session.token },
    };
  };
  const get = (who: Who | null, url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, cookies: who?.cookies, headers });
  const post = (who: Who | null, url: string, payload: object) =>
    app.inject({ method: 'POST', url, cookies: who?.cookies, payload });
  const base = (ws: string) => `/api/workspaces/${ws}/inbox`;

  /** "Acme Flowers": Alice (2 unread, waiting), Bob (1 unread, answered), Carol (1 unread). */
  const seed = async () => {
    const ws = await insertWorkspace(db, 'Acme Flowers');
    const operator = await member(ws, 'operator');
    const owner = await member(ws, 'owner', 'active', 'Olga Owner');
    const alice = await insertContact(db, {
      workspaceId: ws,
      firstName: 'Alice Smith',
      username: 'alice_s',
    });
    const bob = await insertContact(db, { workspaceId: ws, firstName: 'Bob', username: null });
    const carol = await insertContact(db, { workspaceId: ws, firstName: 'Карл', username: 'karl' });
    const c1 = await insertConversation(db, {
      workspaceId: ws,
      contactId: alice,
      lastActivityAt: at('09:05'),
      lastMessageReceivedAt: at('09:05'),
    });
    const m1 = await insertMessage(db, {
      workspaceId: ws,
      conversationId: c1,
      telegramMessageId: 1n,
      sentAt: at('09:00'),
      receivedAt: at('09:00'),
    });
    const m2 = await insertMessage(db, {
      workspaceId: ws,
      conversationId: c1,
      telegramMessageId: 2n,
      kind: 'photo',
      body: 'new bouquet?',
      sentAt: at('09:05'),
      receivedAt: at('09:05'),
    });
    const c2 = await insertConversation(db, {
      workspaceId: ws,
      contactId: bob,
      lastActivityAt: at('08:30'),
      lastMessageReceivedAt: at('08:00'),
      lastReplySentAt: at('08:30'),
    });
    await insertMessage(db, {
      workspaceId: ws,
      conversationId: c2,
      telegramMessageId: 1n,
      sentAt: at('08:00'),
      receivedAt: at('08:00'),
    });
    const r2 = await insertReply(db, {
      workspaceId: ws,
      conversationId: c2,
      authorAccountId: owner.accountId,
      state: 'sent',
      body: 'On it',
      positionAt: at('08:30'),
    });
    const c3 = await insertConversation(db, {
      workspaceId: ws,
      contactId: carol,
      lastActivityAt: at('07:00'),
      lastMessageReceivedAt: at('07:00'),
    });
    await insertMessage(db, {
      workspaceId: ws,
      conversationId: c3,
      telegramMessageId: 1n,
      sentAt: at('07:00'),
      receivedAt: at('07:00'),
    });
    return { ws, operator, owner, c1, c2, c3, m1, m2, r2 };
  };

  const errorOf = (res: { json: () => unknown }) => ErrorEnvelope.parse(res.json()).error;

  it('lists the conversations newest activity first with this member unread counts (AC-01)', async () => {
    const s = await seed();
    const res = await get(s.operator, `${base(s.ws)}/conversations`);
    expect(res.statusCode).toBe(200);
    const page = ConversationPage.parse(res.json());
    expect(page.workspace_id).toBe(s.ws);
    expect(page.items.map((c) => c.id)).toEqual([s.c1, s.c2, s.c3]);
    expect(page.items[0]).toMatchObject({
      workspace_id: s.ws,
      contact: { first_name: 'Alice Smith', username: 'alice_s' },
      last_item: { type: 'message', id: s.m2, kind: 'photo', body: 'new bouquet?' },
      unread_count: 2,
      waiting_for_reply: true,
    });
    expect(page.items[1]).toMatchObject({
      last_item: { type: 'reply', id: s.r2, body: 'On it' },
      unread_count: 1,
      waiting_for_reply: false,
    });
    expect(page.has_next).toBe(false);
  });

  it('answers the owner exactly as the operator', async () => {
    const s = await seed();
    const a = await get(s.operator, `${base(s.ws)}/conversations`);
    const b = await get(s.owner, `${base(s.ws)}/conversations`);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
  });

  it('pages with limit and the next cursor, and rejects a malformed cursor or limit', async () => {
    const s = await seed();
    const first = ConversationPage.parse(
      (await get(s.operator, `${base(s.ws)}/conversations?limit=2`)).json(),
    );
    expect(first.items.map((c) => c.id)).toEqual([s.c1, s.c2]);
    expect(first.has_next).toBe(true);
    const second = ConversationPage.parse(
      (
        await get(s.operator, `${base(s.ws)}/conversations?limit=2&after=${first.next_cursor}`)
      ).json(),
    );
    expect(second.items.map((c) => c.id)).toEqual([s.c3]);
    expect(second.has_prev).toBe(true);
    expect(second.next_cursor).toBeNull();
    for (const q of ['after=not-a-cursor', 'limit=0', 'limit=101']) {
      const res = await get(s.operator, `${base(s.ws)}/conversations?${q}`);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    }
  });

  it('searches by name or username, ignoring case, spaces and a leading @ (AC-02)', async () => {
    const s = await seed();
    const ids = async (q: string) =>
      ConversationPage.parse(
        (await get(s.operator, `${base(s.ws)}/conversations?q=${encodeURIComponent(q)}`)).json(),
      ).items.map((c) => c.id);
    expect(await ids('  @ALICE_s ')).toEqual([s.c1]);
    expect(await ids('ce smi')).toEqual([s.c1]);
    expect(await ids('КАРЛ')).toEqual([s.c3]);
    expect(await ids('nobody')).toEqual([]);
    expect(await ids('   ')).toEqual([s.c1, s.c2, s.c3]);
    const long = await get(s.operator, `${base(s.ws)}/conversations?q=${'x'.repeat(201)}`);
    expect(long.statusCode).toBe(400);
  });

  it('returns one conversation row', async () => {
    const s = await seed();
    const res = await get(s.operator, `${base(s.ws)}/conversations/${s.c1}`);
    expect(res.statusCode).toBe(200);
    expect(Conversation.parse(res.json())).toMatchObject({ id: s.c1, unread_count: 2 });
  });

  it('reads the thread merged oldest first with reply authors named (AC-03)', async () => {
    const s = await seed();
    const res = await get(s.operator, `${base(s.ws)}/conversations/${s.c2}/items`);
    expect(res.statusCode).toBe(200);
    const page = ThreadPage.parse(res.json());
    expect(page).toMatchObject({ workspace_id: s.ws, conversation_id: s.c2, has_prev: false });
    expect(page.items.map((i) => i.type)).toEqual(['message', 'reply']);
    expect(page.items[1]).toMatchObject({
      type: 'reply',
      author: { account_id: s.owner.accountId, display_name: 'Olga Owner' },
      state: 'sent',
    });
    expect(page.read_through_at).toBe(at('08:00').toISOString());
  });

  it('pages a long thread upwards until the first message', async () => {
    const s = await seed();
    const ws = s.ws;
    const contact = await insertContact(db, { workspaceId: ws });
    const conv = await insertConversation(db, {
      workspaceId: ws,
      contactId: contact,
      lastActivityAt: at('06:59'),
      lastMessageReceivedAt: at('06:59'),
    });
    for (let i = 0; i < 5; i++) {
      await insertMessage(db, {
        workspaceId: ws,
        conversationId: conv,
        telegramMessageId: BigInt(i + 1),
        body: `m${i}`,
        sentAt: new Date(at('06:00').getTime() + i * 60_000),
        receivedAt: new Date(at('06:00').getTime() + i * 60_000),
      });
    }
    const url = `${base(ws)}/conversations/${conv}/items`;
    const latest = ThreadPage.parse((await get(s.operator, `${url}?limit=2`)).json());
    expect(latest.items.map((i) => (i.type === 'message' ? i.body : null))).toEqual(['m3', 'm4']);
    expect(latest.has_prev).toBe(true);
    const older = ThreadPage.parse(
      (await get(s.operator, `${url}?limit=3&before=${latest.prev_cursor}`)).json(),
    );
    expect(older.items.map((i) => (i.type === 'message' ? i.body : null))).toEqual([
      'm0',
      'm1',
      'm2',
    ]);
    expect(older.has_prev).toBe(false);
    expect(older.read_through_at).toBeNull();
  });

  it('rejects before with after, and a malformed thread cursor', async () => {
    const s = await seed();
    const url = `${base(s.ws)}/conversations/${s.c1}/items`;
    const both = await get(s.operator, `${url}?before=AAAA&after=BBBB`);
    expect(both.statusCode).toBe(400);
    expect(errorOf(both).code).toBe('VALIDATION_ERROR');
    const bad = await get(s.operator, `${url}?before=zzzz`);
    expect(bad.statusCode).toBe(400);
    expect(errorOf(bad).code).toBe('VALIDATION_ERROR');
  });

  it('reads a single message and a single reply', async () => {
    const s = await seed();
    const m = await get(s.operator, `${base(s.ws)}/conversations/${s.c1}/messages/${s.m2}`);
    expect(m.statusCode).toBe(200);
    expect(ThreadMessage.parse(m.json())).toMatchObject({
      id: s.m2,
      workspace_id: s.ws,
      kind: 'photo',
      body: 'new bouquet?',
    });
    const r = await get(s.operator, `${base(s.ws)}/conversations/${s.c2}/replies/${s.r2}`);
    expect(r.statusCode).toBe(200);
    expect(ThreadReply.parse(r.json())).toMatchObject({
      id: s.r2,
      author: { display_name: 'Olga Owner' },
    });
  });

  it('marks read for this member only (AC-03)', async () => {
    const s = await seed();
    const res = await post(s.operator, `${base(s.ws)}/conversations/${s.c1}/read`, {
      read_through_at: at('09:05').toISOString(),
    });
    expect(res.statusCode).toBe(200);
    expect(ReadState.parse(res.json())).toEqual({
      workspace_id: s.ws,
      conversation_id: s.c1,
      read_through_at: at('09:05').toISOString(),
      unread_count: 0,
    });
    const mine = Conversation.parse(
      (await get(s.operator, `${base(s.ws)}/conversations/${s.c1}`)).json(),
    );
    const theirs = Conversation.parse(
      (await get(s.owner, `${base(s.ws)}/conversations/${s.c1}`)).json(),
    );
    expect(mine.unread_count).toBe(0);
    expect(theirs.unread_count).toBe(2);
    const bad = await post(s.operator, `${base(s.ws)}/conversations/${s.c1}/read`, {
      read_through_at: 'yesterday',
    });
    expect(bad.statusCode).toBe(400);
    const wrongType = await app.inject({
      method: 'POST',
      url: `${base(s.ws)}/conversations/${s.c1}/read`,
      cookies: s.operator.cookies,
      headers: { 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(wrongType.statusCode).toBe(415);
  });

  it('reports the inbox bot status to every member', async () => {
    const s = await seed();
    const none = await get(s.operator, `${base(s.ws)}/bot`);
    expect(InboxBotStatus.parse(none.json())).toEqual({
      workspace_id: s.ws,
      state: 'not_connected',
      can_reply: false,
      receiving: false,
    });
    await insertBot(db, { workspaceId: s.ws, state: 'connected' });
    const res = await get(s.operator, `${base(s.ws)}/bot`);
    expect(InboxBotStatus.parse(res.json())).toMatchObject({ state: 'connected', can_reply: true });
  });

  it('answers a foreign or unknown conversation, message or reply with the same 404', async () => {
    const { a, b } = await twoWorkspacesWithInbox(db);
    const who = await member(a.workspaceId);
    const urls = [
      `${base(a.workspaceId)}/conversations/${b.conversationId}`,
      `${base(a.workspaceId)}/conversations/${b.conversationId}/items`,
      `${base(a.workspaceId)}/conversations/${a.conversationId}/messages/${b.messageId}`,
      `${base(a.workspaceId)}/conversations/${a.conversationId}/replies/${b.replyId}`,
      `${base(a.workspaceId)}/conversations/${newId()}`,
    ];
    const bodies = new Set<string>();
    for (const url of urls) {
      const res = await get(who, url);
      expect(res.statusCode, url).toBe(404);
      expect(errorOf(res).code).toBe('NOT_FOUND');
      bodies.add(JSON.stringify(res.json()));
    }
    expect(bodies.size).toBe(1);
    const read = await post(who, `${base(a.workspaceId)}/conversations/${b.conversationId}/read`, {
      read_through_at: NOW.toISOString(),
    });
    expect(read.statusCode).toBe(404);
  });

  it('keeps two workspaces of one Telegram user apart (AC-18)', async () => {
    const { a, b } = await twoWorkspacesWithInbox(db);
    const both = await insertAccount(db);
    const session = await insertSession(db, both.id, { createdAt: at('09:00') });
    await insertMembership(db, a.workspaceId, { accountId: both.id });
    await insertMembership(db, b.workspaceId, { accountId: both.id });
    const who: Who = {
      accountId: both.id,
      sessionToken: session.token,
      cookies: { session: session.token },
    };
    for (const [own, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const page = ConversationPage.parse(
        (await get(who, `${base(own.workspaceId)}/conversations`)).json(),
      );
      expect(page.items.map((c) => c.id)).toEqual([own.conversationId]);
      const thread = ThreadPage.parse(
        (
          await get(who, `${base(own.workspaceId)}/conversations/${own.conversationId}/items`)
        ).json(),
      );
      expect(thread.items.map((i) => i.id).sort()).toEqual([own.messageId, own.replyId].sort());
      expect(thread.items.map((i) => i.id)).not.toContain(other.messageId);
    }
  });

  it('refuses signed-out, other-workspace and deactivated callers on every read', async () => {
    const s = await seed();
    const outsider = await member(await insertWorkspace(db, 'Bolt Bikes'));
    const removed = await member(s.ws, 'operator', 'deactivated');
    const c = `${base(s.ws)}/conversations/${s.c1}`;
    const urls = [
      `${base(s.ws)}/conversations`,
      c,
      `${c}/items`,
      `${c}/messages/${s.m1}`,
      `${c}/replies/${s.r2}`,
      `${base(s.ws)}/bot`,
    ];
    for (const url of urls) {
      const signedOut = await get(null, url);
      expect(signedOut.statusCode, url).toBe(401);
      expect(errorOf(signedOut).code).toBe('UNAUTHENTICATED');
      const other = await get(outsider, url);
      expect(other.statusCode, url).toBe(404);
      expect(errorOf(other).code).toBe('NOT_FOUND');
      const gone = await get(removed, url);
      expect(gone.statusCode, url).toBe(403);
      expect(errorOf(gone).code).toBe('ACCESS_REMOVED');
    }
    const body = { read_through_at: NOW.toISOString() };
    expect((await post(null, `${c}/read`, body)).statusCode).toBe(401);
    expect((await post(outsider, `${c}/read`, body)).statusCode).toBe(404);
    expect((await post(removed, `${c}/read`, body)).statusCode).toBe(403);
  });

  it('does not extend the session for a background request', async () => {
    const s = await seed();
    const lastSeen = async () =>
      (
        await db
          .selectFrom('sessions')
          .select('last_seen_at')
          .where('account_id', '=', s.operator.accountId)
          .executeTakeFirstOrThrow()
      ).last_seen_at;
    expect((await lastSeen()).toISOString()).toBe(at('09:00').toISOString());
    await get(s.operator, `${base(s.ws)}/conversations`, { 'x-background-request': '1' });
    expect((await lastSeen()).toISOString()).toBe(at('09:00').toISOString());
    await get(s.operator, `${base(s.ws)}/conversations`);
    expect((await lastSeen()).toISOString()).toBe(NOW.toISOString());
  });
});
