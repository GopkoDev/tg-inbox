import type { Clock } from '../../../platform/clock.js';
import {
  AlreadyAMemberError as AlreadyAMemberConflict,
  LastActiveOwnerError as LastActiveOwnerConflict,
  NotFoundError,
} from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import { issueLinkToken } from '../../../platform/tokens.js';
import { AlreadyAMemberError, LastActiveOwnerError } from '../domain/errors.js';
import { INVITATION_TTL } from '../domain/invitation.js';
import { deactivate, reactivate, type Role } from '../domain/membership.js';
import { assertKeepsActiveOwner, assertNotAMember } from '../domain/team-rules.js';
import type {
  InvitationRecord,
  MembershipRecord,
  PageQuery,
  UnitOfWork,
  WorkspaceRepos,
} from './ports.js';

/** The slice of the auth module's app layer this module needs (wired by the composition root). */
export interface TeamAccounts {
  findAccountIdByEmail(email: string): Promise<string | undefined>;
  getAccountsByIds(
    ids: readonly string[],
  ): Promise<{ id: string; email: string; displayName: string }[]>;
}

export interface TeamDeps {
  uow: UnitOfWork;
  clock: Clock;
  accounts: TeamAccounts;
  /** PUBLIC_WEB_URL from config, injected by the composition root. */
  publicWebUrl: string;
}

export interface PendingInvitationView {
  id: string;
  email: string;
  role: Role;
  createdAt: Date;
  expiresAt: Date;
}

export interface IssuedInvitationView {
  invitation: PendingInvitationView;
  /** Shown once to the owner; only its hash is stored. */
  link: string;
}

export interface MemberView {
  id: string;
  displayName: string;
  email: string;
  role: Role;
  state: MembershipRecord['state'];
  createdAt: Date;
  deactivatedAt: Date | null;
}

export interface Paged<T> {
  items: T[];
  hasNext: boolean;
  hasPrev: boolean;
  nextCursor: string | null;
}

function toPending(i: Omit<InvitationRecord, 'workspaceId'>): PendingInvitationView {
  return { id: i.id, email: i.email, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt };
}

/** Fetches one extra row to learn whether more exist in the paging direction. */
async function paged<T, R extends { id: string }>(
  page: PageQuery,
  fetch: (q: PageQuery) => Promise<T[]>,
  map: (rows: T[]) => Promise<R[]> | R[],
): Promise<Paged<R>> {
  const rows = await fetch({ ...page, limit: page.limit + 1 });
  const backward = page.before !== undefined;
  const extra = rows.length > page.limit;
  const kept = extra ? (backward ? rows.slice(1) : rows.slice(0, page.limit)) : rows;
  const items = await map(kept);
  const hasNext = backward ? true : extra;
  const hasPrev = backward ? extra : page.after !== undefined;
  const last = items.at(-1);
  return { items, hasNext, hasPrev, nextCursor: hasNext && last ? last.id : null };
}

export function createTeam(deps: TeamDeps) {
  const { uow, clock, accounts } = deps;
  const base = deps.publicWebUrl.replace(/\/+$/, '');

  async function lockedMembership(
    repos: WorkspaceRepos,
    workspaceId: string,
    membershipId: string,
  ): Promise<MembershipRecord> {
    if (!(await repos.workspaces.lockForUpdate(workspaceId))) {
      throw new NotFoundError('Workspace not found');
    }
    const m = await repos.memberships.findById(workspaceId, membershipId);
    if (!m) throw new NotFoundError('Member not found');
    return m;
  }

  async function memberViews(rows: MembershipRecord[]): Promise<MemberView[]> {
    if (rows.length === 0) return [];
    const found = await accounts.getAccountsByIds([...new Set(rows.map((r) => r.accountId))]);
    const byId = new Map(found.map((a) => [a.id, a]));
    return rows.map((r) => {
      const a = byId.get(r.accountId);
      return {
        id: r.id,
        displayName: a?.displayName ?? '',
        email: a?.email ?? '',
        role: r.role,
        state: r.state,
        createdAt: r.createdAt,
        deactivatedAt: r.deactivatedAt,
      };
    });
  }

  async function reload(
    repos: WorkspaceRepos,
    workspaceId: string,
    fallback: MembershipRecord,
  ): Promise<MemberView> {
    const fresh = (await repos.memberships.findById(workspaceId, fallback.id)) ?? fallback;
    return (await memberViews([fresh]))[0]!;
  }

  /** Under the workspace lock: the other active owners, as the domain rule sees them. */
  async function assertAnotherActiveOwner(
    repos: WorkspaceRepos,
    workspaceId: string,
    m: MembershipRecord,
  ): Promise<void> {
    const others = Math.max(0, (await repos.memberships.countActiveOwners(workspaceId)) - 1);
    const team = [
      { id: m.id, role: m.role, state: m.state },
      ...Array.from({ length: others }, (_, n) => ({
        id: `other-${n}`,
        role: 'owner' as const,
        state: 'active' as const,
      })),
    ];
    try {
      assertKeepsActiveOwner(team, m.id);
    } catch (e) {
      if (e instanceof LastActiveOwnerError) throw new LastActiveOwnerConflict(e.message);
      throw e;
    }
  }

  return {
    /** `email` is normalised here (trim + lower-case); format validation is the route's job. */
    async inviteMember(
      workspaceId: string,
      input: { email: string; role: Role },
    ): Promise<IssuedInvitationView> {
      const email = input.email.trim().toLowerCase();
      return uow.run(async (repos) => {
        if (!(await repos.workspaces.lockForUpdate(workspaceId))) {
          throw new NotFoundError('Workspace not found');
        }
        const accountId = await accounts.findAccountIdByEmail(email);
        if (accountId) {
          const existing = await repos.memberships.findByAccount(workspaceId, accountId);
          try {
            assertNotAMember(existing);
          } catch (e) {
            if (e instanceof AlreadyAMemberError) {
              throw new AlreadyAMemberConflict(e.message, {
                membership_id: e.membershipId,
                state: e.state,
              });
            }
            throw e;
          }
        }
        const now = clock.now();
        await repos.invitations.supersedePending(workspaceId, email, now);
        const { token, hash } = issueLinkToken();
        const record: Omit<InvitationRecord, 'workspaceId'> = {
          id: newId(),
          email,
          role: input.role,
          tokenHash: hash,
          state: 'pending',
          expiresAt: new Date(now.getTime() + INVITATION_TTL),
          createdAt: now,
          closedAt: null,
        };
        await repos.invitations.insert(workspaceId, record);
        return { invitation: toPending(record), link: `${base}/invite/${token}` };
      });
    },

    async revokeInvitation(workspaceId: string, invitationId: string): Promise<void> {
      await uow.run(async (repos) => {
        if (!(await repos.invitations.revoke(workspaceId, invitationId, clock.now()))) {
          throw new NotFoundError('Invitation not found');
        }
      });
    },

    listMemberships(workspaceId: string, page: PageQuery): Promise<Paged<MemberView>> {
      return uow.run((repos) =>
        paged(page, (q) => repos.memberships.list(workspaceId, q), memberViews),
      );
    },

    listPendingInvitations(
      workspaceId: string,
      page: PageQuery,
    ): Promise<Paged<PendingInvitationView>> {
      return uow.run((repos) =>
        paged(
          page,
          (q) => repos.invitations.listPending(workspaceId, clock.now(), q),
          (rows) => rows.map(toPending),
        ),
      );
    },

    async deactivateMembership(workspaceId: string, membershipId: string): Promise<MemberView> {
      return uow.run(async (repos) => {
        const m = await lockedMembership(repos, workspaceId, membershipId);
        if (m.state === 'active') {
          if (m.role === 'owner') await assertAnotherActiveOwner(repos, workspaceId, m);
          const next = deactivate(m, clock.now());
          await repos.memberships.setState(workspaceId, m.id, next.state, next.deactivatedAt);
        }
        return reload(repos, workspaceId, m);
      });
    },

    async reactivateMembership(workspaceId: string, membershipId: string): Promise<MemberView> {
      return uow.run(async (repos) => {
        const m = await lockedMembership(repos, workspaceId, membershipId);
        if (m.state === 'deactivated') {
          const next = reactivate(m);
          await repos.memberships.setState(workspaceId, m.id, next.state, next.deactivatedAt);
        }
        return reload(repos, workspaceId, m);
      });
    },
  };
}

export type Team = ReturnType<typeof createTeam>;
