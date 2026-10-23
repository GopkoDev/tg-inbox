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

async function setup(
  state: { status?: 'open' | 'closed'; assignee?: string | null; replies?: number } = {},
) {
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
  const replyIds: string[] = [];
  for (let i = 0; i < (state.replies ?? 1); i++) {
    const created = await createReplies(deps).createReply({
      workspaceId: W,
      conversationId: C,
      authorId: 'me',
      clientKey: i === 0 ? 'k' : `k${i}`,
      body: 'Hi',
      lastSeenReplyId: null,
      confirmTeammate: false,
      limit: 30,
      windowMs: 60_000,
      enqueueDrain: async () => {},
    });
    if (created.status !== 'created') throw new Error('setup');
    replyIds.push(created.reply.id);
  }
  signals.replies.length = 0;
  return {
    repo,
    signals,
    conversations,
    activities,
    delivery: createReplyDelivery(deliveryDeps),
    replyId: replyIds[0]!,
    replyIds,
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

  it.each(['not_delivered', 'not_confirmed'] as const)(
    'finishAttempt %s over an unanswered customer message restarts the period as reopen',
    async (replyState) => {
      const s = await setup({ status: 'closed', assignee: 'mate' });
      const started = await s.delivery.startAttempt({
        workspaceId: W,
        conversationId: C,
        replyId: s.replyId,
      });
      await s.delivery.finishAttempt(failed(started!.attemptId, replyState));
      expect(s.row.waiting).toEqual({ since: at(100), startedBy: 'reopen' });
    },
  );

  it('a failed reply in an already open conversation leaves its period alone', async () => {
    const s = await setup({ status: 'open' });
    s.row.waiting = { since: at(7), startedBy: 'message' };
    const started = await s.delivery.startAttempt({
      workspaceId: W,
      conversationId: C,
      replyId: s.replyId,
    });
    await s.delivery.finishAttempt(failed(started!.attemptId, 'not_delivered'));
    expect(s.row.waiting).toEqual({ since: at(7), startedBy: 'message' });
  });

  it('a failed reply that closed-and-answered conversation reopens with no period', async () => {
    const s = await setup({ status: 'closed', assignee: 'mate' });
    s.row.lastReplySentAt = at(50);
    const started = await s.delivery.startAttempt({
      workspaceId: W,
      conversationId: C,
      replyId: s.replyId,
    });
    await s.delivery.finishAttempt(failed(started!.attemptId, 'not_delivered'));
    expect(s.row).toMatchObject({ status: 'open', waiting: null });
  });

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

  /**
   * Records the order of the reply / attempt writes and the conversation row lock (B2): the row lock
   * is the last lock of the order (sad.md §8), so it comes once, after every reply and attempt write
   * of the transaction — never between them, where it would deadlock with a lagging drain.
   */
  function recordLocks(s: Awaited<ReturnType<typeof setup>>) {
    const log: string[] = [];
    const spy = (target: Record<string, unknown>, names: string[], tag: string) => {
      for (const name of names) {
        const original = target[name] as (...a: unknown[]) => unknown;
        target[name] = (...a: unknown[]) => {
          log.push(`${tag}:${name}`);
          return original.apply(target, a);
        };
      }
    };
    spy(
      s.repo as unknown as Record<string, unknown>,
      ['settleReply', 'settleIdleReply', 'finishAttempt', 'skipAttempt'],
      'write',
    );
    spy(s.conversations as unknown as Record<string, unknown>, ['lockState'], 'lock');
    return {
      log,
      check() {
        const locks = log.filter((e) => e.startsWith('lock:'));
        expect(locks).toEqual(['lock:lockState']);
        expect(log.at(-1)).toBe('lock:lockState');
        log.length = 0;
      },
    };
  }

  it('dead letter with several replies locks the conversation once, after every reply and attempt write (B2)', async () => {
    const s = await setup({ status: 'closed', assignee: 'mate', replies: 3 });
    await s.delivery.startAttempt({ workspaceId: W, conversationId: C, replyId: s.replyIds[0]! });
    await s.delivery.startAttempt({ workspaceId: W, conversationId: C, replyId: s.replyIds[1]! });
    const locks = recordLocks(s);
    const result = await s.delivery.resolveDeadLetter(W, C, {
      staleBefore: at(200),
      drainQueued: async () => false,
    });
    expect(result.notConfirmed).toHaveLength(2);
    expect(result.interrupted).toEqual([s.replyIds[2]]);
    locks.check();
    expectReopenedOnce(s);
  });

  it('resolveStaleInFlight with several attempts locks the conversation once, after the writes (B2)', async () => {
    const s = await setup({ status: 'closed', assignee: 'mate', replies: 2 });
    for (const replyId of s.replyIds) {
      await s.delivery.startAttempt({ workspaceId: W, conversationId: C, replyId });
    }
    const locks = recordLocks(s);
    expect(await s.delivery.resolveStaleInFlight(W, C, at(200))).toHaveLength(2);
    locks.check();
    expectReopenedOnce(s);
  });

  it('skipReply and finishAttempt lock the conversation after their reply and attempt writes (B2)', async () => {
    const s = await setup({ status: 'closed', assignee: 'mate', replies: 2 });
    const locks = recordLocks(s);
    await s.delivery.skipReply({
      workspaceId: W,
      conversationId: C,
      replyId: s.replyIds[0]!,
      failureReason: 'bot_unavailable',
    });
    locks.check();
    const started = await s.delivery.startAttempt({
      workspaceId: W,
      conversationId: C,
      replyId: s.replyIds[1]!,
    });
    locks.log.length = 0;
    await s.delivery.finishAttempt(failed(started!.attemptId, 'not_delivered'));
    locks.check();
  });

  it.each(['resolveStaleInFlight', 'resolveDeadLetter'] as const)(
    '%s: a stale attempt of a reply already final (closed after its failure) reopens nothing (R3)',
    async (resolve) => {
      const s = await setup({ status: 'closed', assignee: 'mate' });
      await s.delivery.startAttempt({ workspaceId: W, conversationId: C, replyId: s.replyId });
      // The reply failed while the lagging attempt was still in flight; then it was closed again.
      await s.delivery.skipReply({
        workspaceId: W,
        conversationId: C,
        replyId: s.replyId,
        failureReason: 'bot_unavailable',
      });
      expectReopenedOnce(s);
      Object.assign(s.row, { status: 'closed', stateVersion: 5 });
      s.activities.rows.length = 0;
      s.signals.activities.length = 0;
      const resolved =
        resolve === 'resolveStaleInFlight'
          ? await s.delivery.resolveStaleInFlight(W, C, at(200))
          : (
              await s.delivery.resolveDeadLetter(W, C, {
                staleBefore: at(200),
                drainQueued: async () => false,
              })
            ).notConfirmed;
      expect(resolved).toEqual([]);
      expect(s.row).toMatchObject({ status: 'closed', stateVersion: 5 });
      expect(s.activities.rows).toEqual([]);
    },
  );

  it('a dead letter with nothing failed never locks the conversation', async () => {
    const s = await setup({ status: 'closed', replies: 1 });
    const locks = recordLocks(s);
    await s.delivery.resolveDeadLetter(W, C, {
      staleBefore: at(200),
      drainQueued: async () => true,
    });
    expect(locks.log.filter((e) => e.startsWith('lock:'))).toEqual([]);
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
