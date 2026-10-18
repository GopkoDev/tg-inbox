import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import {
  fakeActivityRepo,
  fakeConversationRepo,
  fakeConversationSignals,
  fakeReplyRepo,
} from './fakes.js';
import type { Executor } from './ports.js';
import { createReplies, createReplyDelivery } from './replies.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const W = 'w1';
const C = 'c1';

async function setup(state: { status?: 'open' | 'closed'; assignee?: string | null } = {}) {
  const repo = fakeReplyRepo({ conversations: [[W, C]] });
  const conversations = fakeConversationRepo();
  conversations.rows.push({
    id: C,
    workspaceId: W,
    contactId: 'k',
    telegramChatId: 1n,
    createdAt: at(0),
    lastActivityAt: at(0),
    lastMessageReceivedAt: at(0),
    lastReplySentAt: null,
    status: state.status ?? 'open',
    assigneeAccountId: state.assignee ?? null,
    stateVersion: 3,
    customerMessageSeq: 1,
  });
  const activities = fakeActivityRepo();
  const signals = fakeConversationSignals();
  const tx = { marker: 'tx' } as unknown as Executor;
  const deps = {
    transaction: <T>(fn: (t: Executor) => Promise<T>) => fn(tx),
    replies: repo,
    signals,
    clock: fixedClock(at(100)),
  };
  const deliveryDeps = { ...deps, conversations, activities };
  const created = await createReplies(deps).createReply({
    workspaceId: W,
    conversationId: C,
    authorId: 'me',
    clientKey: 'k',
    body: 'Hi',
    lastSeenReplyId: null,
    confirmTeammate: false,
    limit: 30,
    windowMs: 60_000,
    enqueueDrain: async () => {},
  });
  if (created.status !== 'created') throw new Error('setup');
  signals.replies.length = 0;
  return {
    repo,
    signals,
    conversations,
    activities,
    delivery: createReplyDelivery(deliveryDeps),
    replyId: created.reply.id,
    row: conversations.rows[0]!,
  };
}

describe('reply delivery', () => {
  it('sent: settles the reply, raises the conversation, signals state', async () => {
    const { repo, signals, delivery, replyId } = await setup();
    const started = await delivery.startAttempt({ workspaceId: W, conversationId: C, replyId });
    const ok = await delivery.finishAttempt({
      workspaceId: W,
      conversationId: C,
      attemptId: started!.attemptId,
      attemptOutcome: 'accepted',
      replyState: 'sent',
      telegramMessageId: 5n,
      sentAt: at(101),
    });
    expect(ok).toBe(true);
    expect(repo.replies[0]?.state).toBe('sent');
    expect(repo.raised).toEqual([at(101)]);
    expect(signals.replies.map((s) => s.change)).toEqual(['state']);
  });

  it('finishing a finished attempt is a no-op', async () => {
    const { signals, delivery, replyId } = await setup();
    const started = await delivery.startAttempt({ workspaceId: W, conversationId: C, replyId });
    const input = {
      workspaceId: W,
      conversationId: C,
      attemptId: started!.attemptId,
      attemptOutcome: 'unknown' as const,
      replyState: 'not_confirmed' as const,
    };
    expect(await delivery.finishAttempt(input)).toBe(true);
    expect(await delivery.finishAttempt(input)).toBe(false);
    expect(signals.replies).toHaveLength(1);
  });

  it('dead letter twice changes nothing the second time', async () => {
    const { delivery, signals, replyId } = await setup();
    await delivery.startAttempt({ workspaceId: W, conversationId: C, replyId });
    const options = { staleBefore: at(200), drainQueued: async () => false };
    const first = await delivery.resolveDeadLetter(W, C, options);
    expect(first).toEqual({ notConfirmed: [replyId], interrupted: [], inFlightSince: null });
    signals.replies.length = 0;
    expect(await delivery.resolveDeadLetter(W, C, options)).toEqual({
      notConfirmed: [],
      interrupted: [],
      inFlightSince: null,
    });
    expect(signals.replies).toHaveLength(0);
  });
});

describe('a failed reply reopens a closed conversation (AC-08)', () => {
  const failed = (attemptId: string, replyState: 'not_delivered' | 'not_confirmed') => ({
    workspaceId: W,
    conversationId: C,
    attemptId,
    attemptOutcome: replyState === 'not_confirmed' ? ('unknown' as const) : ('refused' as const),
    replyState,
    failureReason: replyState === 'not_delivered' ? 'telegram_refused' : undefined,
  });
  const expectReopenedOnce = (s: Awaited<ReturnType<typeof setup>>) => {
    expect(s.row).toMatchObject({ status: 'open', assigneeAccountId: 'mate', stateVersion: 4 });
    expect(s.activities.rows).toMatchObject([
      { kind: 'reopened', cause: 'reply_not_delivered', actorAccountId: null },
    ]);
    expect(s.signals.activities).toHaveLength(1);
  };

  it.each(['not_delivered', 'not_confirmed'] as const)(
    'finishAttempt %s reopens, keeping the assignee',
    async (replyState) => {
      const s = await setup({ status: 'closed', assignee: 'mate' });
      const started = await s.delivery.startAttempt({
        workspaceId: W,
        conversationId: C,
        replyId: s.replyId,
      });
      await s.delivery.finishAttempt(failed(started!.attemptId, replyState));
      expectReopenedOnce(s);
    },
  );

  it('skipReply reopens', async () => {
    const s = await setup({ status: 'closed', assignee: 'mate' });
    expect(
      await s.delivery.skipReply({
        workspaceId: W,
        conversationId: C,
        replyId: s.replyId,
        failureReason: 'bot_unavailable',
      }),
    ).toBe(true);
    expectReopenedOnce(s);
  });

  it('resolveStaleInFlight reopens once', async () => {
    const s = await setup({ status: 'closed', assignee: 'mate' });
    await s.delivery.startAttempt({ workspaceId: W, conversationId: C, replyId: s.replyId });
    await s.delivery.resolveStaleInFlight(W, C, at(200));
    await s.delivery.resolveStaleInFlight(W, C, at(200));
    expectReopenedOnce(s);
  });

  it('dead letter reopens once for a not confirmed reply and once for an interrupted one', async () => {
    const s = await setup({ status: 'closed', assignee: 'mate' });
    await s.delivery.startAttempt({ workspaceId: W, conversationId: C, replyId: s.replyId });
    const options = { staleBefore: at(200), drainQueued: async () => false };
    await s.delivery.resolveDeadLetter(W, C, options);
    await s.delivery.resolveDeadLetter(W, C, options);
    expectReopenedOnce(s);

    const t = await setup({ status: 'closed', assignee: 'mate' });
    const result = await t.delivery.resolveDeadLetter(W, C, options);
    expect(result.interrupted).toEqual([t.replyId]);
    expectReopenedOnce(t);
  });

  it('a second reply failing after the reopen adds nothing', async () => {
    const s = await setup({ status: 'closed', assignee: 'mate' });
    await s.delivery.skipReply({
      workspaceId: W,
      conversationId: C,
      replyId: s.replyId,
      failureReason: 'bot_unavailable',
    });
    expect(
      await s.delivery.skipReply({
        workspaceId: W,
        conversationId: C,
        replyId: s.replyId,
        failureReason: 'bot_unavailable',
      }),
    ).toBe(false);
    expectReopenedOnce(s);
  });

  it('an accepted reply leaves the conversation closed', async () => {
    const s = await setup({ status: 'closed' });
    const started = await s.delivery.startAttempt({
      workspaceId: W,
      conversationId: C,
      replyId: s.replyId,
    });
    await s.delivery.finishAttempt({
      workspaceId: W,
      conversationId: C,
      attemptId: started!.attemptId,
      attemptOutcome: 'accepted',
      replyState: 'sent',
      telegramMessageId: 5n,
      sentAt: at(101),
    });
    expect(s.row).toMatchObject({ status: 'closed', stateVersion: 3 });
    expect(s.activities.rows).toHaveLength(0);
  });

  it('a failed reply in an open conversation records nothing', async () => {
    const s = await setup({ status: 'open' });
    await s.delivery.skipReply({
      workspaceId: W,
      conversationId: C,
      replyId: s.replyId,
      failureReason: 'bot_unavailable',
    });
    expect(s.row).toMatchObject({ status: 'open', stateVersion: 3 });
    expect(s.activities.rows).toHaveLength(0);
    expect(s.signals.activities).toHaveLength(0);
  });
});
