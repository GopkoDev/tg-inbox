import type { Pacer } from '../modules/bots/app/pacer.js';

/**
 * Wraps a pacer and records when each caller was released, per key: the moment the send starts.
 * The pace ceiling is asserted on these starts, which the product controls, not on the fake Bot
 * API's arrival times, which add the test process's own transport jitter.
 */
export function recordingPacer(inner: Pacer): Pacer & { starts(key: string): number[] } {
  const starts = new Map<string, number[]>();
  return {
    async wait(key) {
      await inner.wait(key);
      const list = starts.get(key) ?? [];
      list.push(performance.now());
      starts.set(key, list);
    },
    starts: (key) => [...(starts.get(key) ?? [])],
  };
}

/** The most of `times` (ms) in any half-open 1 s window. */
export function mostInOneSecond(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  let most = 0;
  let j = 0;
  for (let i = 0; i < sorted.length; i++) {
    while (j < sorted.length && sorted[j]! < sorted[i]! + 1000) j++;
    most = Math.max(most, j - i);
  }
  return most;
}
