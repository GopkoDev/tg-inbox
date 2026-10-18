import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationStateChange, ErrorEnvelope } from '@tg/shared';
import { buildApp } from '../../../app.js';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import {
  insertActivity,
  insertConversation,
  insertMessage,
  insertReply,
} from '../../../test/fixtures/conversations.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

const NOW = new Date('2026-10-18T10:00:00Z');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('assign and unassign routes (postgres)', () => {
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

  type Who = { accountId: string; membershipId: string; cookies: { session: string } };
  const member = async (
    workspaceId: string,
    role: 'owner' | 'operator' = 'operator',
    state: 'active' | 'deactivated' = 'active',
    displayName = 'Test User',
    activeSince?: Date,
  ): Promise<Who> => {
    const account = await insertAccount(db, { displayName });
    const session = await insertSession(db, account.id, {
      createdAt: new Date('2026-10-18T09:00:00Z'),
    });
    const m = await insertMembership(db, workspaceId, {
      accountId: account.id,
      role,
      state,
      activeSince,
    });
    return { accountId: account.id, membershipId: m.id, cookies: { session: session.token } };
  };
  const base = (ws: string) => `/api/workspaces/${ws}/inbox/conversations`;
  const send = (
    who: Who | null,
    ws: string,
    id: string,
    verb: 'assign' | 'unassign' | 'close' | 'reopen',
    payload: object,
  ) =>
    app.inject({
      method: 'POST',
      url: `${base(ws)}/${id}/${verb}`,
      cookies: who?.cookies,
      payload,
    });
  const errorOf = (res: { json: () => unknown }) => ErrorEnvelope.parse(res.json()).error;

  /** A conversation with one customer message: a thread without one is not shown. */
  const conversation = async (
    workspaceId: string,
    contactId: string,
    o: { status?: 'open' | 'closed' } = {},
  ) => {
    const id = await insertConversation(db, { workspaceId, contactId, ...o });
    await insertMessage(db, { workspaceId, conversationId: id, telegramMessageId: 1n });
    return id;
  };

  const seed = async () => {
    const ws = await insertWorkspace(db, 'Acme Flowers');
    const me = await member(ws, 'operator', 'active', 'Me');
    const mate = await member(ws, 'operator', 'active', 'Mate');
    const owner = await member(ws, 'owner', 'active', 'Olga Owner');
    const contact = await insertContact(db, { workspaceId: ws, firstName: 'Alice' });
    const conversationId = await conversation(ws, contact);
    return { ws, me, mate, owner, contact, conversationId };
  };
  const rowOf = (id: string) =>
    db
      .selectFrom('conversations')
      .select(['assignee_account_id', 'status', 'state_version'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  const entries = (id: string) =>
    db
      .selectFrom('conversation_activities')
      .select(['kind', 'cause', 'actor_account_id'])
      .where('conversation_id', '=', id)
      .orderBy('position_at')
      .execute();
  /** The integrity query: no conversation of the workspace is assigned to a non-active member. */
  const assignedToInactive = (ws: string) =>
    db
      .selectFrom('conversations as c')
      .leftJoin('memberships as m', (j) =>
        j
          .onRef('m.account_id', '=', 'c.assignee_account_id')
          .onRef('m.workspace_id', '=', 'c.workspace_id'),
      )
      .select('c.id')
      .where('c.workspace_id', '=', ws)
      .where('c.assignee_account_id', 'is not', null)
      .where((eb) => eb.or([eb('m.id', 'is', null), eb('m.state', '!=', 'active')]))
      .execute();

  it('AC-02: assigns, reassigns and unassigns, returning the summary and the activity line', async () => {
    const s = await seed();
    const first = await send(s.me, s.ws, s.conversationId, 'assign', {
      assignee_account_id: s.me.accountId,
      expected_state_version: 0,
    });
    expect(first.statusCode).toBe(200);
    const a = ConversationStateChange.parse(first.json());
    expect(a).toMatchObject({
      workspace_id: s.ws,
      outcome: 'recorded',
      conversation: {
        state_version: 1,
        assignee: { account_id: s.me.accountId, display_name: 'Me' },
      },
      activity: {
        kind: 'assigned',
        cause: 'member',
        actor: { account_id: s.me.accountId },
        previous_assignee: null,
      },
    });

    const second = await send(s.me, s.ws, s.conversationId, 'assign', {
      assignee_account_id: s.mate.accountId,
      expected_state_version: 1,
    });
    expect(ConversationStateChange.parse(second.json()).activity).toMatchObject({
      kind: 'reassigned',
      previous_assignee: { account_id: s.me.accountId },
      new_assignee: { account_id: s.mate.accountId },
    });

    const third = await send(s.owner, s.ws, s.conversationId, 'unassign', {
      expected_state_version: 2,
    });
    expect(third.statusCode).toBe(200);
    expect(ConversationStateChange.parse(third.json())).toMatchObject({
      outcome: 'recorded',
      conversation: { assignee: null, state_version: 3 },
      activity: { kind: 'unassigned' },
    });
    expect((await entries(s.conversationId)).map((e) => e.kind)).toEqual([
      'assigned',
      'reassigned',
      'unassigned',
    ]);
  });

  it('AC-02: a closed conversation can be assigned and stays closed', async () => {
    const s = await seed();
    const closed = await conversation(
      s.ws,
      await insertContact(db, { workspaceId: s.ws, firstName: 'Zed' }),
      { status: 'closed' },
    );
    const res = await send(s.me, s.ws, closed, 'assign', {
      assignee_account_id: s.mate.accountId,
      expected_state_version: 0,
    });
    expect(res.statusCode).toBe(200);
    expect(ConversationStateChange.parse(res.json()).conversation.status).toBe('closed');
  });

  it('AC-02/AC-03: the assignee it already has is unchanged, even with a stale version', async () => {
    const s = await seed();
    await send(s.me, s.ws, s.conversationId, 'assign', {
      assignee_account_id: s.mate.accountId,
      expected_state_version: 0,
    });
    const res = await send(s.me, s.ws, s.conversationId, 'assign', {
      assignee_account_id: s.mate.accountId,
      expected_state_version: 0,
    });
    expect(res.statusCode).toBe(200);
    expect(ConversationStateChange.parse(res.json())).toMatchObject({
      outcome: 'unchanged',
      activity: null,
    });
    expect(await entries(s.conversationId)).toHaveLength(1);
    const again = await send(s.me, s.ws, s.conversationId, 'unassign', {
      expected_state_version: 1,
    });
    expect(again.statusCode).toBe(200);
    const none = await send(s.me, s.ws, s.conversationId, 'unassign', {
      expected_state_version: 0,
    });
    expect(ConversationStateChange.parse(none.json()).outcome).toBe('unchanged');
  });

  it('AC-03: a stale version is 409 CONVERSATION_STATE_CHANGED with the current state and the latest change', async () => {
    const s = await seed();
    await send(s.mate, s.ws, s.conversationId, 'assign', {
      assignee_account_id: s.mate.accountId,
      expected_state_version: 0,
    });
    const res = await send(s.me, s.ws, s.conversationId, 'assign', {
      assignee_account_id: s.me.accountId,
      expected_state_version: 0,
    });
    expect(res.statusCode).toBe(409);
    const err = errorOf(res);
    expect(err.code).toBe('CONVERSATION_STATE_CHANGED');
    expect(err.details).toMatchObject({
      conversation: { state_version: 1, assignee: { account_id: s.mate.accountId } },
      latest_change: { kind: 'assigned', actor: { account_id: s.mate.accountId } },
    });
    expect((await rowOf(s.conversationId)).assignee_account_id).toBe(s.mate.accountId);
  });

  it('AC-04: a deactivated or foreign pick is 400 ASSIGNEE_NOT_ACTIVE and changes nothing', async () => {
    const s = await seed();
    const gone = await member(s.ws, 'operator', 'deactivated');
    const other = await insertWorkspace(db, 'Other');
    const foreign = await member(other);
    for (const pick of [
      gone.accountId,
      foreign.accountId,
      '01920000-0000-7000-8000-00000000ffff',
    ]) {
      const res = await send(s.me, s.ws, s.conversationId, 'assign', {
        assignee_account_id: pick,
        expected_state_version: 0,
      });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('ASSIGNEE_NOT_ACTIVE');
    }
    expect((await rowOf(s.conversationId)).assignee_account_id).toBeNull();
    expect(await entries(s.conversationId)).toHaveLength(0);
  });

  it('N1: an unknown conversation with an inactive pick is 400, with an active pick 404', async () => {
    const s = await seed();
    const gone = await member(s.ws, 'operator', 'deactivated');
    const unknown = '01920000-0000-7000-8000-00000000aaaa';
    const refused = await send(s.me, s.ws, unknown, 'assign', {
      assignee_account_id: gone.accountId,
      expected_state_version: 0,
    });
    expect(errorOf(refused).code).toBe('ASSIGNEE_NOT_ACTIVE');
    const missing = await send(s.me, s.ws, unknown, 'assign', {
      assignee_account_id: s.mate.accountId,
      expected_state_version: 0,
    });
    expect(missing.statusCode).toBe(404);
    expect(
      (await send(s.me, s.ws, unknown, 'unassign', { expected_state_version: 0 })).statusCode,
    ).toBe(404);
  });

  it('AC-11: a conversation of another workspace is 404 and untouched', async () => {
    const s = await seed();
    const t = await seed();
    const res = await send(s.me, s.ws, t.conversationId, 'assign', {
      assignee_account_id: s.me.accountId,
      expected_state_version: 0,
    });
    expect(res.statusCode).toBe(404);
    expect((await rowOf(t.conversationId)).assignee_account_id).toBeNull();
  });

  it('AC-11: signed out is 401, another workspace gets 404, a deactivated member 403', async () => {
    const s = await seed();
    const outsider = await member(await insertWorkspace(db, 'Elsewhere'));
    const gone = await member(s.ws, 'operator', 'deactivated');
    const body = { assignee_account_id: s.me.accountId, expected_state_version: 0 };
    expect((await send(null, s.ws, s.conversationId, 'assign', body)).statusCode).toBe(401);
    expect((await send(outsider, s.ws, s.conversationId, 'assign', body)).statusCode).toBe(404);
    const removed = await send(gone, s.ws, s.conversationId, 'assign', body);
    expect(removed.statusCode).toBe(403);
    expect(errorOf(removed).code).toBe('ACCESS_REMOVED');
    expect(
      (await send(gone, s.ws, s.conversationId, 'unassign', { expected_state_version: 0 }))
        .statusCode,
    ).toBe(403);
    expect(await entries(s.conversationId)).toHaveLength(0);
  });

  it('AC-11: a caller deactivated between the guard and the share lock is 403 and nothing changes', async () => {
    const s = await seed();
    const tx = await db.startTransaction().execute();
    await tx
      .updateTable('memberships')
      .set({ state: 'deactivated', deactivated_at: NOW })
      .where('id', '=', s.me.membershipId)
      .execute();
    const pending = send(s.me, s.ws, s.conversationId, 'assign', {
      assignee_account_id: s.mate.accountId,
      expected_state_version: 0,
    });
    await sleep(400);
    await tx.commit().execute();
    const res = await pending;
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('ACCESS_REMOVED');
    expect(await entries(s.conversationId)).toHaveLength(0);
  });

  it('AC-10 lock order: the deactivation commits first, so the concurrent assign is refused', async () => {
    const s = await seed();
    const tx = await db.startTransaction().execute();
    // The deactivation's own steps, held open: membership first (its row lock is what the assign waits on).
    await tx
      .updateTable('memberships')
      .set({ state: 'deactivated', deactivated_at: NOW })
      .where('id', '=', s.mate.membershipId)
      .execute();
    const pending = send(s.me, s.ws, s.conversationId, 'assign', {
      assignee_account_id: s.mate.accountId,
      expected_state_version: 0,
    });
    await sleep(400);
    await tx.commit().execute();
    const res = await pending;
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).code).toBe('ASSIGNEE_NOT_ACTIVE');
    expect(await assignedToInactive(s.ws)).toEqual([]);
    expect((await rowOf(s.conversationId)).assignee_account_id).toBeNull();
  });

  it('AC-10 lock order: the assign share-locks first, commits, and the deactivation then unassigns it', async () => {
    const s = await seed();
    // Hold the conversation row so the assign stops after its membership share lock.
    const hold = await db.startTransaction().execute();
    await hold
      .selectFrom('conversations')
      .select('id')
      .where('id', '=', s.conversationId)
      .forUpdate()
      .execute();
    const assign = send(s.me, s.ws, s.conversationId, 'assign', {
      assignee_account_id: s.mate.accountId,
      expected_state_version: 0,
    });
    await sleep(400);
    const deactivate = app.inject({
      method: 'POST',
      url: `/api/workspaces/${s.ws}/memberships/${s.mate.membershipId}/deactivate`,
      cookies: s.owner.cookies,
    });
    await sleep(400);
    await hold.commit().execute();
    const [assigned, deactivated] = await Promise.all([assign, deactivate]);
    expect(assigned.statusCode).toBe(200);
    expect(deactivated.statusCode).toBe(200);
    expect(await assignedToInactive(s.ws)).toEqual([]);
    expect((await rowOf(s.conversationId)).assignee_account_id).toBeNull();
    expect((await entries(s.conversationId)).map((e) => `${e.kind}:${e.cause}`)).toEqual([
      'assigned:member',
      'unassigned:member_deactivated',
    ]);
  });

  it('validates the bodies', async () => {
    const s = await seed();
    for (const body of [
      {},
      { assignee_account_id: 'nope', expected_state_version: 0 },
      { assignee_account_id: s.me.accountId },
    ]) {
      const res = await send(s.me, s.ws, s.conversationId, 'assign', body);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    }
    expect(
      (await send(s.me, s.ws, s.conversationId, 'unassign', { expected_state_version: -1 }))
        .statusCode,
    ).toBe(400);
  });

  // ───────── close and reopen (flows 7 and 8) ─────────

  /** Past every seeded message (T = 2026-10-11): such a member has read nothing new to ask about. */
  const SINCE = new Date('2026-10-12T00:00:00Z');
  const RECEIVED = new Date('2026-10-11T10:00:00Z');
  const ANSWERED = new Date('2026-10-11T11:00:00Z');
  const quiet = (ws: string, name = 'Quiet') => member(ws, 'operator', 'active', name, SINCE);

  /** An open conversation that gives no close reason to a `quiet` member: answered, nothing sent. */
  const calm = async (ws: string, o: { status?: 'open' | 'closed'; assignee?: string } = {}) => {
    const contact = await insertContact(db, { workspaceId: ws, firstName: 'Bea' });
    const id = await insertConversation(db, {
      workspaceId: ws,
      contactId: contact,
      lastReplySentAt: ANSWERED,
      lastActivityAt: ANSWERED,
      customerMessageSeq: 2,
      status: o.status,
      assigneeAccountId: o.assignee,
    });
    await insertMessage(db, { workspaceId: ws, conversationId: id, telegramMessageId: 1n });
    return { id, contact };
  };
  const summaryOf = async (who: Who, ws: string, id: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `${base(ws)}/${id}`,
        cookies: who.cookies,
      })
    ).json() as {
      state_version: number;
      close_snapshot: { customer_message_seq: number; latest_reply: unknown };
    };
  const closeBody = async (who: Who, ws: string, id: string, confirm = false) => {
    const c = await summaryOf(who, ws, id);
    return {
      expected_state_version: c.state_version,
      expected_close_snapshot: c.close_snapshot,
      confirm_close_reasons: confirm,
    };
  };
  const reasonsOf = (res: { json: () => unknown }) =>
    ((errorOf(res).details as { reasons: string[] }).reasons ?? []).slice().sort();

  it('AC-05: closes with no reason at once, keeps the assignee, and reopens from the thread', async () => {
    const s = await seed();
    const q = await quiet(s.ws);
    const { id } = await calm(s.ws, { assignee: s.mate.accountId });
    const res = await send(q, s.ws, id, 'close', await closeBody(q, s.ws, id));
    expect(res.statusCode).toBe(200);
    expect(ConversationStateChange.parse(res.json())).toMatchObject({
      outcome: 'recorded',
      conversation: {
        status: 'closed',
        state_version: 1,
        assignee: { account_id: s.mate.accountId },
      },
      activity: { kind: 'closed', cause: 'member', actor: { account_id: q.accountId } },
    });

    const reopened = await send(q, s.ws, id, 'reopen', { expected_state_version: 1 });
    expect(reopened.statusCode).toBe(200);
    expect(ConversationStateChange.parse(reopened.json())).toMatchObject({
      outcome: 'recorded',
      conversation: {
        status: 'open',
        state_version: 2,
        assignee: { account_id: s.mate.accountId },
      },
      activity: { kind: 'reopened', previous_assignee: null, new_assignee: null },
    });
    expect((await entries(id)).map((e) => e.kind)).toEqual(['closed', 'reopened']);
  });

  it('AC-06: each close reason alone is 409 CLOSE_NEEDS_CONFIRMATION and changes nothing', async () => {
    const s = await seed();
    const q = await quiet(s.ws);
    const cases: [string, (id: string, contact: string) => Promise<void>, object?][] = [
      [
        'customer_waiting',
        async (id) => {
          await db
            .updateTable('conversations')
            .set({ last_reply_sent_at: null, last_activity_at: RECEIVED })
            .where('id', '=', id)
            .execute();
        },
      ],
      [
        'unread_customer_message',
        async (id) => {
          await insertMessage(db, {
            workspaceId: s.ws,
            conversationId: id,
            telegramMessageId: 2n,
            receivedAt: new Date('2026-10-13T00:00:00Z'),
          });
        },
      ],
      [
        'reply_not_delivered',
        async (id) => {
          await insertReply(db, {
            workspaceId: s.ws,
            conversationId: id,
            authorAccountId: s.me.accountId,
            state: 'not_delivered',
          });
        },
      ],
      [
        'reply_not_confirmed',
        async (id) => {
          await insertReply(db, {
            workspaceId: s.ws,
            conversationId: id,
            authorAccountId: s.me.accountId,
            state: 'not_confirmed',
          });
        },
      ],
    ];
    for (const [reason, prepare] of cases) {
      const { id, contact } = await calm(s.ws);
      await prepare(id, contact);
      const res = await send(q, s.ws, id, 'close', await closeBody(q, s.ws, id));
      expect(res.statusCode, reason).toBe(409);
      expect(errorOf(res).code).toBe('CLOSE_NEEDS_CONFIRMATION');
      expect(reasonsOf(res), reason).toEqual([reason]);
      expect((await rowOf(id)).status).toBe('open');
      expect(await entries(id)).toHaveLength(0);
    }
  });

  it('AC-06: a stale version alone is state_changed, with the latest change; a counter that grew alone is new_customer_message', async () => {
    const s = await seed();
    const q = await quiet(s.ws);
    const { id } = await calm(s.ws);
    const body = await closeBody(q, s.ws, id);
    await send(s.mate, s.ws, id, 'assign', {
      assignee_account_id: s.mate.accountId,
      expected_state_version: 0,
    });
    const stale = await send(q, s.ws, id, 'close', body);
    expect(stale.statusCode).toBe(409);
    expect(errorOf(stale).code).toBe('CLOSE_NEEDS_CONFIRMATION');
    expect(reasonsOf(stale)).toEqual(['state_changed']);
    expect(errorOf(stale).details).toMatchObject({
      stale_change: { kind: 'assigned' },
      conversation: { state_version: 1 },
    });

    const fresh = await closeBody(q, s.ws, id);
    await db
      .updateTable('conversations')
      .set({ customer_message_seq: 3 })
      .where('id', '=', id)
      .execute();
    const grew = await send(q, s.ws, id, 'close', fresh);
    expect(reasonsOf(grew)).toEqual(['new_customer_message']);
  });

  it('AC-06: every reason together are all named once', async () => {
    const s = await seed();
    const q = await quiet(s.ws);
    const { id } = await calm(s.ws);
    const body = await closeBody(q, s.ws, id);
    await db
      .updateTable('conversations')
      .set({ last_reply_sent_at: null, last_activity_at: RECEIVED, customer_message_seq: 3 })
      .where('id', '=', id)
      .execute();
    await insertMessage(db, {
      workspaceId: s.ws,
      conversationId: id,
      telegramMessageId: 2n,
      receivedAt: new Date('2026-10-13T00:00:00Z'),
    });
    await insertReply(db, {
      workspaceId: s.ws,
      conversationId: id,
      authorAccountId: s.me.accountId,
      state: 'not_delivered',
    });
    await send(s.mate, s.ws, id, 'assign', {
      assignee_account_id: s.mate.accountId,
      expected_state_version: 0,
    });
    const res = await send(q, s.ws, id, 'close', body);
    expect(res.statusCode).toBe(409);
    expect(reasonsOf(res)).toEqual(
      [
        'customer_waiting',
        'new_customer_message',
        'reply_not_delivered',
        'state_changed',
        'unread_customer_message',
      ].sort(),
    );
    const details = errorOf(res).details as { newest_unread_message: { id: string } | null };
    expect(details.newest_unread_message).not.toBeNull();
  });

  it('AC-06: close anyway with the refusal snapshot records; unread counts do not move', async () => {
    const s = await seed();
    const q = await quiet(s.ws);
    const { id } = await calm(s.ws);
    await db
      .updateTable('conversations')
      .set({ last_reply_sent_at: null, last_activity_at: RECEIVED })
      .where('id', '=', id)
      .execute();
    const refused = await send(q, s.ws, id, 'close', await closeBody(q, s.ws, id));
    expect(refused.statusCode).toBe(409);
    const shown = (
      errorOf(refused).details as {
        conversation: { state_version: number; close_snapshot: unknown };
      }
    ).conversation;
    const anyway = await send(q, s.ws, id, 'close', {
      expected_state_version: shown.state_version,
      expected_close_snapshot: shown.close_snapshot,
      confirm_close_reasons: true,
    });
    expect(anyway.statusCode).toBe(200);
    expect(ConversationStateChange.parse(anyway.json())).toMatchObject({
      outcome: 'recorded',
      conversation: { status: 'closed' },
      activity: { kind: 'closed' },
    });
  });

  it('AC-06: confirm without a prior refusal but with the current snapshot is recorded', async () => {
    const s = await seed();
    const q = await quiet(s.ws);
    const { id } = await calm(s.ws);
    await db
      .updateTable('conversations')
      .set({ last_reply_sent_at: null, last_activity_at: RECEIVED })
      .where('id', '=', id)
      .execute();
    const res = await send(q, s.ws, id, 'close', await closeBody(q, s.ws, id, true));
    expect(res.statusCode).toBe(200);
    expect((await rowOf(id)).status).toBe('closed');
  });

  it('AC-06: a customer message captured between the question and the close asks again', async () => {
    const s = await seed();
    const q = await quiet(s.ws);
    const { id } = await calm(s.ws);
    await db
      .updateTable('conversations')
      .set({ last_reply_sent_at: null, last_activity_at: RECEIVED })
      .where('id', '=', id)
      .execute();
    const refused = await send(q, s.ws, id, 'close', await closeBody(q, s.ws, id));
    const shown = (
      errorOf(refused).details as {
        conversation: { state_version: number; close_snapshot: unknown };
      }
    ).conversation;
    await db
      .updateTable('conversations')
      .set({ customer_message_seq: 3 })
      .where('id', '=', id)
      .execute();
    const again = await send(q, s.ws, id, 'close', {
      expected_state_version: shown.state_version,
      expected_close_snapshot: shown.close_snapshot,
      confirm_close_reasons: true,
    });
    expect(again.statusCode).toBe(409);
    expect(reasonsOf(again)).toContain('new_customer_message');
    expect((await rowOf(id)).status).toBe('open');
  });

  it('AC-06: a failed reply between the question and the close asks again', async () => {
    const s = await seed();
    const q = await quiet(s.ws);
    const { id } = await calm(s.ws);
    await db
      .updateTable('conversations')
      .set({ last_reply_sent_at: null, last_activity_at: RECEIVED })
      .where('id', '=', id)
      .execute();
    const refused = await send(q, s.ws, id, 'close', await closeBody(q, s.ws, id));
    const shown = (
      errorOf(refused).details as {
        conversation: { state_version: number; close_snapshot: unknown };
      }
    ).conversation;
    await insertReply(db, {
      workspaceId: s.ws,
      conversationId: id,
      authorAccountId: s.me.accountId,
      state: 'not_delivered',
    });
    const again = await send(q, s.ws, id, 'close', {
      expected_state_version: shown.state_version,
      expected_close_snapshot: shown.close_snapshot,
      confirm_close_reasons: true,
    });
    expect(again.statusCode).toBe(409);
    expect(reasonsOf(again)).toContain('reply_not_delivered');
    expect((await rowOf(id)).status).toBe('open');
  });

  it('AC-06: closing what a teammate closed meanwhile is unchanged, even with a stale version', async () => {
    const s = await seed();
    const q = await quiet(s.ws);
    const { id } = await calm(s.ws);
    const body = await closeBody(q, s.ws, id);
    expect(
      (await send(s.mate, s.ws, id, 'close', { ...body, confirm_close_reasons: true })).statusCode,
    ).toBe(200);
    const res = await send(q, s.ws, id, 'close', body);
    expect(res.statusCode).toBe(200);
    expect(ConversationStateChange.parse(res.json())).toMatchObject({
      outcome: 'unchanged',
      activity: null,
    });
    expect(await entries(id)).toHaveLength(1);
  });

  it('AC-05/AC-03: reopen is recorded, unchanged when already open, 409 CONVERSATION_STATE_CHANGED when stale', async () => {
    const s = await seed();
    const q = await quiet(s.ws);
    const { id } = await calm(s.ws, { status: 'closed' });
    const stale = await send(q, s.ws, id, 'reopen', { expected_state_version: 5 });
    expect(stale.statusCode).toBe(409);
    expect(errorOf(stale).code).toBe('CONVERSATION_STATE_CHANGED');
    expect((await rowOf(id)).status).toBe('closed');

    const ok = await send(q, s.ws, id, 'reopen', { expected_state_version: 0 });
    expect(ConversationStateChange.parse(ok.json())).toMatchObject({
      outcome: 'recorded',
      conversation: { status: 'open' },
      activity: { kind: 'reopened' },
    });
    const again = await send(q, s.ws, id, 'reopen', { expected_state_version: 0 });
    expect(again.statusCode).toBe(200);
    expect(ConversationStateChange.parse(again.json())).toMatchObject({
      outcome: 'unchanged',
      activity: null,
    });
    expect(await entries(id)).toHaveLength(1);
  });

  it('AC-11: close and reopen need a session, a workspace and an active member', async () => {
    const s = await seed();
    const q = await quiet(s.ws);
    const outsider = await member(await insertWorkspace(db, 'Elsewhere'));
    const gone = await member(s.ws, 'operator', 'deactivated');
    const t = await seed();
    const { id } = await calm(s.ws);
    const body = await closeBody(q, s.ws, id);
    expect((await send(null, s.ws, id, 'close', body)).statusCode).toBe(401);
    expect((await send(outsider, s.ws, id, 'close', body)).statusCode).toBe(404);
    expect((await send(gone, s.ws, id, 'close', body)).statusCode).toBe(403);
    expect((await send(gone, s.ws, id, 'reopen', { expected_state_version: 0 })).statusCode).toBe(
      403,
    );
    expect((await send(q, s.ws, t.conversationId, 'close', body)).statusCode).toBe(404);
    expect(
      (await send(q, s.ws, t.conversationId, 'reopen', { expected_state_version: 0 })).statusCode,
    ).toBe(404);
    expect((await send(q, s.ws, id, 'close', { expected_state_version: 0 })).statusCode).toBe(400);
    expect((await rowOf(id)).status).toBe('open');
  });

  // ───────── AC-12 the change limit, across the four routes ─────────

  describe('the change limit', () => {
    type Req = { verb: 'assign' | 'unassign' | 'close' | 'reopen'; id: string; body: object };
    /** Four change kinds, each a recorded change on its own fresh conversation. */
    const batch = async (ws: string, who: Who, mate: Who, count: number): Promise<Req[]> => {
      const reqs: Req[] = [];
      for (let i = 0; i < count; i++) {
        const verb = (['assign', 'unassign', 'close', 'reopen'] as const)[i % 4]!;
        const c = await calm(ws, {
          status: verb === 'reopen' ? 'closed' : 'open',
          assignee: verb === 'unassign' ? mate.accountId : undefined,
        });
        const body =
          verb === 'assign'
            ? { assignee_account_id: who.accountId, expected_state_version: 0 }
            : verb === 'close'
              ? await closeBody(who, ws, c.id)
              : { expected_state_version: 0 };
        reqs.push({ verb, id: c.id, body });
      }
      return reqs;
    };
    const fire = (ws: string, who: Who, r: Req) => send(who, ws, r.id, r.verb, r.body);

    it('the 61st change across assign, unassign, close and reopen is 429 with Retry-After', async () => {
      const s = await seed();
      const q = await quiet(s.ws);
      const reqs = await batch(s.ws, q, s.mate, 61);
      for (const r of reqs.slice(0, 60)) expect((await fire(s.ws, q, r)).statusCode).toBe(200);
      const last = await fire(s.ws, q, reqs[60]!);
      expect(last.statusCode).toBe(429);
      expect(last.headers['retry-after']).toBe('60');
      expect(errorOf(last)).toMatchObject({
        code: 'CHANGE_LIMIT_REACHED',
        details: { limit: 60, window_seconds: 60, retry_at: '2026-10-18T10:01:00.000Z' },
      });
      expect(await entries(reqs[60]!.id)).toHaveLength(0);
    });

    it('refused, unchanged and automatic changes are not counted; another workspace is not affected', async () => {
      const s = await seed();
      const q = await quiet(s.ws);
      const other = await insertWorkspace(db, 'Other shop');
      // The same account, a member of a second workspace.
      await insertMembership(db, other, { accountId: q.accountId, activeSince: SINCE });
      const reqs = await batch(s.ws, q, s.mate, 61);
      // A refused (stale), an unchanged and an automatic change first: none counts.
      const stale = await fire(s.ws, q, {
        ...reqs[0]!,
        body: { assignee_account_id: q.accountId, expected_state_version: 9 },
      });
      expect(stale.statusCode).toBe(409);
      const noop = await calm(s.ws, { status: 'closed' });
      const unchanged = await send(q, s.ws, noop.id, 'close', await closeBody(q, s.ws, noop.id));
      expect(ConversationStateChange.parse(unchanged.json()).outcome).toBe('unchanged');
      await insertActivity(db, {
        workspaceId: s.ws,
        conversationId: noop.id,
        kind: 'reopened',
        cause: 'customer_wrote',
        actorAccountId: null,
        createdAt: NOW,
        positionAt: NOW,
      });
      for (const r of reqs.slice(0, 60)) expect((await fire(s.ws, q, r)).statusCode).toBe(200);
      expect((await fire(s.ws, q, reqs[60]!)).statusCode).toBe(429);

      const elsewhere = await calm(other);
      const res = await send(
        q,
        other,
        elsewhere.id,
        'close',
        await closeBody(q, other, elsewhere.id),
      );
      expect(res.statusCode).toBe(200);
    });

    it('61 concurrent mixed changes record exactly 60 and refuse the rest', async () => {
      const s = await seed();
      const q = await quiet(s.ws);
      const reqs = await batch(s.ws, q, s.mate, 61);
      const results = await Promise.all(reqs.map((r) => fire(s.ws, q, r)));
      expect(results.filter((r) => r.statusCode === 200)).toHaveLength(60);
      const refused = results.filter((r) => r.statusCode === 429);
      expect(refused).toHaveLength(1);
      expect(refused[0]!.headers['retry-after']).toBeDefined();
      const recorded = await db
        .selectFrom('conversation_activities')
        .select(db.fn.countAll<string>().as('n'))
        .where('workspace_id', '=', s.ws)
        .where('actor_account_id', '=', q.accountId)
        .executeTakeFirstOrThrow();
      expect(Number(recorded.n)).toBe(60);
    });
  });

  // ───────── the change timing on a 1 000-conversation workspace ─────────

  it('seeded timing: each change route p95 is within 300 ms on 1 000 conversations', async () => {
    const ws = await insertWorkspace(db, 'Volume shop');
    const mate = await member(ws, 'operator', 'active', 'Mate');
    // One caller per route, so no caller passes the 60-per-minute limit (20 requests each).
    const callers = {
      assign: await quiet(ws, 'A'),
      unassign: await quiet(ws, 'B'),
      close: await quiet(ws, 'C'),
      reopen: await quiet(ws, 'D'),
    };
    const rows = Array.from({ length: 1000 }, (_, i) => {
      const status: 'open' | 'closed' = i % 3 === 0 ? 'closed' : 'open';
      return { i, status, assignee: i % 3 === 1 ? mate.accountId : null };
    });
    for (let from = 0; from < rows.length; from += 250) {
      const chunk = rows.slice(from, from + 250);
      const contacts = chunk.map((r) => ({
        id: `01920000-0000-7000-8${String(r.i).padStart(3, '0')}-0000000000a1`,
        workspace_id: ws,
        telegram_user_id: BigInt(9_000_000 + r.i),
        first_name: 'Test User',
        last_name: null,
        username: null,
        language_code: 'en',
        profile_seen_at: ANSWERED,
        created_at: ANSWERED,
      }));
      await db.insertInto('contacts').values(contacts).execute();
      await db
        .insertInto('conversations')
        .values(
          chunk.map((r, k) => ({
            id: `01920000-0000-7000-8${String(r.i).padStart(3, '0')}-0000000000c1`,
            workspace_id: ws,
            contact_id: contacts[k]!.id,
            telegram_chat_id: contacts[k]!.telegram_user_id,
            created_at: ANSWERED,
            last_activity_at: ANSWERED,
            last_message_received_at: new Date('2026-10-11T10:00:00Z'),
            last_reply_sent_at: ANSWERED,
            status: r.status,
            assignee_account_id: r.assignee,
            state_version: 0,
            customer_message_seq: 1,
          })),
        )
        .execute();
      await db
        .insertInto('messages')
        .values(
          chunk.map((r) => ({
            id: `01920000-0000-7000-8${String(r.i).padStart(3, '0')}-0000000000e1`,
            workspace_id: ws,
            conversation_id: `01920000-0000-7000-8${String(r.i).padStart(3, '0')}-0000000000c1`,
            telegram_message_id: BigInt(r.i + 1),
            kind: 'text',
            body: 'Hello',
            telegram_message: JSON.stringify({ message_id: r.i + 1 }),
            sent_at: RECEIVED,
            received_at: RECEIVED,
            edited_at: null,
            edit_update_id: null,
          })),
        )
        .execute();
    }
    const conv = (i: number) => `01920000-0000-7000-8${String(i).padStart(3, '0')}-0000000000c1`;
    const open = rows.filter((r) => r.status === 'open');
    const closed = rows.filter((r) => r.status === 'closed');
    const plan: Record<keyof typeof callers, { id: string; body: object }[]> = {
      assign: open
        .filter((r) => r.assignee === null)
        .slice(0, 20)
        .map((r) => ({
          id: conv(r.i),
          body: { assignee_account_id: callers.assign.accountId, expected_state_version: 0 },
        })),
      unassign: open
        .filter((r) => r.assignee !== null)
        .slice(0, 20)
        .map((r) => ({ id: conv(r.i), body: { expected_state_version: 0 } })),
      close: open
        .filter((r) => r.assignee === null)
        .slice(20, 40)
        .map((r) => ({
          id: conv(r.i),
          body: {
            expected_state_version: 0,
            expected_close_snapshot: { customer_message_seq: 1, latest_reply: null },
            confirm_close_reasons: false,
          },
        })),
      reopen: closed
        .slice(0, 20)
        .map((r) => ({ id: conv(r.i), body: { expected_state_version: 0 } })),
    };
    for (const verb of ['assign', 'unassign', 'close', 'reopen'] as const) {
      const times: number[] = [];
      for (const r of plan[verb]) {
        const started = performance.now();
        const res = await send(callers[verb], ws, r.id, verb, r.body);
        times.push(performance.now() - started);
        expect(res.statusCode, `${verb} ${res.body}`).toBe(200);
        expect(ConversationStateChange.parse(res.json()).outcome).toBe('recorded');
      }
      times.sort((a, b) => a - b);
      const p95 = times[Math.ceil(times.length * 0.95) - 1]!;
      expect(times).toHaveLength(20);
      expect(p95, `${verb} p95 ${p95.toFixed(0)} ms`).toBeLessThanOrEqual(300);
    }
  }, 60_000);
});
