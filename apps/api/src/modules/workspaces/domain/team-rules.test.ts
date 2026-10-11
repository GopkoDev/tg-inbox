import { describe, expect, it } from 'vitest';
import { AlreadyAMemberError, LastActiveOwnerError } from './errors.js';
import { assertKeepsActiveOwner, assertNotAMember, type TeamMember } from './team-rules.js';

const m = (id: string, role: TeamMember['role'], state: TeamMember['state']): TeamMember => ({
  id,
  role,
  state,
});

describe('assertKeepsActiveOwner (AC-18)', () => {
  it('refuses deactivating the only active owner', () => {
    const team = [m('a', 'owner', 'active'), m('o', 'operator', 'active')];
    expect(() => assertKeepsActiveOwner(team, 'a')).toThrow(LastActiveOwnerError);
  });
  it('allows one of two active owners to deactivate', () => {
    const team = [m('a', 'owner', 'active'), m('b', 'owner', 'active')];
    expect(() => assertKeepsActiveOwner(team, 'a')).not.toThrow();
  });
  it('counts deactivated owners as inactive', () => {
    const team = [m('a', 'owner', 'active'), m('b', 'owner', 'deactivated')];
    expect(() => assertKeepsActiveOwner(team, 'a')).toThrow(LastActiveOwnerError);
  });
  it('an operator-only active set still violates', () => {
    const team = [m('a', 'owner', 'deactivated'), m('o', 'operator', 'active')];
    expect(() => assertKeepsActiveOwner(team, 'o')).toThrow(LastActiveOwnerError);
  });
  it('deactivating an operator while an owner remains is fine', () => {
    const team = [m('a', 'owner', 'active'), m('o', 'operator', 'active')];
    expect(() => assertKeepsActiveOwner(team, 'o')).not.toThrow();
  });
});

describe('assertNotAMember (AC-16)', () => {
  it('passes when there is no membership', () => {
    expect(() => assertNotAMember(null)).not.toThrow();
    expect(() => assertNotAMember(undefined)).not.toThrow();
  });
  it.each(['active', 'deactivated'] as const)(
    'refuses a %s member with its id and state',
    (state) => {
      let caught: unknown;
      try {
        assertNotAMember({ id: 'm9', state });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(AlreadyAMemberError);
      expect((caught as AlreadyAMemberError).membershipId).toBe('m9');
      expect((caught as AlreadyAMemberError).state).toBe(state);
    },
  );
});
