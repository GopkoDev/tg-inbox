import { performance } from 'node:perf_hooks';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BotReconnect, BotSettings, BotTokenPaste } from '@tg/shared';
import {
  createWorkspaceGuard,
  ownerOnly,
  type WorkspaceGuardDeps,
} from '../../workspaces/http/guard.js';
import type { AcceptUpdate, AuthenticBot, CaptureLog } from '../app/accept-update.js';
import type { Disconnect } from '../app/disconnect.js';
import type { PasteToken } from '../app/paste-token.js';
import type { Reconnect } from '../app/reconnect.js';
import type { BotSettingsReader } from '../app/settings.js';

export interface BotsDeps {
  settings: BotSettingsReader;
  paste: PasteToken;
  reconnect: Reconnect;
  disconnect: Disconnect;
  /** The Telegram webhook ingress (flow 2). */
  webhook: Pick<AcceptUpdate, 'authenticate' | 'accept'>;
  /** The workspaces guard dependency (membership check on every request). */
  access: WorkspaceGuardDeps;
  /** The auth module's session resolver (preHandler setting `request.account`). */
  authenticate: preHandlerAsyncHookHandler;
}

const OWNER_ONLY_BOT = 'Only business owners manage the bot';
const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the webhook's secret check; only on `/telegram/webhook/:botId`. */
    telegramBot?: AuthenticBot;
    /** When the webhook request was received, for `ingest_ms`. */
    receivedAt?: number;
  }
}

/** The request logger with `ingest_ms` — receipt to now — on every line. */
function ingestLog(request: FastifyRequest): CaptureLog {
  return {
    info: (fields, msg) =>
      request.log.info(
        { ...fields, ingest_ms: Math.round(performance.now() - (request.receivedAt ?? 0)) },
        msg,
      ),
  };
}

/**
 * The owner-only bot routes under `/workspaces/:workspaceId/bot` (sad.md §8) and the public
 * Telegram webhook `/telegram/webhook/:botId`; the caller supplies the `/api` prefix. Owner
 * responses are the shared `BotSettings` — the use cases never return a token.
 */
export async function registerBots(app: FastifyInstance, deps: BotsDeps): Promise<void> {
  const { settings, paste, reconnect, disconnect, webhook, access, authenticate } = deps;
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

  // Telegram webhook (ADR-0002): outside the workspace prefix, no session. The secret is checked
  // on `onRequest`, before the body is parsed; a refusal is an empty 401 whatever its cause.
  r.post(
    '/telegram/webhook/:botId',
    {
      onRequest: async (request, reply) => {
        request.receivedAt = performance.now();
        const { botId } = request.params as { botId: string };
        const header = request.headers[SECRET_HEADER];
        const secret = typeof header === 'string' ? header : undefined;
        const bot = await webhook.authenticate(botId, secret, ingestLog(request));
        if (!bot) return reply.code(401).send();
        request.telegramBot = bot;
      },
    },
    async (request, reply) => {
      // Any body Telegram sends is accepted; the bots domain decides what it is (not validated here).
      await webhook.accept(request.telegramBot!, request.body, ingestLog(request));
      return reply.code(200).send();
    },
  );
}
