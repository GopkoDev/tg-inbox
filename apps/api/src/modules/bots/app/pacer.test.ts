import { describe, expect, it } from 'vitest';
import { createPacer } from './pacer.js';

/** A pacer on a virtual clock: sleeping advances the time, nothing really waits. */
function virtual() {
  let t = 1_000_000;
  const pacer = createPacer({
    perSecond: 10,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  });
  return { pacer, time: () => t };
}

/**
 * A virtual timer queue: `sleep` resolves only when the test moves the time past its due time. A
 * stall moves the time in one jump and fires every overdue timer at that one moment, as a blocked
 * event loop does.
 */
function scheduler() {
  let t = 0;
  let timers: { due: number; fire: () => void }[] = [];
  const flush = () => new Promise<void>((r) => setImmediate(r));
  return {
    now: () => t,
    sleep: (ms: number) => new Promise<void>((fire) => timers.push({ due: t + ms, fire })),
    /** Jumps to `to`, firing every timer due by then at `to`. */
    async stallUntil(to: number) {
      t = to;
      const due = timers.filter((x) => x.due <= t);
      timers = timers.filter((x) => x.due > t);
      due.forEach((x) => x.fire());
      await flush();
    },
    /** Runs the timers one by one, each at its due time, until none is left. */
    async drain() {
      await flush();
      while (timers.length > 0) {
        timers.sort((a, b) => a.due - b.due);
        const next = timers.shift()!;
        t = Math.max(t, next.due);
        next.fire();
        await flush();
      }
    },
  };
}

describe('the per-bot pacer (ADR-0006)', () => {
  it('ADR-0008: a stall never lets delayed callers start together — no 1 s window above 25', async () => {
    const s = scheduler();
    const pacer = createPacer({ perSecond: 25, now: s.now, sleep: s.sleep });
    const starts: number[] = [];
    const all = Promise.all(
      Array.from({ length: 60 }, () => pacer.wait('bot-a').then(() => void starts.push(s.now()))),
    );
    // The first start is at once; then the event loop is blocked for 300 ms.
    await s.stallUntil(300);
    await s.drain();
    await all;
    expect(starts).toHaveLength(60);
    for (const [i, x] of starts.entries()) {
      const inWindow = starts.filter((y, j) => j >= i && y < x + 1000).length;
      expect(inWindow).toBeLessThanOrEqual(25);
    }
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(40);
    }
  });

  it('lets at most 10 sends start in any second for one bot', async () => {
    const { pacer, time } = virtual();
    const starts: number[] = [];
    for (let i = 0; i < 35; i++) {
      await pacer.wait('bot-a');
      starts.push(time());
    }
    for (const [i, s] of starts.entries()) {
      const inWindow = starts.filter((x, j) => j >= i && x < s + 1000).length;
      expect(inWindow).toBeLessThanOrEqual(10);
    }
    expect(starts[34]! - starts[0]!).toBeGreaterThanOrEqual(3400);
  });

  it('does not delay the first send, nor one after a quiet second', async () => {
    const { pacer, time } = virtual();
    const t0 = time();
    await pacer.wait('bot-a');
    expect(time()).toBe(t0);
    await pacer.wait('bot-a');
    await pacer.wait('bot-a');
    const busy = time();
    expect(busy).toBeGreaterThan(t0);
  });

  it('keeps the bots apart', async () => {
    const { pacer, time } = virtual();
    const t0 = time();
    for (let i = 0; i < 5; i++) await pacer.wait('bot-a');
    const afterA = time();
    await pacer.wait('bot-b');
    expect(time()).toBe(afterA);
    expect(afterA).toBeGreaterThan(t0);
  });

  it('spaces concurrent callers of one bot too', async () => {
    const pacer = createPacer({ perSecond: 100 });
    const started = Date.now();
    const starts: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, async () => {
        await pacer.wait('bot-a');
        starts.push(Date.now() - started);
      }),
    );
    expect(Math.max(...starts)).toBeGreaterThanOrEqual(170);
  });
});
