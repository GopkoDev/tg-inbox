import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BotReconnect, BotSettings, BotTokenPaste } from '@tg/shared';
import {
  createWorkspaceGuard,
  ownerOnly,
  type WorkspaceGuardDeps,
} from '../../workspaces/http/guard.js';
import type { Disconnect } from '../app/disconnect.js';
import type { PasteToken } from '../app/paste-token.js';
import type { Reconnect } from '../app/reconnect.js';
import type { BotSettingsReader } from '../app/settings.js';

export interface BotsDeps {
  settings: BotSettingsReader;
  paste: PasteToken;
  reconnect: Reconnect;
  disconnect: Disconnect;
  /** The workspaces guard dependency (membership check on every request). */
  access: WorkspaceGuardDeps;
  /** The auth module's session resolver (preHandler setting `request.account`). */
  authenticate: preHandlerAsyncHookHandler;
}

const OWNER_ONLY_BOT = 'Only business owners manage the bot';

/**
 * The owner-only bot routes under `/workspaces/:workspaceId/bot` (sad.md §8); the caller supplies
 * the `/api` prefix. Responses are the shared `BotSettings` — the use cases never return a token.
 */
export async function registerBots(app: FastifyInstance, deps: BotsDeps): Promise<void> {
  const { settings, paste, reconnect, disconnect, access, authenticate } = deps;
  const pre = [authenticate, createWorkspaceGuard(access), ownerOnly(OWNER_ONLY_BOT)];
  const r = app.withTypeProvider<ZodTypeProvider>();
  const path = '/workspaces/:workspaceId/bot';
  const response = { 200: BotSettings };

  r.get(path, { preHandler: pre, schema: { response } }, async (request) =>
    settings.getSettings(request.workspace.workspaceId),
  );

  r.post(
    `${path}/token`,
    { preHandler: pre, schema: { body: BotTokenPaste, response } },
    async (request) =>
      paste.pasteToken(
        request.workspace.workspaceId,
        request.body.token,
        request.body.confirm_takeover,
      ),
  );

  r.post(
    `${path}/reconnect`,
    { preHandler: pre, schema: { body: BotReconnect, response } },
    async (request) =>
      reconnect.reconnect(request.workspace.workspaceId, request.body.confirm_takeover),
  );

  r.post(`${path}/disconnect`, { preHandler: pre, schema: { response } }, async (request) =>
    disconnect.disconnect(request.workspace.workspaceId),
  );
}
