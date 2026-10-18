import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time';

const now = new Date(2026, 9, 18, 12, 0, 0);

describe('relativeTime', () => {
  it('formats now, minutes, hours, yesterday and older dates', () => {
    expect(relativeTime(new Date(2026, 9, 18, 11, 59, 40).toISOString(), now)).toBe('now');
    expect(relativeTime(new Date(2026, 9, 18, 11, 55).toISOString(), now)).toBe('5m');
    expect(relativeTime(new Date(2026, 9, 18, 9, 0).toISOString(), now)).toBe('3h');
    expect(relativeTime(new Date(2026, 9, 17, 23, 0).toISOString(), now)).toBe('Yest.');
    expect(relativeTime(new Date(2026, 9, 10, 9, 0).toISOString(), now)).toMatch(/10/);
  });
});
