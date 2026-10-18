import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { fakeConversationSignals, fakeReplyRepo } from './fakes.js';
import type { Executor } from './ports.js';
import { createReplies, createReplyDelivery } from './replies.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const W = 'w1';
const C = 'c1';

async function setup() {
  const repo = fakeReplyRepo({ conversations: [[W, C]] });
  const signals = fakeConversationSignals();
  const tx = { marker: 'tx' } as unknown as Executor;
  const deps = {
    transaction: <T>(fn: (t: Executor) => Promise<T>) => fn(tx),
    replies: repo,
    signals,
    clock: fixedClock(at(100)),
  };
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
  return { repo, signals, delivery: createReplyDelivery(deps), replyId: created.reply.id };
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
