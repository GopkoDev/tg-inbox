import { describe, expect, it } from 'vitest';
import { askFor, INVITATION_TTL, invitationIsUsable } from './invitation.js';

const now = new Date('2026-03-01T00:00:00Z');
const later = new Date(now.getTime() + 1);

describe('invitationIsUsable (AC-06)', () => {
  it('has a 7 day ttl', () => {
    expect(INVITATION_TTL).toBe(7 * 86_400_000);
  });
  it('is usable when pending and unexpired', () => {
    expect(invitationIsUsable({ state: 'pending', expiresAt: later }, now)).toBe(true);
  });
  it('is not usable at expires_at == now', () => {
    expect(invitationIsUsable({ state: 'pending', expiresAt: now }, now)).toBe(false);
  });
  it.each(['accepted', 'revoked', 'superseded'] as const)('is not usable when %s', (state) => {
    expect(invitationIsUsable({ state, expiresAt: later }, now)).toBe(false);
  });
});

describe('askFor', () => {
  it('asks the tg-inbox team when the workspace has no members', () => {
    expect(askFor(false)).toBe('tg_inbox_team');
  });
  it('asks a business owner otherwise', () => {
    expect(askFor(true)).toBe('business_owner');
  });
});
