import { describe, expect, it } from 'vitest';
import {
  CHAT_SPACING_MS,
  MAX_AHEAD_MS,
  MIN_AHEAD_MS,
  MISS_WINDOW_MS,
  checkRange,
  isMissed,
  nextSendAt,
} from './schedule.js';

const now = new Date('2026-03-10T12:00:00.000Z');
const at = (ms: number) => new Date(now.getTime() + ms);

describe('schedule constants', () => {
  it('2 minutes, 90 days, 15 minutes, 3 s', () => {
    expect(MIN_AHEAD_MS).toBe(2 * 60_000);
    expect(MAX_AHEAD_MS).toBe(90 * 86_400_000);
    expect(MISS_WINDOW_MS).toBe(15 * 60_000);
    expect(CHAT_SPACING_MS).toBe(3000);
  });
});

describe('checkRange (AC-10)', () => {
  it('accepts exactly 2 minutes and exactly 90 days ahead', () => {
    expect(checkRange(at(MIN_AHEAD_MS), now)).toEqual({ ok: true });
    expect(checkRange(at(MAX_AHEAD_MS), now)).toEqual({ ok: true });
  });
  it('refuses less than 2 minutes ahead', () => {
    expect(checkRange(at(MIN_AHEAD_MS - 1), now)).toEqual({ ok: false, reason: 'too_soon' });
    expect(checkRange(at(-1000), now)).toEqual({ ok: false, reason: 'too_soon' });
  });
  it('refuses more than 90 days ahead', () => {
    expect(checkRange(at(MAX_AHEAD_MS + 1), now)).toEqual({ ok: false, reason: 'too_far' });
  });
});

describe('isMissed (AC-12)', () => {
  const t = new Date('2026-03-10T09:00:00.000Z');
  it('exactly 15:00 after the time is still allowed', () => {
    expect(isMissed(t, new Date(t.getTime() + 15 * 60_000))).toBe(false);
  });
  it('15:00.001 after the time is missed', () => {
    expect(isMissed(t, new Date(t.getTime() + 15 * 60_000 + 1))).toBe(true);
  });
  it('before the time is not missed', () => {
    expect(isMissed(t, new Date(t.getTime() - 1000))).toBe(false);
  });
});

describe('nextSendAt', () => {
  it('is the last send plus 3 s', () => {
    expect(nextSendAt(now)).toEqual(at(3000));
  });
});
