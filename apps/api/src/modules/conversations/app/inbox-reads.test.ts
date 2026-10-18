import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { fakeConversationSignals, fakeReadMarkRepo } from './fakes.js';
import { createInboxReads } from './inbox-reads.js';
import type { Executor } from './ports.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const W = 'w1';
const C = 'c1';
const A = 'a1';

function setup(arrivals: Date[] | null = [at(50)]) {
  const marks = fakeReadMarkRepo({ arrivals });
  const signals = fakeConversationSignals();
  const tx = { marker: 'tx' } as unknown as Executor;
  const reads = createInboxReads({
    transaction: (fn) => fn(tx),
    marks,
    signals,
    // the list / thread readers are not used by mark read
    lists: undefined as never,
    threads: undefined as never,
    clock: fixedClock(at(100)),
  });
  return { reads, signals, marks, tx };
}

const input = (readThroughAt: Date) => ({
  conversationId: C,
  accountId: A,
  activeSince: at(0),
  readThroughAt,
});

describe('inbox reads: mark read', () => {
  it('raises the watermark and publishes conversation.changed (read) in the same transaction', async () => {
    const { reads, signals, tx } = setup();
    const state = await reads.markRead(W, input(at(30)));
    expect(state?.readThroughAt).toEqual(at(30));
    expect(signals.read).toEqual([{ workspaceId: W, conversationId: C, accountId: A, tx }]);
  });

  it('keeps a higher stored watermark and clamps a future time to the newest arrival', async () => {
    const { reads } = setup();
    await reads.markRead(W, input(at(40)));
    expect((await reads.markRead(W, input(at(10))))?.readThroughAt).toEqual(at(40));
    expect((await reads.markRead(W, input(at(9999))))?.readThroughAt).toEqual(at(50));
  });

  it('answers null and publishes nothing for a conversation that is not in the workspace', async () => {
    const { reads, signals } = setup(null);
    expect(await reads.markRead(W, input(at(30)))).toBeNull();
    expect(signals.read).toEqual([]);
  });
});
