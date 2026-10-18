import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import {
  AlreadyAMemberError,
  LastActiveOwnerError,
  NotFoundError,
} from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import { hashToken } from '../../../platform/tokens.js';
import type { MembershipState, Role } from '../domain/membership.js';
import type { InvitationRecord, MembershipRecord, UnitOfWork, WorkspaceRepos } from './ports.js';
import { createTeam } from './team.js';

const T0 = new Date('2026-03-01T00:00:00Z');
const JOINED = new Date('2026-02-01T00:00:00Z');
const WEEK = 7 * 86_400_000;
const WS = 'ws-1';
const OTHER_WS = 'ws-2';

function setup() {
  const members: MembershipRecord[] = [];
  const invitations: InvitationRecord[] = [];
  const accounts = new Map<string, { id: string; email: string; displayName: string }>();

  function addMember(
    n: string,
    role: Role,
    state: MembershipState = 'active',
    workspaceId = WS,
  ): MembershipRecord {
    const accountId = `acc-${n}`;
    accounts.set(accountId, { id: accountId, email: `${n}@x.test`, displayName: n });
    const m: MembershipRecord = {
      id: newId(),
      workspaceId,
      accountId,
      role,
      state,
      lastUsedAt: null,
      deactivatedAt: state === 'deactivated' ? T0 : null,
      createdAt: T0,
      activeSince: JOINED,
    };
    members.push(m);
    return m;
  }

  const repos = {
    workspaces: { lockForUpdate: async (id: string) => id === WS || id === OTHER_WS },
    memberships: {
      findById: async (w: string, id: string) =>
        members.find((m) => m.workspaceId === w && m.id === id) ?? null,
      findByAccount: async (w: string, a: string) =>
        members.find((m) => m.workspaceId === w && m.accountId === a) ?? null,
      list: async (w: string) => members.filter((m) => m.workspaceId === w),
      countActiveOwners: async (w: string) =>
        members.filter((m) => m.workspaceId === w && m.role === 'owner' && m.state === 'active')
          .length,
      setState: async (
        w: string,
        id: string,
        state: MembershipState,
        at: Date | null,
        activeSince?: Date,
      ) => {
        const m = members.find((x) => x.workspaceId === w && x.id === id);
        if (!m) return false;
        m.state = state;
        m.deactivatedAt = at;
        if (activeSince) m.activeSince = activeSince;
        return true;
      },
    },
    invitations: {
      insert: async (w: string, i: Omit<InvitationRecord, 'workspaceId'>) =>
        void invitations.push({ ...i, workspaceId: w }),
      supersedePending: async (w: string, email: string, now: Date) => {
        let n = 0;
        for (const i of invitations) {
          if (i.workspaceId === w && i.email === email && i.state === 'pending') {
            i.state = 'superseded';
            i.closedAt = now;
            n++;
          }
        }
        return n;
      },
      listPending: async (w: string, now: Date) =>
        invitations.filter(
          (i) => i.workspaceId === w && i.state === 'pending' && i.expiresAt > now,
        ),
      revoke: async (w: string, id: string, now: Date) => {
        const i = invitations.find((x) => x.workspaceId === w && x.id === id);
        if (!i || i.state !== 'pending') return false;
        i.state = 'revoked';
        i.closedAt = now;
        return true;
      },
    },
  } as unknown as WorkspaceRepos;
  const uow: UnitOfWork = { run: (fn) => fn(repos, undefined as never) };
  const published: unknown[] = [];
  const team = createTeam({
    uow,
    clock: fixedClock(T0),
    publish: async (_tx, signal) => void published.push(signal),
    publicWebUrl: 'http://web.test',
    accounts: {
      findAccountIdByEmail: async (email) =>
        [...accounts.values()].find((a) => a.email === email)?.id,
      getAccountsByIds: async (ids) => ids.flatMap((id) => accounts.get(id) ?? []),
    },
  });
  return { team, members, invitations, published, addMember };
}

describe('inviteMember', () => {
  it('AC-14: creates a pending 7-day invitation with a one-time link; earlier ones are superseded', async () => {
    const s = setup();
    const first = await s.team.inviteMember(WS, { email: ' New@X.test ', role: 'operator' });
    const second = await s.team.inviteMember(WS, { email: 'new@x.test', role: 'operator' });
    expect(second.invitation).toMatchObject({ email: 'new@x.test', role: 'operator' });
    expect(second.invitation.expiresAt).toEqual(new Date(T0.getTime() + WEEK));
    const prefix = 'http://web.test/invite/';
    expect(second.link.startsWith(prefix)).toBe(true);
    const stored = s.invitations.find((i) => i.id === second.invitation.id)!;
    expect(stored.tokenHash.equals(hashToken(second.link.slice(prefix.length)))).toBe(true);
    expect(s.invitations.find((i) => i.id === first.invitation.id)?.state).toBe('superseded');
    expect(s.invitations.filter((i) => i.state === 'pending')).toHaveLength(1);
  });

  it.each(['active', 'deactivated'] as const)(
    'AC-16: refuses an email with a %s membership',
    async (state) => {
      const s = setup();
      const m = s.addMember('bob', 'operator', state);
      const err = await s.team
        .inviteMember(WS, { email: 'bob@x.test', role: 'owner' })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AlreadyAMemberError);
      expect((err as AlreadyAMemberError).details).toEqual({ membership_id: m.id, state });
      expect(s.invitations).toHaveLength(0);
    },
  );

  it('a member of another workspace can be invited here', async () => {
    const s = setup();
    s.addMember('bob', 'operator', 'active', OTHER_WS);
    await expect(
      s.team.inviteMember(WS, { email: 'bob@x.test', role: 'operator' }),
    ).resolves.toBeDefined();
  });
});

describe('deactivate / reactivate', () => {
  it('AC-18: refuses deactivating the last active owner, nothing changes', async () => {
    const s = setup();
    const ana = s.addMember('ana', 'owner');
    s.addMember('ben', 'owner', 'deactivated');
    s.addMember('op', 'operator');
    await expect(s.team.deactivateMembership(WS, ana.id)).rejects.toBeInstanceOf(
      LastActiveOwnerError,
    );
    expect(ana.state).toBe('active');
    expect(s.published).toEqual([]);
  });

  it('AC-18: an owner may deactivate themselves while another active owner remains', async () => {
    const s = setup();
    const ana = s.addMember('ana', 'owner');
    s.addMember('ben', 'owner');
    const r = await s.team.deactivateMembership(WS, ana.id);
    expect(r).toMatchObject({ id: ana.id, state: 'deactivated', role: 'owner' });
    expect(r.deactivatedAt).toEqual(T0);
    expect(ana.activeSince).toEqual(JOINED);
    expect(s.published).toEqual([
      { type: 'membership.deactivated', v: 1, workspace_id: WS, account_id: ana.accountId },
    ]);
  });

  it('deactivating an operator never needs another owner; repeated calls are unchanged', async () => {
    const s = setup();
    s.addMember('ana', 'owner');
    const op = s.addMember('op', 'operator');
    await s.team.deactivateMembership(WS, op.id);
    await expect(s.team.deactivateMembership(WS, op.id)).resolves.toMatchObject({
      state: 'deactivated',
    });
    expect(s.published).toHaveLength(1);
  });

  it('AC-19: reactivation keeps the role; already active is unchanged', async () => {
    const s = setup();
    const ben = s.addMember('ben', 'owner', 'deactivated');
    const r = await s.team.reactivateMembership(WS, ben.id);
    expect(r).toMatchObject({ state: 'active', role: 'owner', deactivatedAt: null });
    expect(ben.activeSince).toEqual(T0);
    await expect(s.team.reactivateMembership(WS, ben.id)).resolves.toMatchObject({
      state: 'active',
    });
    expect(s.published).toEqual([]);
  });

  it('a membership of another workspace is not found', async () => {
    const s = setup();
    const m = s.addMember('x', 'operator', 'active', OTHER_WS);
    await expect(s.team.deactivateMembership(WS, m.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.team.reactivateMembership(WS, m.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('listing and revoking', () => {
  it('a non-UUID id is not found, never a database error', async () => {
    const s = setup();
    await expect(s.team.deactivateMembership(WS, 'not-a-uuid')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(s.team.reactivateMembership(WS, 'not-a-uuid')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(s.team.revokeInvitation(WS, 'not-a-uuid')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('AC-20: lists members and pending invitations without a link; revoke removes it', async () => {
    const s = setup();
    s.addMember('ana', 'owner');
    s.addMember('ben', 'operator');
    s.addMember('cy', 'operator', 'deactivated');
    const issued = await s.team.inviteMember(WS, { email: 'new@x.test', role: 'operator' });

    const members = await s.team.listMemberships(WS, { limit: 50 });
    expect(members.items).toHaveLength(3);
    expect(members.items[2]).toMatchObject({
      displayName: 'cy',
      email: 'cy@x.test',
      role: 'operator',
      state: 'deactivated',
    });

    const pending = await s.team.listPendingInvitations(WS, { limit: 50 });
    expect(pending.items).toHaveLength(1);
    expect(pending.items[0]).toMatchObject({ email: 'new@x.test', role: 'operator' });
    expect(pending.items[0]).not.toHaveProperty('link');
    expect(pending.items[0]).not.toHaveProperty('tokenHash');

    await s.team.revokeInvitation(WS, issued.invitation.id);
    expect((await s.team.listPendingInvitations(WS, { limit: 50 })).items).toHaveLength(0);
    await expect(s.team.revokeInvitation(WS, issued.invitation.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('revoking an invitation of another workspace is not found', async () => {
    const s = setup();
    const issued = await s.team.inviteMember(OTHER_WS, { email: 'a@x.test', role: 'owner' });
    await expect(s.team.revokeInvitation(WS, issued.invitation.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
