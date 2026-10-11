import { describe, expect, it } from 'vitest';
import { deactivate, reactivate, type Membership } from './membership.js';

const now = new Date('2026-03-01T00:00:00Z');
const base: Membership = { id: 'm1', role: 'owner', state: 'active', deactivatedAt: null };

describe('membership transitions', () => {
  it('deactivate sets state and timestamp, keeps role', () => {
    expect(deactivate(base, now)).toEqual({ ...base, state: 'deactivated', deactivatedAt: now });
  });
  it('deactivate is idempotent', () => {
    const d = deactivate(base, now);
    expect(deactivate(d, new Date(now.getTime() + 5000))).toEqual(d);
  });
  it('reactivate (AC-19) restores access with the previous role and clears the timestamp', () => {
    expect(reactivate(deactivate(base, now))).toEqual(base);
  });
  it('reactivate is idempotent', () => {
    expect(reactivate(base)).toEqual(base);
  });
});
