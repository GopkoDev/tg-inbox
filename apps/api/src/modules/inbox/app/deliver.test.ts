import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import type { ReplyView } from '../../conversations/app/ports.js';
import type { FinishAttemptInput, ReplyDelivery } from '../../conversations/app/replies.js';
import type { GatewayOutcome } from '../domain/delivery.js';
import { createDeliver } from './deliver.js';

const WS = '01920000-0000-7000-8000-000000000001';
const CONV = '01920000-0000-7000-8000-0000000000c1';
const ME = '01920000-0000-7000-8000-0000000000b1';
const NOW = new Date('2026-10-18T10:00:00Z');
const CHAT = 4242n;

const reply = (id: string, body: string, positionAt = NOW, author = ME): ReplyView => ({
  id,
  conversationId: CONV,
  clientKey: id,
  body,
  authorAccountId: author,
  state: 'sending',
  failureReason: null,
  positionAt,
  sentAt: null,
  createdAt: positionAt,
});

function setup(
  o: {
    pending?: ReplyView[];
    outcomes?: GatewayOutcome[];
    active?: string[];
    canCarry?: boolean;
    lastStartedAt?: Date | null;
    startReturnsNull?: boolean;
    sendThrows?: boolean;
    inFlightSince?: Date | null;
    /** Replies with an earlier not-accepted attempt (an automatic retry is due). */
    notAccepted?: string[];
    /** How long each Telegram call takes on the fake clock. */
    sendTakesMs?: number;
    onSend?: (count: number) => void;
  } = {},
) {
  const clock = fixedClock(NOW);
  const calls: string[] = [];
  const finished: FinishAttemptInput[] = [];
  const skipped: Array<{ replyId: string; failureReason: string }> = [];
  const sent: Array<{ chatId: bigint; text: string }> = [];
  const sleeps: number[] = [];
  const delayed: Array<{ seconds: number }> = [];
  const outcomes = [...(o.outcomes ?? [])];
  let lastStarted = o.lastStartedAt ?? null;
  const delivery: ReplyDelivery = {
    async pendingReplies() {
      return o.pending ?? [];
    },
    async lastStartedAt() {
      return lastStarted;
    },
    async inFlightSince() {
      return o.inFlightSince ?? null;
    },
    async wasNotAccepted(_w, _c, replyId) {
      return (o.notAccepted ?? []).includes(replyId);
    },
    async chatIdOf() {
      return CHAT;
    },
    async startAttempt({ replyId }) {
      calls.push(`start:${replyId}`);
      if (o.startReturnsNull) return null;
      lastStarted = clock.now();
      return { attemptId: `att-${replyId}` };
    },
    async finishAttempt(input) {
      calls.push(`finish:${input.attemptId}`);
      finished.push(input);
      return true;
    },
    async skipReply(input) {
      calls.push(`skip:${input.replyId}`);
      skipped.push({ replyId: input.replyId, failureReason: input.failureReason });
      return true;
    },
    async resolveStaleInFlight(_w, _c, olderThan) {
      calls.push(`stale:${olderThan.toISOString()}`);
      return [];
    },
    async resolveDeadLetter() {
      return { notConfirmed: [], interrupted: [], inFlightSince: null };
    },
  };
  const deliver = createDeliver({
    delivery,
    workspaces: { activeMembersAmong: async () => o.active ?? [ME] },
    bots: {
      canCarryReplies: async () => o.canCarry ?? true,
      async sendText(r) {
        calls.push('send');
        if (o.sendThrows) throw new Error('boom');
        if (o.sendTakesMs) clock.advance(o.sendTakesMs);
        sent.push({ chatId: r.chatId, text: r.text });
        o.onSend?.(sent.length);
        return outcomes.shift() ?? { outcome: 'accepted', messageId: 7n, at: clock.now() };
      },
    },
    enqueueDelayed: async (_w, _c, seconds) => {
      delayed.push({ seconds });
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
    },
    clock,
  });
  return { deliver, calls, finished, skipped, sent, sleeps, delayed, clock };
}

const run = (s: ReturnType<typeof setup>, signal?: AbortSignal) =>
  s.deliver.deliverConversation({
    workspaceId: WS,
    conversationId: CONV,
    ...(signal && { signal }),
  });

describe('deliverConversation', () => {
  it('first resolves attempts in flight for more than 10 s (at-most-once, AC-11)', async () => {
    const s = setup();
    await run(s);
    expect(s.calls[0]).toBe(`stale:${new Date(NOW.getTime() - 10_000).toISOString()}`);
  });

  it('is a no-op with nothing pending', async () => {
    const s = setup();
    await run(s);
    expect(s.sent).toEqual([]);
    expect(s.delayed).toEqual([]);
  });

  it('sends pending replies oldest first, plain text to the chat, and records sent', async () => {
    const s = setup({ pending: [reply('r1', 'one'), reply('r2', 'two\nlines')] });
    await run(s);
    expect(s.sent).toEqual([
      { chatId: CHAT, text: 'one' },
      { chatId: CHAT, text: 'two\nlines' },
    ]);
    expect(s.calls.filter((c) => c !== 'send' && !c.startsWith('stale'))).toEqual([
      'start:r1',
      'finish:att-r1',
      'start:r2',
      'finish:att-r2',
    ]);
    expect(s.finished[0]).toMatchObject({
      attemptOutcome: 'accepted',
      replyState: 'sent',
      telegramMessageId: 7n,
      sentAt: NOW,
    });
  });

  it('marks the attempt in flight before the call and finishes after it', async () => {
    const s = setup({ pending: [reply('r1', 'one')] });
    await run(s);
    const order = s.calls.filter((c) => !c.startsWith('stale'));
    expect(order).toEqual(['start:r1', 'send', 'finish:att-r1']);
  });

  it('waits until 1 s has passed since the last start in the chat', async () => {
    const s = setup({
      pending: [reply('r1', 'one')],
      lastStartedAt: new Date(NOW.getTime() - 400),
    });
    await run(s);
    expect(s.sleeps).toEqual([600]);
  });

  it('does not wait when the last start is older than 1 s', async () => {
    const s = setup({
      pending: [reply('r1', 'one')],
      lastStartedAt: new Date(NOW.getTime() - 5000),
    });
    await run(s);
    expect(s.sleeps).toEqual([]);
  });

  it('skips a reply whose author is no longer an active member, without calling Telegram (AC-09)', async () => {
    const s = setup({ pending: [reply('r1', 'one'), reply('r2', 'two')], active: [] });
    await run(s);
    expect(s.sent).toEqual([]);
    expect(s.skipped).toEqual([
      { replyId: 'r1', failureReason: 'author_access_removed' },
      { replyId: 'r2', failureReason: 'author_access_removed' },
    ]);
  });

  it('skips remaining replies when the bot cannot carry replies (AC-13)', async () => {
    const s = setup({ pending: [reply('r1', 'one')], canCarry: false });
    await run(s);
    expect(s.sent).toEqual([]);
    expect(s.skipped).toEqual([{ replyId: 'r1', failureReason: 'bot_not_working' }]);
  });

  it('a refused send ends not_delivered and the drain continues (AC-10)', async () => {
    const s = setup({
      pending: [reply('r1', 'one'), reply('r2', 'two')],
      outcomes: [{ outcome: 'refused', reason: 'blocked' }],
    });
    await run(s);
    expect(s.sent).toHaveLength(2);
    expect(s.finished[0]).toMatchObject({
      attemptOutcome: 'refused',
      replyState: 'not_delivered',
      failureReason: 'customer_blocked',
    });
  });

  it('a timeout is recorded not_confirmed and the reply is never sent again (AC-11)', async () => {
    const s = setup({
      pending: [reply('r1', 'one')],
      outcomes: [{ outcome: 'unknown' }],
    });
    await run(s);
    expect(s.sent).toHaveLength(1);
    expect(s.finished[0]).toMatchObject({ attemptOutcome: 'unknown', replyState: 'not_confirmed' });
  });

  it('a throwing gateway is treated as unknown, not retried', async () => {
    const s = setup({ pending: [reply('r1', 'one')], sendThrows: true });
    await run(s);
    expect(s.finished[0]).toMatchObject({ attemptOutcome: 'unknown', replyState: 'not_confirmed' });
  });

  it('not accepted inside the window keeps the reply sending, enqueues a delayed job and stops (AC-12)', async () => {
    const s = setup({
      pending: [reply('r1', 'one'), reply('r2', 'two')],
      outcomes: [{ outcome: 'not_accepted', retryAfterMs: 7_200 }],
    });
    await run(s);
    expect(s.sent).toHaveLength(1);
    expect(s.finished[0]).toMatchObject({ attemptOutcome: 'not_accepted', replyState: 'sending' });
    expect(s.delayed).toEqual([{ seconds: 8 }]);
  });

  it('not accepted without retry_after uses the default back-off', async () => {
    const s = setup({ pending: [reply('r1', 'one')], outcomes: [{ outcome: 'not_accepted' }] });
    await run(s);
    expect(s.delayed).toEqual([{ seconds: 5 }]);
  });

  it('not accepted after 5 minutes ends not_delivered and the drain continues', async () => {
    const old = new Date(NOW.getTime() - 301_000);
    const s = setup({
      pending: [reply('r1', 'one', old), reply('r2', 'two')],
      outcomes: [{ outcome: 'not_accepted' }],
    });
    await run(s);
    expect(s.delayed).toEqual([]);
    expect(s.sent).toHaveLength(2);
    expect(s.finished[0]).toMatchObject({
      replyState: 'not_delivered',
      failureReason: 'telegram_not_accepted',
    });
  });

  it('does not call Telegram when the attempt cannot be started', async () => {
    const s = setup({ pending: [reply('r1', 'one')], startReturnsNull: true });
    await run(s);
    expect(s.sent).toEqual([]);
  });

  it('sends nothing while an attempt started less than 10 s ago is unfinished; a delayed job follows (ADR-0004)', async () => {
    const s = setup({
      pending: [reply('r1', 'one')],
      inFlightSince: new Date(NOW.getTime() - 3_000),
    });
    await run(s);
    expect(s.sent).toEqual([]);
    expect(s.calls.some((c) => c.startsWith('start:'))).toBe(false);
    expect(s.delayed).toEqual([{ seconds: 8 }]);
  });
  it('stamps the sent time with our clock, not the second-truncated Telegram date (B4, AC-06)', async () => {
    const s = setup({
      pending: [reply('r1', 'one')],
      outcomes: [{ outcome: 'accepted', messageId: 9n, at: new Date('2026-10-18T09:59:00Z') }],
    });
    await run(s);
    expect(s.finished[0]).toMatchObject({ replyState: 'sent', telegramMessageId: 9n, sentAt: NOW });
  });

  it('stops within its time budget, well before the 60 s job expiry, and hands the rest to a follow-up drain (B1, AC-12)', async () => {
    const pending = Array.from({ length: 30 }, (_, i) => reply(`r${i}`, `text ${i}`));
    const s = setup({ pending, sendTakesMs: 3_000 });
    await run(s);
    expect(s.sent.length).toBeGreaterThan(0);
    expect(s.sent.length).toBeLessThan(30);
    // The last start is inside the 40 s budget; even a 10 s send then ends before the expiry.
    expect(s.clock.now().getTime() - NOW.getTime()).toBeLessThanOrEqual(40_000 + 10_000);
    expect(s.delayed).toEqual([{ seconds: 1 }]);
    const starts = s.calls.filter((c) => c.startsWith('start:'));
    expect(starts).toHaveLength(s.sent.length);
  });

  it('starts no further attempt once the job signal is aborted (expired or shutting down) (B1)', async () => {
    const controller = new AbortController();
    const s = setup({
      pending: [reply('r1', 'one'), reply('r2', 'two'), reply('r3', 'three')],
      onSend: () => controller.abort(),
    });
    await run(s, controller.signal);
    expect(s.sent).toHaveLength(1);
    expect(s.calls.filter((c) => c.startsWith('start:'))).toEqual(['start:r1']);
    // pg-boss re-runs an expired or interrupted job itself: no extra job here.
    expect(s.delayed).toEqual([]);
  });

  it('a retry due after the 5-minute window ends not_delivered without calling Telegram (B6, AC-12)', async () => {
    const old = new Date(NOW.getTime() - 301_000);
    const s = setup({
      pending: [reply('r1', 'one', old), reply('r2', 'two')],
      notAccepted: ['r1'],
    });
    await run(s);
    expect(s.skipped).toEqual([{ replyId: 'r1', failureReason: 'telegram_not_accepted' }]);
    expect(s.calls).not.toContain('start:r1');
    expect(s.sent).toEqual([{ chatId: CHAT, text: 'two' }]);
  });

  it('a reply past 5 minutes that was never refused is still sent', async () => {
    const old = new Date(NOW.getTime() - 301_000);
    const s = setup({ pending: [reply('r1', 'one', old)] });
    await run(s);
    expect(s.skipped).toEqual([]);
    expect(s.sent).toHaveLength(1);
  });
});
