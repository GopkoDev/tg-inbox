import { describe, expect, it } from 'vitest';
import {
  DAILY_SENT_LIMIT,
  DESTINATION_LIMIT,
  SCHEDULED_WAITING_LIMIT,
  dailyLimitReached,
  freesAt,
  scheduledLimitReached,
} from './limits.js';

const now = new Date('2026-03-10T12:00:00.000Z');
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe('limits (AC-16)', () => {
  it('constants', () => {
    expect(DAILY_SENT_LIMIT).toBe(30);
    expect(SCHEDULED_WAITING_LIMIT).toBe(100);
    expect(DESTINATION_LIMIT).toBe(20);
  });

  it('daily limit counts sends started in the last 24 h only', () => {
    const sent29 = Array.from({ length: 29 }, () => ago(1));
    expect(dailyLimitReached(sent29, now)).toBe(false);
    expect(dailyLimitReached([...sent29, ago(2)], now)).toBe(true);
    expect(dailyLimitReached([...sent29, ago(24.5)], now)).toBe(false);
  });

  it('freesAt is when the oldest counted send leaves the 24 h window, null when under the limit', () => {
    expect(freesAt([ago(1)], now)).toBeNull();
    const sent = [ago(20), ...Array.from({ length: 29 }, () => ago(1))];
    expect(freesAt(sent, now)).toEqual(new Date(ago(20).getTime() + 24 * 3_600_000));
  });

  it('scheduled limit refuses the 101st waiting post', () => {
    expect(scheduledLimitReached(99)).toBe(false);
    expect(scheduledLimitReached(100)).toBe(true);
  });
});
