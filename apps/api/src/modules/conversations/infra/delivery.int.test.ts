import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import {
  insertConversation,
  insertReply,
  insertReplyAttempt,
} from '../../../test/fixtures/conversations.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { fakeConversationSignals } from '../app/fakes.js';
import { createReplies, createReplyDelivery } from '../app/replies.js';
import { createReplyRepo } from './reply-repo.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe('reply delivery (Postgres)', () => {
  let database: TestDatabase;
  let db: Db;
  const clock = fixedClock(at(1000));
  const signals = fakeConversationSignals();

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url, { max: 10 });
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const delivery = () =>
    createReplyDelivery({
      transaction: (fn) => db.transaction().execute(fn),
      replies: createReplyRepo(db),
      signals,
      clock,
    });

  async function setup(conversation: { received?: Date } = {}) {
    const workspaceId = await insertWorkspace(db);
    const { accountId } = await insertMembership(db, workspaceId);
    const contactId = await insertContact(db, { workspaceId });
    const received = conversation.received ?? at(0);
    const conversationId = await insertConversation(db, {
      workspaceId,
      contactId,
      lastActivityAt: received,
      lastMessageReceivedAt: received,
    });
    return { workspaceId, accountId, conversationId };
  }
  type S = Awaited<ReturnType<typeof setup>>;

  /** A sending reply with its unstarted member attempt. */
  async function pending(s: S, positionAt = at(10)) {
    const replyId = await insertReply(db, {
      workspaceId: s.workspaceId,
      conversationId: s.conversationId,
      authorAccountId: s.accountId,
      positionAt,
    });
    const attemptId = await insertReplyAttempt(db, {
      workspaceId: s.workspaceId,
      conversationId: s.conversationId,
      replyId,
      initiatedByAccountId: s.accountId,
      createdAt: positionAt,
    });
    return { replyId, attemptId };
  }
  const reply = (id: string) =>
    db.selectFrom('replies').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const attempt = (id: string) =>
    db.selectFrom('reply_attempts').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const conversation = (id: string) =>
    db.selectFrom('conversations').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const stateSignals = (replyId: string) =>
    signals.replies.filter((x) => x.replyId === replyId && x.change === 'state');
  const ids = (s: S) => ({ workspaceId: s.workspaceId, conversationId: s.conversationId });
  /** Dead-letter options: attempts started before at(1001) are stale; no drain job is queued. */
  const dead = (o: { drainQueued?: () => Promise<boolean>; staleBefore?: Date } = {}) => ({
    staleBefore: o.staleBefore ?? at(1001),
    drainQueued: o.drainQueued ?? (async () => false),
  });

  it('lists pending replies oldest position first and reports the newest start', async () => {
    const s = await setup();
    const late = await pending(s, at(30));
    const early = await pending(s, at(20));
    await insertReply(db, {
      workspaceId: s.workspaceId,
      conversationId: s.conversationId,
      authorAccountId: s.accountId,
      state: 'sent',
    });
    const list = await delivery().pendingReplies(s.workspaceId, s.conversationId);
    expect(list.map((r) => r.id)).toEqual([early.replyId, late.replyId]);
    expect(await delivery().lastStartedAt(s.workspaceId, s.conversationId)).toBeNull();
    await delivery().startAttempt({ ...ids(s), replyId: early.replyId });
    expect(await delivery().lastStartedAt(s.workspaceId, s.conversationId)).toEqual(at(1000));
  });

  it('starts the member attempt in place; an automatic retry inserts a retry attempt (AC-12)', async () => {
    const s = await setup();
    const { replyId, attemptId } = await pending(s);
    const first = await delivery().startAttempt({ ...ids(s), replyId });
    expect(first).toEqual({ attemptId });
    expect(await attempt(attemptId)).toMatchObject({ started_at: at(1000), outcome: null });

    await delivery().finishAttempt({
      ...ids(s),
      attemptId,
      attemptOutcome: 'not_accepted',
      replyState: 'sending',
    });
    expect(await reply(replyId)).toMatchObject({ state: 'sending' });
    expect(stateSignals(replyId)).toHaveLength(0);

    const retry = await delivery().startAttempt({ ...ids(s), replyId });
    expect(retry!.attemptId).not.toBe(attemptId);
    expect(await attempt(retry!.attemptId)).toMatchObject({
      kind: 'retry',
      initiated_by_account_id: null,
      started_at: at(1000),
      finished_at: null,
    });
  });

  it('sent: stores Telegram id and time, raises last_reply_sent_at and activity in one UPDATE (AC-06)', async () => {
    const s = await setup({ received: at(0) });
    const { replyId, attemptId } = await pending(s);
    await delivery().startAttempt({ ...ids(s), replyId });
    const ok = await delivery().finishAttempt({
      ...ids(s),
      attemptId,
      attemptOutcome: 'accepted',
      replyState: 'sent',
      telegramMessageId: 777n,
      sentAt: at(500),
    });
    expect(ok).toBe(true);
    expect(await reply(replyId)).toMatchObject({
      state: 'sent',
      failure_reason: null,
      sent_at: at(500),
      telegram_message_id: '777',
    });
    expect(await attempt(attemptId)).toMatchObject({ outcome: 'accepted', finished_at: at(1000) });
    expect(await conversation(s.conversationId)).toMatchObject({
      last_reply_sent_at: at(500),
      last_activity_at: at(500),
      last_message_received_at: at(0),
    });
    expect(stateSignals(replyId)).toHaveLength(1);
  });

  it('sent: activity stays at a later customer message; reply time never moves backwards', async () => {
    const s = await setup({ received: at(900) });
    const a = await pending(s);
    await delivery().startAttempt({ ...ids(s), replyId: a.replyId });
    await delivery().finishAttempt({
      ...ids(s),
      attemptId: a.attemptId,
      attemptOutcome: 'accepted',
      replyState: 'sent',
      telegramMessageId: 1n,
      sentAt: at(500),
    });
    expect(await conversation(s.conversationId)).toMatchObject({
      last_reply_sent_at: at(500),
      last_activity_at: at(900),
    });
    const b = await pending(s, at(20));
    await delivery().startAttempt({ ...ids(s), replyId: b.replyId });
    await delivery().finishAttempt({
      ...ids(s),
      attemptId: b.attemptId,
      attemptOutcome: 'accepted',
      replyState: 'sent',
      telegramMessageId: 2n,
      sentAt: at(100),
    });
    expect(await conversation(s.conversationId)).toMatchObject({
      last_reply_sent_at: at(500),
      last_activity_at: at(900),
    });
  });

  it('refused / unauthorized end not_delivered with their reason; the conversation columns stay (AC-10, AC-13)', async () => {
    const s = await setup();
    const before = await conversation(s.conversationId);
    for (const [outcome, reason] of [
      ['refused', 'customer_blocked'],
      ['bot_unauthorized', 'bot_not_working'],
    ] as const) {
      const { replyId, attemptId } = await pending(s);
      await delivery().startAttempt({ ...ids(s), replyId });
      await delivery().finishAttempt({
        ...ids(s),
        attemptId,
        attemptOutcome: outcome,
        replyState: 'not_delivered',
        failureReason: reason,
      });
      expect(await reply(replyId)).toMatchObject({
        state: 'not_delivered',
        failure_reason: reason,
      });
      expect(await attempt(attemptId)).toMatchObject({ outcome });
      expect(stateSignals(replyId)).toHaveLength(1);
    }
    expect(await conversation(s.conversationId)).toEqual(before);
  });

  it('unknown ends not_confirmed and never goes back to sending on its own (AC-11)', async () => {
    const s = await setup();
    const { replyId, attemptId } = await pending(s);
    await delivery().startAttempt({ ...ids(s), replyId });
    await delivery().finishAttempt({
      ...ids(s),
      attemptId,
      attemptOutcome: 'unknown',
      replyState: 'not_confirmed',
    });
    expect(await reply(replyId)).toMatchObject({ state: 'not_confirmed', failure_reason: null });
    expect(await delivery().pendingReplies(s.workspaceId, s.conversationId)).toEqual([]);
    expect(await delivery().startAttempt({ ...ids(s), replyId })).toBeNull();
  });

  it('finishing an attempt twice is a no-op with one signal', async () => {
    const s = await setup();
    const { replyId, attemptId } = await pending(s);
    await delivery().startAttempt({ ...ids(s), replyId });
    const input = {
      ...ids(s),
      attemptId,
      attemptOutcome: 'unknown' as const,
      replyState: 'not_confirmed' as const,
    };
    expect(await delivery().finishAttempt(input)).toBe(true);
    expect(await delivery().finishAttempt({ ...input, attemptOutcome: 'refused' })).toBe(false);
    expect(await attempt(attemptId)).toMatchObject({ outcome: 'unknown' });
    expect(stateSignals(replyId)).toHaveLength(1);
  });

  it('skipReply closes the unstarted attempt as skipped and the reply not_delivered (AC-09)', async () => {
    const s = await setup();
    const { replyId, attemptId } = await pending(s);
    const ok = await delivery().skipReply({
      ...ids(s),
      replyId,
      failureReason: 'author_access_removed',
    });
    expect(ok).toBe(true);
    expect(await reply(replyId)).toMatchObject({
      state: 'not_delivered',
      failure_reason: 'author_access_removed',
    });
    expect(await attempt(attemptId)).toMatchObject({
      outcome: 'skipped',
      started_at: null,
      finished_at: at(1000),
    });
    expect(stateSignals(replyId)).toHaveLength(1);
    expect(
      await delivery().skipReply({ ...ids(s), replyId, failureReason: 'bot_not_working' }),
    ).toBe(false);
  });

  it('skipReply on a reply without an unstarted attempt records a skipped retry attempt', async () => {
    const s = await setup();
    const { replyId, attemptId } = await pending(s);
    await delivery().startAttempt({ ...ids(s), replyId });
    await delivery().finishAttempt({
      ...ids(s),
      attemptId,
      attemptOutcome: 'not_accepted',
      replyState: 'sending',
    });
    await delivery().skipReply({ ...ids(s), replyId, failureReason: 'bot_not_working' });
    const rows = await db
      .selectFrom('reply_attempts')
      .selectAll()
      .where('reply_id', '=', replyId)
      .orderBy('created_at')
      .execute();
    expect(rows.map((r) => [r.kind, r.outcome])).toEqual([
      ['send', 'not_accepted'],
      ['retry', 'skipped'],
    ]);
  });

  it('resolves only in-flight attempts older than the cutoff to unknown / not_confirmed (AC-11)', async () => {
    const s = await setup();
    const stale = await pending(s, at(10));
    const fresh = await pending(s, at(20));
    await db
      .updateTable('reply_attempts')
      .set({ started_at: at(980) })
      .where('id', '=', stale.attemptId)
      .execute();
    await db
      .updateTable('reply_attempts')
      .set({ started_at: at(995) })
      .where('id', '=', fresh.attemptId)
      .execute();
    const resolved = await delivery().resolveStaleInFlight(
      s.workspaceId,
      s.conversationId,
      at(990),
    );
    expect(resolved).toEqual([stale.replyId]);
    expect(await reply(stale.replyId)).toMatchObject({ state: 'not_confirmed' });
    expect(await attempt(stale.attemptId)).toMatchObject({
      outcome: 'unknown',
      finished_at: at(1000),
    });
    expect(await reply(fresh.replyId)).toMatchObject({ state: 'sending' });
    expect(await attempt(fresh.attemptId)).toMatchObject({ outcome: null });
    expect(stateSignals(stale.replyId)).toHaveLength(1);
    expect(stateSignals(fresh.replyId)).toHaveLength(0);
    expect(await delivery().resolveStaleInFlight(s.workspaceId, s.conversationId, at(990))).toEqual(
      [],
    );
  });

  it('dead letter: in-flight -> unknown / not_confirmed, unattempted -> delivery_interrupted; a second run changes nothing', async () => {
    const s = await setup();
    const inFlight = await pending(s, at(10));
    const waiting = await pending(s, at(20));
    const sent = await insertReply(db, {
      workspaceId: s.workspaceId,
      conversationId: s.conversationId,
      authorAccountId: s.accountId,
      state: 'sent',
    });
    await delivery().startAttempt({ ...ids(s), replyId: inFlight.replyId });

    const first = await delivery().resolveDeadLetter(s.workspaceId, s.conversationId, dead());
    expect(first).toEqual({
      notConfirmed: [inFlight.replyId],
      interrupted: [waiting.replyId],
      inFlightSince: null,
    });
    expect(await reply(inFlight.replyId)).toMatchObject({ state: 'not_confirmed' });
    expect(await attempt(inFlight.attemptId)).toMatchObject({ outcome: 'unknown' });
    expect(await reply(waiting.replyId)).toMatchObject({
      state: 'not_delivered',
      failure_reason: 'delivery_interrupted',
    });
    expect(await attempt(waiting.attemptId)).toMatchObject({
      outcome: 'skipped',
      started_at: null,
    });
    expect(await reply(sent)).toMatchObject({ state: 'sent' });
    expect(stateSignals(inFlight.replyId)).toHaveLength(1);
    expect(stateSignals(waiting.replyId)).toHaveLength(1);

    const snapshot = JSON.stringify(
      await db
        .selectFrom('replies')
        .selectAll()
        .where('conversation_id', '=', s.conversationId)
        .orderBy('id')
        .execute(),
    );
    const second = await delivery().resolveDeadLetter(s.workspaceId, s.conversationId, dead());
    expect(second).toEqual({ notConfirmed: [], interrupted: [], inFlightSince: null });
    expect(
      JSON.stringify(
        await db
          .selectFrom('replies')
          .selectAll()
          .where('conversation_id', '=', s.conversationId)
          .orderBy('id')
          .execute(),
      ),
    ).toBe(snapshot);
    expect(stateSignals(inFlight.replyId)).toHaveLength(1);
  });

  it('dead letter leaves a young in-flight attempt to the drain that started it and reports when it started (B2, AC-11)', async () => {
    const s = await setup();
    const young = await pending(s, at(10));
    const waiting = await pending(s, at(20));
    await delivery().startAttempt({ ...ids(s), replyId: young.replyId });
    const result = await delivery().resolveDeadLetter(
      s.workspaceId,
      s.conversationId,
      dead({ staleBefore: at(990) }),
    );
    expect(result).toEqual({
      notConfirmed: [],
      interrupted: [waiting.replyId],
      inFlightSince: at(1000),
    });
    expect(await reply(young.replyId)).toMatchObject({ state: 'sending' });
    expect(await attempt(young.attemptId)).toMatchObject({ outcome: null, finished_at: null });
  });

  it('dead letter interrupts nothing while a drain job for the conversation is queued or running (B2)', async () => {
    const s = await setup();
    const stale = await pending(s, at(10));
    const waiting = await pending(s, at(20));
    await delivery().startAttempt({ ...ids(s), replyId: stale.replyId });
    const result = await delivery().resolveDeadLetter(
      s.workspaceId,
      s.conversationId,
      dead({ drainQueued: async () => true }),
    );
    expect(result).toEqual({ notConfirmed: [stale.replyId], interrupted: [], inFlightSince: null });
    expect(await reply(waiting.replyId)).toMatchObject({ state: 'sending' });
  });

  it('a reply created while the dead letter runs is never interrupted: its job is checked under the drain lock (B2, B3)', async () => {
    const s = await setup();
    const requests = createReplies({
      transaction: (fn) => db.transaction().execute(fn),
      replies: createReplyRepo(db),
      signals,
      clock,
    });
    let creating: ReturnType<typeof requests.createReply> | undefined;
    const result = await delivery().resolveDeadLetter(
      s.workspaceId,
      s.conversationId,
      dead({
        drainQueued: async () => {
          creating = requests.createReply({
            workspaceId: s.workspaceId,
            conversationId: s.conversationId,
            authorId: s.accountId,
            clientKey: crypto.randomUUID(),
            body: 'late',
            lastSeenReplyId: null,
            confirmTeammate: false,
            limit: 30,
            windowMs: 60_000,
            enqueueDrain: async () => {},
          });
          await new Promise((r) => setTimeout(r, 300));
          return false;
        },
      }),
    );
    const created = await creating!;
    expect(created.status).toBe('created');
    expect(result.interrupted).toEqual([]);
    expect(created.status === 'created' && (await reply(created.reply.id))).toMatchObject({
      state: 'sending',
    });
  });

  it('isolates every method by workspace', async () => {
    const a = await setup();
    const b = await setup();
    const { replyId, attemptId } = await pending(a);
    const other = { workspaceId: b.workspaceId, conversationId: a.conversationId };

    expect(await delivery().pendingReplies(b.workspaceId, a.conversationId)).toEqual([]);
    expect(await delivery().startAttempt({ ...other, replyId })).toBeNull();
    expect(await attempt(attemptId)).toMatchObject({ started_at: null });

    await delivery().startAttempt({ ...ids(a), replyId });
    expect(await delivery().lastStartedAt(b.workspaceId, a.conversationId)).toBeNull();
    expect(
      await delivery().finishAttempt({
        ...other,
        attemptId,
        attemptOutcome: 'unknown',
        replyState: 'not_confirmed',
      }),
    ).toBe(false);
    expect(
      await delivery().skipReply({ ...other, replyId, failureReason: 'bot_not_working' }),
    ).toBe(false);
    expect(
      await delivery().resolveStaleInFlight(b.workspaceId, a.conversationId, at(2000)),
    ).toEqual([]);
    expect(await delivery().resolveDeadLetter(b.workspaceId, a.conversationId, dead())).toEqual({
      notConfirmed: [],
      interrupted: [],
      inFlightSince: null,
    });
    // sent from another workspace must not touch the conversation either
    const repo = createReplyRepo(db);
    await repo.raiseReplySent(b.workspaceId, a.conversationId, at(900));
    expect(await conversation(a.conversationId)).toMatchObject({ last_reply_sent_at: null });
    expect(await reply(replyId)).toMatchObject({ state: 'sending' });
    expect(await attempt(attemptId)).toMatchObject({ outcome: null });
  });
});
