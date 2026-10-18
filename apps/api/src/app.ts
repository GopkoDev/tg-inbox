import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DestinationStream } from 'pino';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { registerAuth } from './modules/auth/http/routes.js';
import { registerBots } from './modules/bots/http/routes.js';
import { registerBotJobs, SCHEDULE_HEALTH_CHECKS_QUEUE } from './modules/bots/infra/jobs.js';
import { createDeliver } from './modules/inbox/app/deliver.js';
import { createSendReply } from './modules/inbox/app/send-reply.js';
import {
  createEnqueueDelayed,
  createEnqueueDrain,
  createInboxQueues,
  registerInboxJobs,
} from './modules/inbox/infra/jobs.js';
import { createLiveHub } from './modules/inbox/infra/hub.js';
import { registerInbox } from './modules/inbox/http/routes.js';
import { registerWorkspaces } from './modules/workspaces/http/routes.js';
import { registerHealth } from './modules/health/http/routes.js';
import type { Config } from './platform/config.js';
import { requireJsonBodies } from './platform/content-type.js';
import { frameworkErrors, registerErrorHandler } from './platform/errors.js';
import { startJobs } from './platform/jobs.js';
import { startRealtimeListener } from './platform/realtime.js';
import { loggerOptions } from './platform/logger.js';
import { buildDeps } from './deps.js';

/** Largest client frame the live socket accepts; bigger frames close it with 1009. */
const LIVE_MAX_INBOUND_BYTES = 1024;
import type { Clock } from './platform/clock.js';

/** Composition root: builds every dependency and registers every module plugin. */
export async function buildApp(
  config: Config,
  overrides: { clock?: Clock; logStream?: DestinationStream } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions(config, overrides.logStream), frameworkErrors });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app, {
    // Same-origin SPA: any non-/api GET that accepts HTML gets index.html (client-side routes).
    spaFallback: async (request, reply) => {
      const path = request.url.split('?')[0] ?? '';
      const isApi = path === '/api' || path.startsWith('/api/');
      if (!config.WEB_DIST_DIR || request.method !== 'GET' || isApi) return false;
      if (!request.headers.accept?.includes('text/html')) return false;
      await reply.sendFile('index.html');
      return true;
    },
  });
  requireJsonBodies(app);
  // Set once the hub exists, below. The plugin's own preClose would close every socket with no code
  // (1005); the hub closes them with 1001 first (events.md).
  let closeLiveSockets = async (): Promise<void> => {};
  await app.register(websocket, {
    // The live channel is server to client: a client frame is never read, so keep it tiny.
    options: { maxPayload: LIVE_MAX_INBOUND_BYTES },
    preClose: async () => {
      await closeLiveSockets();
      for (const client of app.websocketServer.clients) client.close(1001, 'server going away');
      // Stops new upgrades; like the plugin's default, it does not wait for the closing handshakes.
      app.websocketServer.close();
    },
  });
  await app.register(cookie);
  if (config.WEB_DIST_DIR) {
    // wildcard:false registers the files that exist; everything else reaches the not-found handler.
    await app.register(fastifyStatic, { root: config.WEB_DIST_DIR, wildcard: false });
  }

  const deps = buildDeps(config, overrides);
  const {
    db,
    credentialUseCases,
    sessionUseCases,
    resetLinkUseCases,
    authenticate,
    workspaceAccess,
    acceptInvitation,
    team,
    optionalAccount,
    bots,
    inboxReads,
    conversationReplies,
    replyDelivery,
  } = deps;
  const jobs = await startJobs(config.DATABASE_URL, app.log);
  // Live sockets: the hub fans realtime signals out to the open inbox tabs (ADR-0002, ADR-0003).
  const liveHub = createLiveHub({
    sessions: sessionUseCases,
    members: workspaceAccess,
    logger: app.log,
  });
  const realtime = await startRealtimeListener(config.DATABASE_URL, app.log);
  realtime.onSignal((signal) => liveHub.dispatch(signal));
  realtime.onGap(() => liveHub.resync());
  liveHub.start();
  closeLiveSockets = () => liveHub.stop();
  app.addHook('onClose', async () => {
    await realtime.stop();
    await liveHub.stop();
    await jobs.stop({ graceful: true });
    await deps.destroy();
  });
  // pg-boss workers are registered here, in the composition root (ADR-0001).
  await registerBotJobs(jobs, bots.healthCheck, {
    onTick: (enqueued) =>
      app.log.info({ queue: SCHEDULE_HEALTH_CHECKS_QUEUE, enqueued }, 'bot health-check tick'),
  });

  await createInboxQueues(jobs);
  await registerInboxJobs(jobs, {
    deliver: createDeliver({
      delivery: replyDelivery,
      workspaces: workspaceAccess,
      bots: { canCarryReplies: bots.inboxStatus.canCarryReplies, sendText: bots.sendText },
      enqueueDelayed: createEnqueueDelayed(jobs),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      clock: deps.clock,
    }),
    delivery: replyDelivery,
    logger: app.log,
    clock: deps.clock,
  });
  const inboxReplies = createSendReply({
    replies: conversationReplies,
    bots: bots.inboxStatus,
    workspaces: workspaceAccess,
    enqueueDrain: createEnqueueDrain(jobs),
    clock: deps.clock,
  });

  await registerHealth(app, { db });
  await app.register(
    async (api) =>
      registerAuth(api, {
        credentialUseCases,
        sessionUseCases,
        resetLinkUseCases,
        cookie: { secure: config.NODE_ENV !== 'development' },
      }),
    { prefix: '/api' },
  );
  await app.register(
    async (api) =>
      registerWorkspaces(api, {
        access: workspaceAccess,
        team,
        authenticate,
        invitationRoutes: {
          invitations: acceptInvitation,
          sessionUseCases,
          optionalAccount,
          cookie: { secure: config.NODE_ENV !== 'development' },
        },
      }),
    { prefix: '/api' },
  );
  await app.register(
    async (api) =>
      registerBots(api, {
        settings: bots.settings,
        paste: bots.paste,
        reconnect: bots.reconnect,
        disconnect: bots.disconnect,
        webhook: bots.acceptUpdate,
        access: workspaceAccess,
        authenticate,
      }),
    { prefix: '/api' },
  );
  await app.register(
    async (api) =>
      registerInbox(api, {
        reads: inboxReads,
        replies: inboxReplies,
        media: deps.inboxMedia,
        live: liveHub,
        webOrigin: new URL(config.PUBLIC_WEB_URL).origin,
        access: workspaceAccess,
        authenticate,
      }),
    { prefix: '/api' },
  );

  return app;
}
