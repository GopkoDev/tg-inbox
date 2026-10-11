import { describe, expect, it } from 'vitest';
import { sessionIsExpired, shouldRefreshLastSeen } from './session.js';

const now = new Date('2026-03-01T00:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const DAY = 86_400_000;

describe('sessionIsExpired', () => {
  it('is not expired at exactly 30 days', () => {
    expect(sessionIsExpired(ago(30 * DAY), now)).toBe(false);
  });
  it('is expired 30 days + 1 ms', () => {
    expect(sessionIsExpired(ago(30 * DAY + 1), now)).toBe(true);
  });
});

describe('shouldRefreshLastSeen', () => {
  it('refreshes a user-triggered request after a minute', () => {
    expect(shouldRefreshLastSeen(ago(60_000), now, false)).toBe(true);
  });
  it('does not refresh within a minute', () => {
    expect(shouldRefreshLastSeen(ago(59_999), now, false)).toBe(false);
  });
  it('never refreshes on a background request', () => {
    expect(shouldRefreshLastSeen(ago(DAY), now, true)).toBe(false);
  });
});
