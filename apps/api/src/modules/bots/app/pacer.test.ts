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

describe('the per-bot pacer (ADR-0006)', () => {
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
