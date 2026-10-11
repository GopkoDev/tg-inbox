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
}

export interface WorkspaceAccessDeps {
  uow: UnitOfWork;
  clock: Clock;
  auth: AccessAuthPort;
}

export interface WorkspaceGrant {
  workspaceId: string;
  role: Role;
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
    return { workspaceId, role: membership.role };
  }

  return {
    guardWorkspace(accountId: string, workspaceId: string): Promise<WorkspaceGrant> {
      return uow.run((repos) => guard(repos, accountId, workspaceId));
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
