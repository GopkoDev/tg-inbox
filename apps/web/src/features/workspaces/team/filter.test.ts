import type { Membership, PendingInvitation } from '@tg/shared';
import { describe, expect, it } from 'vitest';
import { filterTeam } from './filter';

/**
 * Signature under test (AC-08):
 *   filterTeam(
 *     { members: Membership[]; invitations: PendingInvitation[] },
 *     { query: string; role: 'all' | 'owner' | 'operator'; state: 'all' | 'active' | 'deactivated' },
 *   ): { members: Membership[]; invitations: PendingInvitation[] }
 */
const mem = (id: string, name: string, over: Partial<Membership> = {}): Membership => ({
  id,
  display_name: name,
  email: `${name.toLowerCase()}@x.test`,
  role: 'operator',
  state: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  deactivated_at: null,
  telegram_pings: false,
  ...over,
});
const inv = (
  id: string,
  email: string,
  role: 'owner' | 'operator' = 'operator',
): PendingInvitation => ({
  id,
  email,
  role,
  created_at: '2026-01-01T00:00:00.000Z',
  expires_at: '2026-02-01T00:00:00.000Z',
});

const members = [
  mem('m1', 'Olga', { role: 'owner', email: 'o@x.io' }),
  mem('m2', 'Bob'),
  mem('m3', 'Carl', { state: 'deactivated', deactivated_at: '2026-03-01T00:00:00.000Z' }),
];
const invitations = [inv('i1', 'New@X.test'), inv('i2', 'chief@y.test', 'owner')];
const all = { query: '', role: 'all', state: 'all' } as const;
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('filterTeam (AC-08)', () => {
  it('no filters: every loaded row, same order', () => {
    const out = filterTeam({ members, invitations }, all);
    expect(ids(out.members)).toEqual(['m1', 'm2', 'm3']);
    expect(ids(out.invitations)).toEqual(['i1', 'i2']);
  });

  it('query matches member name or email, case-insensitively; invitations by email', () => {
    expect(ids(filterTeam({ members, invitations }, { ...all, query: 'BOB' }).members)).toEqual([
      'm2',
    ]);
    expect(ids(filterTeam({ members, invitations }, { ...all, query: 'o@x.IO' }).members)).toEqual([
      'm1',
    ]);
    const out = filterTeam({ members, invitations }, { ...all, query: 'new@x' });
    expect(ids(out.invitations)).toEqual(['i1']);
    expect(ids(out.members)).toEqual([]);
  });

  it('role applies to both lists', () => {
    const out = filterTeam({ members, invitations }, { ...all, role: 'owner' });
    expect(ids(out.members)).toEqual(['m1']);
    expect(ids(out.invitations)).toEqual(['i2']);
  });

  it('state applies to members only; invitations are never filtered by state', () => {
    const out = filterTeam({ members, invitations }, { ...all, state: 'deactivated' });
    expect(ids(out.members)).toEqual(['m3']);
    expect(ids(out.invitations)).toEqual(['i1', 'i2']);
  });

  it('filters combine (query AND role AND state)', () => {
    const out = filterTeam(
      { members, invitations },
      { query: 'x.test', role: 'operator', state: 'active' },
    );
    expect(ids(out.members)).toEqual(['m2']);
    expect(ids(out.invitations)).toEqual(['i1']);
  });

  it('no match: empty lists, input not mutated', () => {
    const out = filterTeam({ members, invitations }, { ...all, query: 'zzz' });
    expect(out).toEqual({ members: [], invitations: [] });
    expect(members).toHaveLength(3);
  });
});
