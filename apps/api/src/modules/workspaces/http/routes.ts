import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PageQuery } from '@tg/shared';
import type { createWorkspaceAccess } from '../app/access.js';
import { createWorkspaceGuard } from './guard.js';
import { registerInvitationRoutes, type InvitationRoutesDeps } from './invitation-routes.js';

type WorkspaceAccess = ReturnType<typeof createWorkspaceAccess>;

export interface WorkspacesDeps {
  access: Pick<WorkspaceAccess, 'guardWorkspace' | 'getMe' | 'listMyWorkspaces' | 'enterWorkspace'>;
  /** The auth module's session resolver (preHandler setting `request.account`). */
  authenticate: preHandlerAsyncHookHandler;
  /** Public invitation lookup / acceptance. */
  invitationRoutes: InvitationRoutesDeps;
}

/** Registers the workspace-access routes; the caller supplies the `/api` prefix. */
export async function registerWorkspaces(
  app: FastifyInstance,
  deps: WorkspacesDeps,
): Promise<void> {
  const { access, authenticate, invitationRoutes } = deps;
  const guard = createWorkspaceGuard(access);
  const r = app.withTypeProvider<ZodTypeProvider>();

  await registerInvitationRoutes(app, invitationRoutes);

  r.get('/me', { preHandler: authenticate }, async (request) => {
    const me = await access.getMe(request.account.id);
    return {
      account: {
        id: me.account.id,
        email: me.account.email,
        display_name: me.account.displayName,
      },
      last_used_workspace_id: me.lastUsedWorkspaceId,
    };
  });

  r.get(
    '/me/workspaces',
    { preHandler: authenticate, schema: { querystring: PageQuery } },
    async (request) => {
      const { after, before, limit } = request.query;
      const page = await access.listMyWorkspaces(request.account.id, { after, before, limit });
      return {
        items: page.items,
        has_next: page.hasNext,
        has_prev: page.hasPrev,
        next_cursor: page.nextCursor,
      };
    },
  );

  r.post('/workspaces/:workspaceId/enter', { preHandler: [authenticate, guard] }, async (request) =>
    access.enterWorkspace(request.account.id, request.workspace.workspaceId),
  );
}
