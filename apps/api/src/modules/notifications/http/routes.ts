import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { IssuedConnectLink, NotificationSettings } from '@tg/shared';
import { createWorkspaceGuard, type WorkspaceGuardDeps } from '../../workspaces/http/guard.js';
import type { ConnectLinkIssuer } from '../app/connect-link.js';
import type { DisconnectTelegram } from '../app/disconnect.js';
import type { Settings } from '../app/settings.js';

export interface NotificationsDeps {
  settings: Settings;
  connectLinks: ConnectLinkIssuer;
  disconnect: DisconnectTelegram;
  /** The workspaces guard dependency (membership check on every request). */
  access: WorkspaceGuardDeps;
  /** The auth module's session resolver (preHandler setting `request.account`). */
  authenticate: preHandlerAsyncHookHandler;
}

/**
 * The member's own notification routes under `/workspaces/:workspaceId/notifications`
 * (openapi.yaml); the caller supplies the `/api` prefix. Both roles are allowed and no route takes
 * an account id: a member reads and removes only their own link. A malformed workspace id is
 * answered by the guard (404), so the params are not validated here.
 */
export async function registerNotifications(
  app: FastifyInstance,
  deps: NotificationsDeps,
): Promise<void> {
  const { settings, connectLinks, disconnect, access, authenticate } = deps;
  const pre = [authenticate, createWorkspaceGuard(access)];
  const r = app.withTypeProvider<ZodTypeProvider>();
  const base = '/workspaces/:workspaceId/notifications';
  const caller = (request: {
    account: { id: string };
    workspace: { workspaceId: string; role: 'owner' | 'operator' };
  }) => ({
    workspaceId: request.workspace.workspaceId,
    accountId: request.account.id,
    role: request.workspace.role,
  });

  r.get(
    base,
    { preHandler: pre, schema: { response: { 200: NotificationSettings } } },
    async (request) => settings.mySettings(caller(request)),
  );

  r.post(
    `${base}/telegram/connect-link`,
    { preHandler: pre, schema: { response: { 201: IssuedConnectLink } } },
    async (request, reply) => {
      const issued = await connectLinks.createConnectLink(caller(request));
      return reply.code(201).send(issued);
    },
  );

  r.post(
    `${base}/telegram/disconnect`,
    { preHandler: pre, schema: { response: { 200: NotificationSettings } } },
    async (request) => disconnect.disconnectTelegram(caller(request)),
  );
}
