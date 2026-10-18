import type { preHandlerAsyncHookHandler } from 'fastify';
import { OwnerOnlyError } from '../../../platform/errors.js';
import type { WorkspaceGrant } from '../app/access.js';
import type { Role } from '../domain/membership.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the workspace guard on `/api/workspaces/:workspaceId/…` routes. */
    workspace: { workspaceId: string; role: Role };
  }
}

export interface WorkspaceGuardDeps {
  guardWorkspace(accountId: string, workspaceId: string): Promise<WorkspaceGrant>;
}

/**
 * preHandler for every route under `/api/workspaces/:workspaceId/…`; runs after the session
 * resolver. Checks membership on every request (no cache) and attaches `request.workspace`.
 */
export function createWorkspaceGuard({
  guardWorkspace,
}: WorkspaceGuardDeps): preHandlerAsyncHookHandler {
  return async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const grant = await guardWorkspace(request.account.id, workspaceId);
    request.workspace = { workspaceId: grant.workspaceId, role: grant.role };
  };
}

/**
 * preHandler that follows the guard on owner-only routes; `message` names the route family
 * ("Only business owners manage the team" / "… manage the bot").
 */
export function ownerOnly(message: string): preHandlerAsyncHookHandler {
  return async (request) => {
    if (request.workspace.role !== 'owner') {
      throw new OwnerOnlyError(message);
    }
  };
}
