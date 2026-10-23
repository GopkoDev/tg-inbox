import { describe, expect, it } from 'vitest';
import { isAway, isPresent, type PresenceLease } from './presence.js';
import { PRESENCE_WINDOW_MS } from './constants.js';

const NOW = new Date('2026-10-19T10:00:00Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const MIN = 60_000;

const lease = (o: Partial<PresenceLease> = {}): PresenceLease => ({
  liveUntil: at(30_000),
  onScreen: true,
  lastOnScreenAt: null,
  ...o,
});

describe('isPresent (AC-07)', () => {
  it('counts a live lease whose tab is on screen', () => {
    expect(isPresent([lease()], NOW)).toBe(true);
  });

  it('counts a live hidden tab that left the screen 9 minutes ago', () => {
    expect(isPresent([lease({ onScreen: false, lastOnScreenAt: at(-9 * MIN) })], NOW)).toBe(true);
  });

  it('does not count a live hidden tab that left the screen 11 minutes ago', () => {
    expect(isPresent([lease({ onScreen: false, lastOnScreenAt: at(-11 * MIN) })], NOW)).toBe(false);
  });

  it('does not count a hidden tab that never showed', () => {
    expect(isPresent([lease({ onScreen: false, lastOnScreenAt: null })], NOW)).toBe(false);
  });

  it('draws the 10-minute line exclusively', () => {
    expect(PRESENCE_WINDOW_MS).toBe(10 * MIN);
    expect(isPresent([lease({ onScreen: false, lastOnScreenAt: at(-10 * MIN) })], NOW)).toBe(false);
    expect(isPresent([lease({ onScreen: false, lastOnScreenAt: at(-10 * MIN + 1) })], NOW)).toBe(
      true,
    );
  });

  it('does not count an expired lease, even on screen', () => {
    expect(isPresent([lease({ liveUntil: at(-1) })], NOW)).toBe(false);
    expect(isPresent([lease({ liveUntil: NOW })], NOW)).toBe(false);
  });

  it('is present when any one of several tabs counts', () => {
    expect(
      isPresent(
        [lease({ liveUntil: at(-1) }), lease({ onScreen: false }), lease({ onScreen: true })],
        NOW,
      ),
    ).toBe(true);
  });

  it('is not present with no leases', () => {
    expect(isPresent([], NOW)).toBe(false);
  });
});

describe('isAway', () => {
  it('is the negation of isPresent', () => {
    expect(isAway([], NOW)).toBe(true);
    expect(isAway([lease()], NOW)).toBe(false);
  });
});
