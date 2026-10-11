import { describe, expect, it } from 'vitest';
import { shouldRefreshProfile } from './profile.js';

const t = (s: number) => new Date(Date.UTC(2026, 9, 11, 10, 0, s));

describe('shouldRefreshProfile (AC-08)', () => {
  it('refreshes from a strictly newer message', () => {
    expect(shouldRefreshProfile(t(1), t(2))).toBe(true);
  });

  it('keeps the profile for a message of the same second', () => {
    expect(shouldRefreshProfile(t(2), t(2))).toBe(false);
  });

  it('keeps the profile for an older message delivered late', () => {
    expect(shouldRefreshProfile(t(5), t(2))).toBe(false);
  });
});
