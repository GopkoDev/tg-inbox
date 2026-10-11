import { describe, expect, it } from 'vitest';
import { fixedClock, systemClock } from './clock.js';

describe('clock', () => {
  it('systemClock returns the current time', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it('fixedClock stays put until set or advanced', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const clock = fixedClock(start);
    expect(clock.now()).toEqual(start);
    clock.advance(15 * 60_000);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:15:00.000Z');
    clock.set(new Date('2027-01-01T00:00:00Z'));
    expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('fixedClock does not leak its internal date', () => {
    const clock = fixedClock(new Date(0));
    clock.now().setFullYear(2099);
    expect(clock.now().getTime()).toBe(0);
  });
});
