import type { Transaction } from 'kysely';
import type { DB } from '../../../platform/db.types.gen.js';
import type { Clock } from '../../../platform/clock.js';
import {
  AccessRemovedError,
  NotFoundError,
  UnauthenticatedError,
} from '../../../platform/errors.js';
import type { Role } from '../domain/membership.js';
import type { PageQuery, UnitOfWork, WorkspaceRepos } from './ports.js';

/** The slice of the auth module's app layer this use case needs (passed in by the composition root). */
export interface AccessAuthPort {
  getAccount(id: string): Promise<{ id: string; email: string; displayName: string } | undefined>;
  getAccountsByIds(
    ids: readonly string[],
  ): Promise<{ id: string; email: string; displayName: string }[]>;
}

export interface WorkspaceAccessDeps {
  uow: UnitOfWork;
  clock: Clock;
  auth: AccessAuthPort;
}

export interface WorkspaceGrant {
  workspaceId: string;
  role: Role;
  activeSince: Date;
}

export interface MyWorkspace {
  id: string;
  name: string;
  role: Role;
}

export interface MyWorkspacesPage {
  items: MyWorkspace[];
  hasNext: boolean;
  hasPrev: boolean;
  nextCursor: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = 'Workspace not found';

export function createWorkspaceAccess(deps: WorkspaceAccessDeps) {
  const { uow, clock, auth } = deps;

  /** Reads the database on every call — a deactivation is effective on the next request (no cache). */
  async function guard(
    repos: WorkspaceRepos,
    accountId: string,
    workspaceId: string,
  ): Promise<WorkspaceGrant> {
    if (!UUID.test(workspaceId)) throw new NotFoundError(NOT_FOUND);
    const membership = await repos.memberships.findForGuard(accountId, workspaceId);
    if (!membership) throw new NotFoundError(NOT_FOUND);
    if (membership.state !== 'active') {
      throw new AccessRemovedError('Your access to this workspace was removed');
    }
    return { workspaceId, role: membership.role, activeSince: membership.activeSince };
  }

  return {
    guardWorkspace(accountId: string, workspaceId: string): Promise<WorkspaceGrant> {
      return uow.run((repos) => guard(repos, accountId, workspaceId));
    },

    /** The workspace's name; null when it does not exist. For texts the bot sends. */
    async workspaceName(workspaceId: string): Promise<string | null> {
      if (!UUID.test(workspaceId)) return null;
      const workspace = await uow.run((repos) => repos.workspaces.findById(workspaceId));
      return workspace?.name ?? null;
    },

    /** Of `accountIds`, those with an active membership in the workspace (socket re-validation, delivery pre-check). */
    activeMembersAmong(workspaceId: string, accountIds: readonly string[]): Promise<string[]> {
      return uow.run((repos) => repos.memberships.activeAccountIdsAmong(workspaceId, accountIds));
    },

    /**
     * Joins `tx`: `FOR SHARE` on the memberships of `accountIds` in this workspace, so a concurrent
     * deactivation waits (and an assignment waits for it); returns the active accounts among them.
     */
    lockActiveMembers(
      tx: Transaction<DB>,
      workspaceId: string,
      accountIds: readonly string[],
    ): Promise<string[]> {
      return uow.reposOn(tx).memberships.lockActiveAccountIds(workspaceId, accountIds);
    },

    /** Active members of the workspace for the assignee chooser, by display name then account id. */
    async activeMembers(
      workspaceId: string,
    ): Promise<{ accountId: string; displayName: string }[]> {
      const ids = await uow.run((repos) => repos.memberships.listActiveAccountIds(workspaceId));
      if (ids.length === 0) return [];
      const accounts = await auth.getAccountsByIds(ids);
      return accounts
        .map((a) => ({ accountId: a.id, displayName: a.displayName }))
        .sort(
          (x, y) =>
            (x.displayName < y.displayName ? -1 : x.displayName > y.displayName ? 1 : 0) ||
            (x.accountId < y.accountId ? -1 : x.accountId > y.accountId ? 1 : 0),
        );
    },

    /** Display names of `accountIds` that belong to the workspace; kept after a deactivation. */
    async displayNames(
      workspaceId: string,
      accountIds: readonly string[],
    ): Promise<Map<string, string>> {
      const members = await uow.run((repos) =>
        repos.memberships.accountIdsAmong(workspaceId, accountIds),
      );
      if (members.length === 0) return new Map();
      const accounts = await auth.getAccountsByIds(members);
      return new Map(accounts.map((a) => [a.id, a.displayName]));
    },

    async getMe(accountId: string) {
      const account = await auth.getAccount(accountId);
      if (!account) throw new UnauthenticatedError('Not signed in');
      const active = await uow.run((repos) => repos.memberships.listActiveOfAccount(accountId));
      let last: { id: string; at: number } | null = null;
      for (const m of active) {
        if (m.lastUsedAt && (!last || m.lastUsedAt.getTime() > last.at)) {
          last = { id: m.workspaceId, at: m.lastUsedAt.getTime() };
        }
      }
      return {
        account: { id: account.id, email: account.email, displayName: account.displayName },
        lastUsedWorkspaceId: last?.id ?? null,
      };
    },

    async listMyWorkspaces(
      accountId: string,
      page: Pick<PageQuery, 'after' | 'before' | 'limit'>,
    ): Promise<MyWorkspacesPage> {
      const active = await uow.run((repos) => repos.memberships.listActiveOfAccount(accountId));
      const all: MyWorkspace[] = active
        .map((m) => ({ id: m.workspaceId, name: m.workspaceName, role: m.role }))
        .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
      const { after, before, limit } = page;
      const afterIdx = after === undefined ? 0 : all.filter((i) => i.id <= after).length;
      const beforeIdx = before === undefined ? all.length : all.filter((i) => i.id < before).length;
      let start = afterIdx;
      let end = Math.min(beforeIdx, afterIdx + limit);
      if (before !== undefined && after === undefined) {
        end = beforeIdx;
        start = Math.max(0, beforeIdx - limit);
      }
      const items = all.slice(start, Math.max(start, end));
      const hasNext = end < all.length;
      return {
        items,
        hasNext,
        hasPrev: start > 0,
        nextCursor: hasNext && items.length > 0 ? items[items.length - 1]!.id : null,
      };
    },

    async enterWorkspace(accountId: string, workspaceId: string): Promise<MyWorkspace> {
      return uow.run(async (repos) => {
        const grant = await guard(repos, accountId, workspaceId);
        const workspace = await repos.workspaces.findById(workspaceId);
        if (!workspace) throw new NotFoundError(NOT_FOUND);
        await repos.memberships.touchLastUsed(workspaceId, accountId, clock.now());
        return { id: workspace.id, name: workspace.name, role: grant.role };
      });
    },
  };
}
