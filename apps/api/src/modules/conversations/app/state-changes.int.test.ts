import { pino } from 'pino';
import type { Transaction } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import type { DB } from '../../../platform/db.types.gen.js';
import { startRealtimeListener, type RealtimeSignal } from '../../../platform/realtime.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import {
  insertActivity,
  insertConversation,
  insertMessage,
  insertReply,
  twoWorkspacesWithInbox,
} from '../../../test/fixtures/conversations.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import type { CloseSnapshot } from '../domain/state.js';
import { createActivityRepo } from '../infra/activity-repo.js';
import { createConversationRepo } from '../infra/conversation-repo.js';
import { createConversationSignals } from '../infra/conversation-signals.js';
import { createStateChanges, type ChangeResult } from './state-changes.js';

const B = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(B.getTime() + s * 1000);
const NOW = at(100);
const NO_REPLY: CloseSnapshot = { customerMessageSeq: 0, latestReply: null };

describe('state changes (Postgres)', () => {
  let database: TestDatabase;
  let db: Db;
  let nextUser = 900000n;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url, { max: 20 });
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  function sc() {
    return createStateChanges({
      conversations: createConversationRepo(db),
      activities: createActivityRepo(db),
      signals: createConversationSignals(),
      clock: fixedClock(NOW),
    });
  }
  const inTx = <T>(fn: (tx: Transaction<DB>) => Promise<T>) => db.transaction().execute(fn);

  async function conversation(
    workspaceId: string,
    o: Partial<Parameters<typeof insertConversation>[1]> = {},
  ) {
    const contactId = await insertContact(db, { workspaceId, telegramUserId: nextUser++ });
    return insertConversation(db, { workspaceId, contactId, ...o });
  }

  /** Answered and read: the reply is newer than the customer message and the member has seen it. */
  async function cleanConversation(workspaceId: string, accountId: string) {
    const id = await conversation(workspaceId, {
      lastMessageReceivedAt: B,
      lastReplySentAt: at(10),
      lastActivityAt: at(10),
    });
    await insertMessage(db, {
      workspaceId,
      conversationId: id,
      telegramMessageId: 1n,
      receivedAt: B,
    });
    await insertReply(db, {
      workspaceId,
      conversationId: id,
      authorAccountId: accountId,
      state: 'sent',
      positionAt: at(10),
    });
    return id;
  }

  const assign = (
    workspaceId: string,
    actorAccountId: string,
    conversationId: string,
    assigneeAccountId: string | null,
    expectedStateVersion = 0,
  ) =>
    inTx<ChangeResult>((tx) =>
      sc().changeAssignee(tx, {
        workspaceId,
        actorAccountId,
        conversationId,
        assigneeAccountId,
        expectedStateVersion,
      }),
    );

  const close = (
    workspaceId: string,
    actorAccountId: string,
    conversationId: string,
    o: { snapshot?: CloseSnapshot; confirm?: boolean; version?: number; activeSince?: Date } = {},
  ) =>
    inTx<ChangeResult>((tx) =>
      sc().changeStatus(tx, {
        workspaceId,
        actorAccountId,
        conversationId,
        to: 'closed',
        expectedStateVersion: o.version ?? 0,
        expectedCloseSnapshot: o.snapshot ?? NO_REPLY,
        confirm: o.confirm ?? false,
        actorActiveSince: o.activeSince ?? at(50),
      }),
    );

  const rowOf = (id: string) =>
    db
      .selectFrom('conversations')
      .select(['status', 'assignee_account_id', 'state_version'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  const activityCount = async (conversationId: string) =>
    (
      await db
        .selectFrom('conversation_activities')
        .select('id')
        .where('conversation_id', '=', conversationId)
        .execute()
    ).length;

  it('records an assignment: row, version, one entry at the clock time', async () => {
    const { a, sharedAccountId } = await twoWorkspacesWithInbox(db);
    const id = await conversation(a.workspaceId);
    const r = await assign(a.workspaceId, a.accountId, id, sharedAccountId);
    expect(r.outcome).toBe('recorded');
    expect(await rowOf(id)).toMatchObject({
      assignee_account_id: sharedAccountId,
      state_version: 1,
    });
    expect(await activityCount(id)).toBe(1);
  });

  it('QG-1 (a): a close with each reason is refused, and close-anyway with the returned snapshot closes', async () => {
    const { a } = await twoWorkspacesWithInbox(db);
    const w = a.workspaceId;
    const actor = a.accountId;
    const cases: Array<{ reason: string; make: () => Promise<string> }> = [
      {
        reason: 'customer_waiting',
        make: () => conversation(w, { lastMessageReceivedAt: B, lastReplySentAt: null }),
      },
      {
        reason: 'unread_customer_message',
        make: async () => {
          const id = await cleanConversation(w, actor);
          await insertMessage(db, {
            workspaceId: w,
            conversationId: id,
            telegramMessageId: 2n,
            receivedAt: at(60),
          });
          return id;
        },
      },
      {
        reason: 'reply_not_delivered',
        make: async () => {
          const id = await cleanConversation(w, actor);
          await insertReply(db, {
            workspaceId: w,
            conversationId: id,
            authorAccountId: actor,
            state: 'not_delivered',
            positionAt: at(20),
          });
          return id;
        },
      },
      {
        reason: 'reply_not_confirmed',
        make: async () => {
          const id = await cleanConversation(w, actor);
          await insertReply(db, {
            workspaceId: w,
            conversationId: id,
            authorAccountId: actor,
            state: 'not_confirmed',
            positionAt: at(20),
          });
          return id;
        },
      },
    ];
    for (const c of cases) {
      const id = await c.make();
      const first = await close(w, actor, id);
      if (first.outcome !== 'needs_confirmation') throw new Error(`${c.reason}: ${first.outcome}`);
      expect(first.reasons).toContain(c.reason);
      expect((await rowOf(id)).status).toBe('open');
      expect(await activityCount(id)).toBe(0);
      const second = await close(w, actor, id, { snapshot: first.snapshot, confirm: true });
      expect(second.outcome, c.reason).toBe('recorded');
      expect((await rowOf(id)).status).toBe('closed');
    }
  });

  it('a clean close of an answered, read conversation needs no confirmation', async () => {
    const { a } = await twoWorkspacesWithInbox(db);
    const id = await cleanConversation(a.workspaceId, a.accountId);
    const r = await close(a.workspaceId, a.accountId, id, { activeSince: at(50) });
    expect(r.outcome).toBe('recorded');
  });

  it('QG-1 (b2): a first close after a message the screen has not shown is refused with new_customer_message', async () => {
    const { a } = await twoWorkspacesWithInbox(db);
    const id = await cleanConversation(a.workspaceId, a.accountId);
    await db
      .updateTable('conversations')
      .set({ customer_message_seq: 3 })
      .where('id', '=', id)
      .execute();
    const r = await close(a.workspaceId, a.accountId, id, {
      snapshot: { customerMessageSeq: 2, latestReply: null },
    });
    if (r.outcome !== 'needs_confirmation') throw new Error(r.outcome);
    expect(r.reasons).toEqual(['new_customer_message']);
    expect(r.snapshot.customerMessageSeq).toBe(3);
    expect((await rowOf(id)).status).toBe('open');
  });

  it('QG-1 (d): two concurrent assigns with the same version: one recorded, the other stale', async () => {
    const { a, sharedAccountId } = await twoWorkspacesWithInbox(db);
    const id = await conversation(a.workspaceId);
    const results = await Promise.all([
      assign(a.workspaceId, a.accountId, id, a.accountId),
      assign(a.workspaceId, sharedAccountId, id, sharedAccountId),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(['recorded', 'stale']);
    expect(await activityCount(id)).toBe(1);
    expect((await rowOf(id)).state_version).toBe(1);
  });

  it('refuses the 61st of 61 concurrent changes with retry_at, and writes only 60', async () => {
    const { a, sharedAccountId } = await twoWorkspacesWithInbox(db);
    const ids = await Promise.all(Array.from({ length: 61 }, () => conversation(a.workspaceId)));
    const results = await Promise.all(
      ids.map((id) => assign(a.workspaceId, a.accountId, id, sharedAccountId)),
    );
    expect(results.filter((r) => r.outcome === 'recorded')).toHaveLength(60);
    const limited = results.filter((r) => r.outcome === 'limited');
    expect(limited).toHaveLength(1);
    expect(limited[0]).toEqual({ outcome: 'limited', retryAt: at(160) });
    const written = await db
      .selectFrom('conversation_activities')
      .select('id')
      .where('actor_account_id', '=', a.accountId)
      .where('workspace_id', '=', a.workspaceId)
      .where('conversation_id', 'in', ids)
      .execute();
    expect(written).toHaveLength(60);
  });

  it('refused, unchanged and unconfirmed requests are not counted; the limit is per workspace', async () => {
    const { a, b, sharedAccountId } = await twoWorkspacesWithInbox(db);
    const w = a.workspaceId;
    const mate = a.accountId;
    const holder = await conversation(w, { assigneeAccountId: mate, stateVersion: 1 });
    for (let i = 0; i < 59; i++) {
      await insertActivity(db, {
        workspaceId: w,
        conversationId: holder,
        kind: 'closed',
        actorAccountId: sharedAccountId,
        positionAt: at(70 + i * 0.01),
        createdAt: at(70),
      });
    }
    const target = await conversation(w);
    const waiting = await conversation(w, { lastReplySentAt: null });
    const closedAlready = await conversation(w, { status: 'closed', assigneeAccountId: mate });
    const me = sharedAccountId;
    expect((await assign(w, me, holder, mate)).outcome).toBe('unchanged'); // already in place
    expect((await assign(w, me, target, mate, 9)).outcome).toBe('stale');
    expect((await close(w, me, waiting)).outcome).toBe('needs_confirmation');
    expect((await close(w, me, closedAlready)).outcome).toBe('unchanged');
    expect(await activityCount(target)).toBe(0);
    // none of these counted: the 60th is still allowed, the 61st is not
    expect((await assign(w, me, target, mate)).outcome).toBe('recorded');
    const next = await conversation(w);
    expect(await assign(w, me, next, mate)).toEqual({ outcome: 'limited', retryAt: at(130) });
    // the limit is per workspace: the same account still changes in the other workspace
    const other = await conversation(b.workspaceId);
    expect((await assign(b.workspaceId, me, other, me)).outcome).toBe('recorded');
  });

  it('publishes one activity signal, only when the transaction commits', async () => {
    const { a, sharedAccountId } = await twoWorkspacesWithInbox(db);
    const listener = await startRealtimeListener(database.url, pino({ level: 'silent' }), {
      reconnectDelayMs: 50,
    });
    const got: RealtimeSignal[] = [];
    listener.onSignal((sig) => got.push(sig));
    try {
      const rolledBack = await conversation(a.workspaceId);
      await expect(
        inTx(async (tx) => {
          await sc().changeAssignee(tx, {
            workspaceId: a.workspaceId,
            actorAccountId: a.accountId,
            conversationId: rolledBack,
            assigneeAccountId: sharedAccountId,
            expectedStateVersion: 0,
          });
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');

      const committed = await conversation(a.workspaceId);
      const r = await assign(a.workspaceId, a.accountId, committed, sharedAccountId);
      if (r.outcome !== 'recorded') throw new Error(r.outcome);
      const end = Date.now() + 10_000;
      while (got.length === 0 && Date.now() < end) await new Promise((res) => setTimeout(res, 25));
      await new Promise((res) => setTimeout(res, 200));
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({
        type: 'conversation.changed',
        workspace_id: a.workspaceId,
        conversation_id: committed,
        item: { type: 'activity', id: r.activity.id },
        change: 'created',
      });
    } finally {
      await listener.stop();
    }
  });
});
