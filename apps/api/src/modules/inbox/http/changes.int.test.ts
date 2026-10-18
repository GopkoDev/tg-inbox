import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationStateChange, ErrorEnvelope } from '@tg/shared';
import { buildApp } from '../../../app.js';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertConversation, insertMessage } from '../../../test/fixtures/conversations.js';
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
  ): Promise<Who> => {
    const account = await insertAccount(db, { displayName });
    const session = await insertSession(db, account.id, {
      createdAt: new Date('2026-10-18T09:00:00Z'),
    });
    const m = await insertMembership(db, workspaceId, { accountId: account.id, role, state });
    return { accountId: account.id, membershipId: m.id, cookies: { session: session.token } };
  };
  const base = (ws: string) => `/api/workspaces/${ws}/inbox/conversations`;
  const send = (
    who: Who | null,
    ws: string,
    id: string,
    verb: 'assign' | 'unassign',
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
});
