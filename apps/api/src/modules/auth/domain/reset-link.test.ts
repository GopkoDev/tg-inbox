import { describe, expect, it } from 'vitest';
import { RESET_LINK_TTL, resetLinkIsUsable } from './reset-link.js';

const now = new Date('2026-03-01T00:00:00Z');
const later = new Date(now.getTime() + 1000);

describe('resetLinkIsUsable', () => {
  it('has a 24 h ttl', () => {
    expect(RESET_LINK_TTL).toBe(24 * 3_600_000);
  });
  it('is usable when pending and not expired', () => {
    expect(resetLinkIsUsable({ state: 'pending', expiresAt: later }, now)).toBe(true);
  });
  it('is not usable at expires_at == now', () => {
    expect(resetLinkIsUsable({ state: 'pending', expiresAt: now }, now)).toBe(false);
  });
  it.each(['used', 'superseded'] as const)('is not usable when %s', (state) => {
    expect(resetLinkIsUsable({ state, expiresAt: later }, now)).toBe(false);
  });
});
