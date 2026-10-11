import { describe, expect, it } from 'vitest';
import { lockoutState } from './lockout.js';

const T0 = new Date('2026-01-01T12:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const burst = (n: number) => Array.from({ length: n }, (_, i) => at(i));

describe('lockoutState (AC-09)', () => {
  it('is not locked with 9 failures', () => {
    expect(lockoutState(burst(9), at(10))).toEqual({ locked: false });
  });
  it('locks on the 10th failure until 15 min after it', () => {
    expect(lockoutState(burst(10), at(10))).toEqual({ locked: true, until: at(9 + 15) });
  });
  it('is unlocked exactly 15 min after the 10th failure', () => {
    expect(lockoutState(burst(10), at(9 + 15))).toEqual({ locked: false });
  });
  it('does not lock when 10 failures are spread over 16 minutes', () => {
    const f = Array.from({ length: 10 }, (_, i) => at(i * (16 / 9)));
    expect(lockoutState(f, at(17))).toEqual({ locked: false });
  });
  it('is unlocked with no failures', () => {
    expect(lockoutState([], T0)).toEqual({ locked: false });
  });
  it('accepts unsorted input', () => {
    expect(lockoutState(burst(10).reverse(), at(10)).locked).toBe(true);
  });
});
