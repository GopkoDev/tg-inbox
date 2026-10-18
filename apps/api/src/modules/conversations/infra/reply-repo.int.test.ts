import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PgBoss } from 'pg-boss';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { startJobs, jobDb } from '../../../platform/jobs.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import {
  insertConversation,
  insertReply,
  insertReplyAttempt,
} from '../../../test/fixtures/conversations.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { fakeConversationSignals } from '../app/fakes.js';
import type { EnqueueDrain } from '../app/ports.js';
import { createReplies } from '../app/replies.js';
import { createReplyRepo } from './reply-repo.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const SHARED_KEY = '01920000-0000-7000-8000-0000000000aa';
const QUEUE = 'inbox.deliver-replies';

describe('reply requests (Postgres)', () => {
  let database: TestDatabase;
  let db: Db;
  let boss: PgBoss;
  const clock = fixedClock(at(1000));
  const signals = fakeConversationSignals();

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url, { max: 40 });
    boss = await startJobs(database.url);
    await boss.createQueue(QUEUE);
  });

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await db?.destroy();
    await database?.stop();
  });

  const repo = () => createReplyRepo(db);
  const service = () =>
    createReplies({
      transaction: (fn) => db.transaction().execute(fn),
      replies: repo(),
      signals,
      clock,
    });
  const enqueueDrain: EnqueueDrain = async (tx, workspaceId, conversationId) => {
    await boss.send(QUEUE, { workspaceId, conversationId }, { db: jobDb(tx) });
  };
  const input = (s: Awaited<ReturnType<typeof setup>>, o: Record<string, unknown> = {}) => ({
    workspaceId: s.workspaceId,
    conversationId: s.conversationId,
    authorId: s.accountId,
    clientKey: crypto.randomUUID(),
    body: 'Hi',
    lastSeenReplyId: null,
    confirmTeammate: false,
    limit: 30,
    windowMs: 60_000,
    enqueueDrain,
    ...o,
  });

  async function setup() {
    const workspaceId = await insertWorkspace(db);
    const { accountId } = await insertMembership(db, workspaceId);
    const { accountId: mateId } = await insertMembership(db, workspaceId);
    const contactId = await insertContact(db, { workspaceId });
    const conversationId = await insertConversation(db, { workspaceId, contactId });
    return { workspaceId, accountId, mateId, conversationId };
  }

  const jobsFor = async (conversationId: string) =>
    (
      await db
        .selectFrom('pgboss.job' as never)
        .selectAll()
        .where('name' as never, '=', QUEUE as never)
        .execute()
    ).filter(
      (j) => (j as { data: { conversationId: string } }).data.conversationId === conversationId,
    );

  it('stores the reply, its send attempt and the drain job together; a double submit finds the same reply (AC-11)', async () => {
    const s = await setup();
    const key = crypto.randomUUID();
    const first = await service().createReply(input(s, { clientKey: key }));
    const again = await service().createReply(input(s, { clientKey: key }));
    expect(first.status).toBe('created');
    expect(again.status).toBe('existing');
    const replies = await db
      .selectFrom('replies')
      .selectAll()
      .where('conversation_id', '=', s.conversationId)
      .execute();
    expect(replies).toMatchObject([
      { state: 'sending', body: 'Hi', author_account_id: s.accountId },
    ]);
    const attempts = await db
      .selectFrom('reply_attempts')
      .selectAll()
      .where('conversation_id', '=', s.conversationId)
      .execute();
    expect(attempts).toMatchObject([
      { kind: 'send', initiated_by_account_id: s.accountId, started_at: null },
    ]);
    expect(await jobsFor(s.conversationId)).toHaveLength(1);
  });

  it('rolls reply, attempt and job back together when a later step fails', async () => {
    const s = await setup();
    const failing: EnqueueDrain = async (tx, w, c) => {
      await enqueueDrain(tx, w, c);
      throw new Error('boom');
    };
    await expect(service().createReply(input(s, { enqueueDrain: failing }))).rejects.toThrow(
      'boom',
    );
    expect(
      await db
        .selectFrom('replies')
        .selectAll()
        .where('conversation_id', '=', s.conversationId)
        .execute(),
    ).toEqual([]);
    expect(
      await db
        .selectFrom('reply_attempts')
        .selectAll()
        .where('conversation_id', '=', s.conversationId)
        .execute(),
    ).toEqual([]);
    expect(await jobsFor(s.conversationId)).toEqual([]);
  });

  it('stores two replies with the same text and different keys', async () => {
    const s = await setup();
    await service().createReply(input(s));
    await service().createReply(input(s));
    const n = await db
      .selectFrom('replies')
      .select('id')
      .where('conversation_id', '=', s.conversationId)
      .execute();
    expect(n).toHaveLength(2);
  });

  it('accepts exactly 30 of 31 concurrent creates by one member and reports when the oldest leaves (AC-12b)', async () => {
    const s = await setup();
    const results = await Promise.all(
      Array.from({ length: 31 }, () => service().createReply(input(s))),
    );
    expect(results.filter((r) => r.status === 'created')).toHaveLength(30);
    const limited = results.filter((r) => r.status === 'limited');
    expect(limited).toHaveLength(1);
    expect(limited[0]).toEqual({ status: 'limited', retryAt: at(1060) });
    const stored = await db
      .selectFrom('replies')
      .select('id')
      .where('conversation_id', '=', s.conversationId)
      .execute();
    expect(stored).toHaveLength(30);
  });

  it('does not count automatic retries, other members, or another workspace (limit is per workspace)', async () => {
    const s = await setup();
    const other = await setup();
    // 30 automatic retries (no initiator) and 30 attempts by a teammate
    for (let i = 0; i < 30; i++) {
      const r = await insertReply(db, {
        workspaceId: s.workspaceId,
        conversationId: s.conversationId,
        authorAccountId: s.mateId,
      });
      await insertReplyAttempt(db, {
        workspaceId: s.workspaceId,
        conversationId: s.conversationId,
        replyId: r,
        kind: 'retry',
        createdAt: clock.now(),
      });
      await insertReplyAttempt(db, {
        workspaceId: s.workspaceId,
        conversationId: s.conversationId,
        replyId: r,
        initiatedByAccountId: s.mateId,
        createdAt: clock.now(),
      });
    }
    expect((await service().createReply(input(s, { confirmTeammate: true }))).status).toBe(
      'created',
    );
    // the same account counted in another workspace is untouched
    const count = await repo().lockAndCountAttempts(other.workspaceId, s.accountId, at(0));
    expect(count).toEqual({ count: 0, oldest: null });
  });

  it('refuses when a teammate replied after the last seen reply, unless confirmed (AC-16)', async () => {
    const s = await setup();
    const mine = await insertReply(db, {
      workspaceId: s.workspaceId,
      conversationId: s.conversationId,
      authorAccountId: s.accountId,
      positionAt: at(10),
    });
    const mate = await insertReply(db, {
      workspaceId: s.workspaceId,
      conversationId: s.conversationId,
      authorAccountId: s.mateId,
      positionAt: at(20),
    });
    const refused = await service().createReply(input(s, { lastSeenReplyId: mine }));
    expect(refused).toMatchObject({
      status: 'teammate',
      reply: { id: mate, authorAccountId: s.mateId },
    });
    expect((await service().createReply(input(s, { lastSeenReplyId: mate }))).status).toBe(
      'created',
    );
    expect(
      (await service().createReply(input(s, { lastSeenReplyId: mine, confirmTeammate: true })))
        .status,
    ).toBe('created');
    expect(
      (await service().createReply(input(s, { lastSeenReplyId: crypto.randomUUID() }))).status,
    ).toBe('teammate');
  });

  describe('requeueReply', () => {
    async function failedReply(state: 'not_delivered' | 'not_confirmed') {
      const s = await setup();
      const replyId = await insertReply(db, {
        workspaceId: s.workspaceId,
        conversationId: s.conversationId,
        authorAccountId: s.accountId,
        state,
        positionAt: at(10),
      });
      const args = (o: Record<string, unknown> = {}) => ({
        workspaceId: s.workspaceId,
        conversationId: s.conversationId,
        replyId,
        memberId: s.accountId,
        confirmDuplicate: false,
        limit: 30,
        windowMs: 60_000,
        enqueueDrain,
        ...o,
      });
      return { s, replyId, args };
    }

    it('moves a not_delivered reply to the end as sending with a try_again attempt and a job', async () => {
      const { s, replyId, args } = await failedReply('not_delivered');
      const r = await service().requeueReply(args());
      expect(r.status).toBe('requeued');
      const row = await db
        .selectFrom('replies')
        .selectAll()
        .where('id', '=', replyId)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        state: 'sending',
        failure_reason: null,
        position_at: clock.now(),
      });
      const attempts = await db
        .selectFrom('reply_attempts')
        .select('kind')
        .where('reply_id', '=', replyId)
        .execute();
      expect(attempts).toEqual([{ kind: 'try_again' }]);
      expect(await jobsFor(s.conversationId)).toHaveLength(1);
    });

    it('needs the duplicate-risk confirmation for not_confirmed, then records send_again', async () => {
      const { replyId, args } = await failedReply('not_confirmed');
      expect((await service().requeueReply(args())).status).toBe('confirmation_required');
      expect((await service().requeueReply(args({ confirmDuplicate: true }))).status).toBe(
        'requeued',
      );
      const attempts = await db
        .selectFrom('reply_attempts')
        .select('kind')
        .where('reply_id', '=', replyId)
        .execute();
      expect(attempts).toEqual([{ kind: 'send_again' }]);
    });

    it('lets only one of two concurrent re-queues win; the other sees the reply as not resendable', async () => {
      const { args } = await failedReply('not_delivered');
      const rs = await Promise.all([
        service().requeueReply(args()),
        service().requeueReply(args()),
      ]);
      expect(rs.map((r) => r.status).sort()).toEqual(['not_resendable', 'requeued']);
    });

    it('refuses a sent reply as not resendable and checks the limit before the confirmation', async () => {
      const s = await setup();
      const sent = await insertReply(db, {
        workspaceId: s.workspaceId,
        conversationId: s.conversationId,
        authorAccountId: s.accountId,
        state: 'sent',
      });
      const base = {
        workspaceId: s.workspaceId,
        conversationId: s.conversationId,
        memberId: s.accountId,
        confirmDuplicate: false,
        limit: 30,
        windowMs: 60_000,
        enqueueDrain,
      };
      expect((await service().requeueReply({ ...base, replyId: sent })).status).toBe(
        'not_resendable',
      );
      const { s: s2, replyId, args } = await failedReply('not_confirmed');
      await insertReplyAttempt(db, {
        workspaceId: s2.workspaceId,
        conversationId: s2.conversationId,
        replyId,
        initiatedByAccountId: s2.accountId,
        createdAt: clock.now(),
      });
      expect((await service().requeueReply(args({ limit: 1 }))).status).toBe('limited');
      expect(replyId).toBeTruthy();
    });
  });

  describe('workspace isolation', () => {
    it('no method reads or writes across workspaces', async () => {
      const a = await setup();
      const b = await setup();
      const replyId = await insertReply(db, {
        workspaceId: a.workspaceId,
        conversationId: a.conversationId,
        authorAccountId: a.mateId,
        state: 'not_delivered',
        clientKey: SHARED_KEY,
      });
      await insertReplyAttempt(db, {
        workspaceId: a.workspaceId,
        conversationId: a.conversationId,
        replyId,
        initiatedByAccountId: a.accountId,
        createdAt: at(999),
      });
      const r = repo();
      // reads with the other workspace's id (and a's conversation id) find nothing
      expect(await r.findByClientKey(b.workspaceId, a.conversationId, SHARED_KEY)).toBeNull();
      expect(await r.findForUpdate(b.workspaceId, a.conversationId, replyId)).toBeNull();
      expect(await r.lockAndCountAttempts(b.workspaceId, a.accountId, at(0))).toEqual({
        count: 0,
        oldest: null,
      });
      expect(
        await r.newestTeammateReply(b.workspaceId, a.conversationId, b.accountId, null),
      ).toBeNull();
      // writes are refused / no-ops
      expect(
        await r.insert(b.workspaceId, {
          id: crypto.randomUUID(),
          conversationId: a.conversationId,
          clientKey: crypto.randomUUID(),
          body: 'hi',
          authorAccountId: b.accountId,
          positionAt: at(1),
        }),
      ).toBeNull();
      expect(await r.requeue(b.workspaceId, a.conversationId, replyId, at(1))).toBeNull();
      const untouched = await db
        .selectFrom('replies')
        .select('state')
        .where('id', '=', replyId)
        .executeTakeFirstOrThrow();
      expect(untouched.state).toBe('not_delivered');
      expect(await service().createReply(input(b, { conversationId: a.conversationId }))).toEqual({
        status: 'not_found',
      });
      expect(
        await db
          .selectFrom('replies')
          .select('id')
          .where('conversation_id', '=', a.conversationId)
          .execute(),
      ).toHaveLength(1);
    });
  });
});
