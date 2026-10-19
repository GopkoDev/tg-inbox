import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ActiveMemberList,
  ConversationPage,
  ConversationSummary,
  AttentionCount,
  ErrorEnvelope,
  InboxBotStatus,
  ReadState,
  ThreadMessage,
  ThreadPage,
  ThreadActivity,
  ThreadReply,
} from '@tg/shared';
import { buildApp } from '../../../app.js';
import { createNotificationQueries } from '../../conversations/infra/notification-queries.js';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { insertBot } from '../../../test/fixtures/bots.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import {
  insertActivity,
  insertConversation,
  insertMessage,
  insertReadMark,
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
    expect(ConversationSummary.parse(res.json())).toMatchObject({
      id: s.c1,
      unread_count: 2,
      status: 'open',
      assignee: null,
      state_version: 0,
      close_snapshot: { customer_message_seq: 0, latest_reply: null },
    });
  });

  /** Open: mine (Ann), theirs (Bea), none; closed: mine, none. Newest activity first in that order. */
  const lensSeed = async () => {
    const ws = await insertWorkspace(db, 'Acme Flowers');
    const me = await member(ws, 'operator', 'active', 'Mia <b>Operator</b>');
    const bea = await member(ws, 'owner', 'active', 'Bea Owner');
    const mk = async (
      name: string,
      hhmm: string,
      o: { status?: 'open' | 'closed'; assigneeAccountId?: string | null; stateVersion?: number },
    ) => {
      const contactId = await insertContact(db, { workspaceId: ws, firstName: name });
      const conversationId = await insertConversation(db, {
        workspaceId: ws,
        contactId,
        lastActivityAt: at(hhmm),
        lastMessageReceivedAt: at(hhmm),
        ...o,
      });
      await insertMessage(db, {
        workspaceId: ws,
        conversationId,
        telegramMessageId: 1n,
        sentAt: at(hhmm),
        receivedAt: at(hhmm),
      });
      return conversationId;
    };
    const mine = await mk('Mineone', '09:50', { assigneeAccountId: me.accountId, stateVersion: 3 });
    const theirs = await mk('Theirsone', '09:40', { assigneeAccountId: bea.accountId });
    const none = await mk('Noneone', '09:30', {});
    const closedMine = await mk('Closedmine', '09:20', {
      status: 'closed',
      assigneeAccountId: me.accountId,
    });
    const closedNone = await mk('Closednone', '09:10', { status: 'closed' });
    return { ws, me, bea, mine, theirs, none, closedMine, closedNone };
  };

  it('serves the status and assignee lenses and echoes them (AC-01)', async () => {
    const s = await lensSeed();
    const list = async (qs: string) =>
      ConversationPage.parse((await get(s.me, `${base(s.ws)}/conversations${qs}`)).json());
    const all = await list('');
    expect(all.lens).toEqual({ status: 'open', assignee: 'all' });
    expect(all.items.map((c) => c.id)).toEqual([s.mine, s.theirs, s.none]);
    expect(all.items[0]).toMatchObject({
      status: 'open',
      state_version: 3,
      assignee: { account_id: s.me.accountId, display_name: 'Mia <b>Operator</b>' },
    });
    expect(all.items[2]).toMatchObject({ assignee: null });
    const mine = await list('?assignee=mine');
    expect(mine.lens).toEqual({ status: 'open', assignee: 'mine' });
    expect(mine.items.map((c) => c.id)).toEqual([s.mine]);
    const unassigned = await list('?assignee=unassigned');
    expect(unassigned.items.map((c) => c.id)).toEqual([s.none]);
    const closed = await list('?status=closed');
    expect(closed.lens).toEqual({ status: 'closed', assignee: 'all' });
    expect(closed.items.map((c) => c.id)).toEqual([s.closedMine, s.closedNone]);
    expect(closed.items[0]?.status).toBe('closed');
    const closedMine = await list('?status=closed&assignee=mine');
    expect(closedMine.items.map((c) => c.id)).toEqual([s.closedMine]);
    const empty = await list('?status=closed&assignee=unassigned&q=Mineone');
    expect(empty.items).toEqual([]);
  });

  it('sets the status lens aside while searching and keeps the assignee lens (AC-01)', async () => {
    const s = await lensSeed();
    const list = async (qs: string) =>
      ConversationPage.parse((await get(s.me, `${base(s.ws)}/conversations${qs}`)).json());
    const found = await list('?q=one&status=closed');
    expect(found.lens).toEqual({ status: null, assignee: 'all' });
    expect(found.items.map((c) => c.id)).toEqual([s.mine, s.theirs, s.none, s.closedNone]);
    const both = await list('?q=closed&assignee=mine');
    expect(both.lens).toEqual({ status: null, assignee: 'mine' });
    expect(both.items.map((c) => c.id)).toEqual([s.closedMine]);
    expect(both.items[0]?.status).toBe('closed');
    const blank = await list('?q=%20%20&status=closed');
    expect(blank.lens).toEqual({ status: 'closed', assignee: 'all' });
  });

  it('a query that normalises to nothing ("@") is not a search: the status lens stays, said and applied (B4, AC-01)', async () => {
    const s = await lensSeed();
    const list = async (qs: string) =>
      ConversationPage.parse((await get(s.me, `${base(s.ws)}/conversations${qs}`)).json());
    const at = await list('?q=%20%40%20&status=closed');
    expect(at.lens).toEqual({ status: 'closed', assignee: 'all' });
    expect(at.items.map((c) => c.id)).toEqual([s.closedMine, s.closedNone]);
    // The cursor is bound to the lens without a search, so it pages on as the plain closed list.
    const first = await list('?q=%40&status=closed&limit=1');
    const next = await list(`?status=closed&limit=1&after=${first.next_cursor}`);
    expect(next.items.map((c) => c.id)).toEqual([s.closedNone]);
  });

  it('pages within a lens and refuses a cursor from another lens and an unknown lens', async () => {
    const s = await lensSeed();
    const first = ConversationPage.parse(
      (await get(s.me, `${base(s.ws)}/conversations?status=closed&limit=1`)).json(),
    );
    expect(first.items).toHaveLength(1);
    const next = await get(
      s.me,
      `${base(s.ws)}/conversations?status=closed&limit=1&after=${first.next_cursor}`,
    );
    expect(ConversationPage.parse(next.json()).items.map((c) => c.id)).toEqual([s.closedNone]);
    for (const qs of [
      `status=open&after=${first.next_cursor}`,
      'status=archived',
      'assignee=everyone',
    ]) {
      const res = await get(s.me, `${base(s.ws)}/conversations?${qs}`);
      expect(res.statusCode, qs).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    }
  });

  it('serves the summary with the close snapshot and an activity entry in the thread (AC-09)', async () => {
    const s = await lensSeed();
    await insertReply(db, {
      workspaceId: s.ws,
      conversationId: s.mine,
      authorAccountId: s.bea.accountId,
      state: 'sent',
      positionAt: at('09:55'),
    });
    const first = await insertActivity(db, {
      workspaceId: s.ws,
      conversationId: s.mine,
      kind: 'assigned',
      actorAccountId: s.bea.accountId,
      newAssigneeAccountId: s.me.accountId,
      positionAt: at('09:52'),
    });
    const second = await insertActivity(db, {
      workspaceId: s.ws,
      conversationId: s.mine,
      kind: 'reassigned',
      cause: 'member',
      actorAccountId: s.me.accountId,
      previousAssigneeAccountId: s.me.accountId,
      newAssigneeAccountId: s.bea.accountId,
      positionAt: at('09:58'),
    });
    const summary = ConversationSummary.parse(
      (await get(s.me, `${base(s.ws)}/conversations/${s.mine}`)).json(),
    );
    expect(summary.close_snapshot.latest_reply).toMatchObject({ state: 'sent' });
    const page = ThreadPage.parse(
      (await get(s.me, `${base(s.ws)}/conversations/${s.mine}/items`)).json(),
    );
    expect(page.items.map((i) => i.type)).toEqual(['message', 'activity', 'reply', 'activity']);
    expect(page.items.map((i) => i.id)).toContain(first);
    expect(page.items[1]).toMatchObject({
      kind: 'assigned',
      cause: 'member',
      actor: { account_id: s.bea.accountId, display_name: 'Bea Owner' },
      previous_assignee: null,
      new_assignee: { account_id: s.me.accountId, display_name: 'Mia <b>Operator</b>' },
      position_at: at('09:52').toISOString(),
    });
    const one = await get(s.bea, `${base(s.ws)}/conversations/${s.mine}/activities/${second}`);
    expect(one.statusCode).toBe(200);
    expect(ThreadActivity.parse(one.json())).toMatchObject({
      id: second,
      kind: 'reassigned',
      previous_assignee: { display_name: 'Mia <b>Operator</b>' },
      new_assignee: { display_name: 'Bea Owner' },
    });
  });

  it('still names the actor of an entry after that member was deactivated', async () => {
    const s = await lensSeed();
    const gone = await member(s.ws, 'operator', 'deactivated', 'Gone Gary');
    const entry = await insertActivity(db, {
      workspaceId: s.ws,
      conversationId: s.none,
      kind: 'assigned',
      actorAccountId: gone.accountId,
      newAssigneeAccountId: s.me.accountId,
    });
    const res = await get(s.me, `${base(s.ws)}/conversations/${s.none}/activities/${entry}`);
    expect(ThreadActivity.parse(res.json()).actor?.display_name).toBe('Gone Gary');
  });

  it('lists the active members for any role, by name, not the deactivated (AC-04)', async () => {
    const s = await lensSeed();
    await member(s.ws, 'operator', 'deactivated', 'Aaron Gone');
    for (const who of [s.me, s.bea]) {
      const res = await get(who, `${base(s.ws)}/members`);
      expect(res.statusCode).toBe(200);
      const list = ActiveMemberList.parse(res.json());
      expect(list.workspace_id).toBe(s.ws);
      expect(list.items.map((m) => m.display_name)).toEqual(['Bea Owner', 'Mia <b>Operator</b>']);
    }
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

  it('carries the conversation newest reply id on every page, wherever that reply is (W9, AC-16)', async () => {
    const s = await seed();
    const ws = s.ws;
    const contact = await insertContact(db, { workspaceId: ws });
    const conv = await insertConversation(db, {
      workspaceId: ws,
      contactId: contact,
      lastActivityAt: at('07:10'),
      lastMessageReceivedAt: at('07:10'),
      lastReplySentAt: at('07:01'),
    });
    const url = `${base(ws)}/conversations/${conv}/items`;
    const none = ThreadPage.parse((await get(s.operator, url)).json());
    expect(none.newest_reply_id).toBeNull();

    await insertReply(db, {
      workspaceId: ws,
      conversationId: conv,
      authorAccountId: s.owner.accountId,
      state: 'sent',
      positionAt: at('07:00'),
    });
    const newest = await insertReply(db, {
      workspaceId: ws,
      conversationId: conv,
      authorAccountId: s.owner.accountId,
      state: 'sent',
      positionAt: at('07:01'),
    });
    for (let i = 0; i < 3; i++) {
      await insertMessage(db, {
        workspaceId: ws,
        conversationId: conv,
        telegramMessageId: BigInt(i + 1),
        sentAt: new Date(at('07:05').getTime() + i * 60_000),
        receivedAt: new Date(at('07:05').getTime() + i * 60_000),
      });
    }
    // The latest page holds only customer messages; the newest reply is on an earlier page.
    const latest = ThreadPage.parse((await get(s.operator, `${url}?limit=2`)).json());
    expect(latest.items.every((i) => i.type === 'message')).toBe(true);
    expect(latest.newest_reply_id).toBe(newest);
    const earlier = ThreadPage.parse(
      (await get(s.operator, `${url}?limit=2&before=${latest.prev_cursor}`)).json(),
    );
    expect(earlier.items.map((i) => i.type)).toContain('reply');
    expect(earlier.newest_reply_id).toBe(newest);
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
    const mine = ConversationSummary.parse(
      (await get(s.operator, `${base(s.ws)}/conversations/${s.c1}`)).json(),
    );
    const theirs = ConversationSummary.parse(
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
      `${base(a.workspaceId)}/conversations/${b.assignedConversationId}/activities/${b.activityId}`,
      `${base(a.workspaceId)}/conversations/${a.assignedConversationId}/activities/${b.activityId}`,
      `${base(a.workspaceId)}/conversations/${a.assignedConversationId}/activities/${newId()}`,
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
      `${base(s.ws)}/members`,
      `${base(s.ws)}/conversations?status=closed&assignee=mine`,
      `${c}/activities/${newId()}`,
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

  describe('the conversation of a contact (contacts profile, ADR-0006)', () => {
    const contactUrl = (ws: string, contactId: string) =>
      `${base(ws)}/contacts/${contactId}/conversation`;
    const contactOf = async (ws: string, conversationId: string) =>
      (
        await db
          .selectFrom('conversations')
          .select('contact_id')
          .where('workspace_id', '=', ws)
          .where('id', '=', conversationId)
          .executeTakeFirstOrThrow()
      ).contact_id;

    it('returns the contact conversation summary exactly as the conversation read, for either role', async () => {
      const s = await seed();
      const contactId = await contactOf(s.ws, s.c1);
      for (const who of [s.operator, s.owner]) {
        const res = await get(who, contactUrl(s.ws, contactId));
        expect(res.statusCode).toBe(200);
        const summary = ConversationSummary.parse(res.json());
        const direct = ConversationSummary.parse(
          (await get(who, `${base(s.ws)}/conversations/${s.c1}`)).json(),
        );
        expect(summary).toEqual(direct);
        expect(summary).toMatchObject({ id: s.c1, unread_count: 2, waiting_for_reply: true });
      }
    });

    it('answers 404 for a contact of another workspace, an unknown contact and a contact with no conversation', async () => {
      const s = await seed();
      const other = await insertWorkspace(db, 'Bolt Bikes');
      const foreignContact = await insertContact(db, { workspaceId: other });
      const foreignConversation = await insertConversation(db, {
        workspaceId: other,
        contactId: foreignContact,
      });
      expect(foreignConversation).toBeDefined();
      const lonely = await insertContact(db, { workspaceId: s.ws });
      for (const id of [foreignContact, newId(), lonely]) {
        const res = await get(s.operator, contactUrl(s.ws, id));
        expect(res.statusCode, id).toBe(404);
        expect(errorOf(res).code).toBe('NOT_FOUND');
      }
    });

    it('refuses signed-out, other-workspace and deactivated callers', async () => {
      const s = await seed();
      const contactId = await contactOf(s.ws, s.c1);
      const outsider = await member(await insertWorkspace(db, 'Bolt Bikes'));
      const removed = await member(s.ws, 'operator', 'deactivated');
      const url = contactUrl(s.ws, contactId);
      expect((await get(null, url)).statusCode).toBe(401);
      expect((await get(outsider, url)).statusCode).toBe(404);
      const gone = await get(removed, url);
      expect(gone.statusCode).toBe(403);
      expect(errorOf(gone).code).toBe('ACCESS_REMOVED');
    });

    it('never changes read state: read marks, unread count, attention and the ping due set stay as they were (QG-2, AC-05)', async () => {
      const s = await seed();
      const contactId = await contactOf(s.ws, s.c1);
      // The operator has read the first message only; the second is unread.
      await insertReadMark(db, {
        workspaceId: s.ws,
        conversationId: s.c1,
        accountId: s.operator.accountId,
        readThroughAt: at('09:00'),
      });
      const pings = createNotificationQueries(db);
      const snapshot = async () => ({
        marks: await db
          .selectFrom('read_marks')
          .selectAll()
          .where('workspace_id', '=', s.ws)
          .orderBy('id')
          .execute(),
        unread: ConversationSummary.parse(
          (await get(s.operator, `${base(s.ws)}/conversations/${s.c1}`)).json(),
        ).unread_count,
        attention: AttentionCount.parse((await get(s.operator, `${base(s.ws)}/attention`)).json())
          .count,
        due: await pings.waitingForPings(s.ws, {
          accountIds: [s.operator.accountId, s.owner.accountId],
        }),
      });
      const readProfile = async (who: Who) => {
        const summary = await get(who, contactUrl(s.ws, contactId));
        expect(summary.statusCode).toBe(200);
        // Every thread page, both directions, as the profile history would.
        const latest = ThreadPage.parse(
          (await get(who, `${base(s.ws)}/conversations/${s.c1}/items?limit=1`)).json(),
        );
        if (latest.prev_cursor) {
          const older = await get(
            who,
            `${base(s.ws)}/conversations/${s.c1}/items?limit=1&before=${latest.prev_cursor}`,
          );
          expect(older.statusCode).toBe(200);
        }
        expect((await get(who, `${base(s.ws)}/conversations/${s.c1}/items`)).statusCode).toBe(200);
      };

      const before = await snapshot();
      expect(before.unread).toBe(1);
      await readProfile(s.operator);
      await readProfile(s.owner);
      expect(await snapshot()).toEqual(before);

      // A customer message is captured while the profile reads: the next summary shows it, still unread.
      await insertMessage(db, {
        workspaceId: s.ws,
        conversationId: s.c1,
        telegramMessageId: 3n,
        sentAt: at('09:30'),
        receivedAt: at('09:30'),
      });
      await readProfile(s.operator);
      await readProfile(s.owner);
      const after = await snapshot();
      expect(after.marks).toEqual(before.marks);
      expect(after.unread).toBe(2);
      expect(after.attention).toBe(before.attention);
      expect(after.due).toEqual(before.due);
    });
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
