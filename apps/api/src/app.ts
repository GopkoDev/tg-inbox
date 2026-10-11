import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { registerAuth } from './modules/auth/http/routes.js';
import { registerWorkspaces } from './modules/workspaces/http/routes.js';
import { registerHealth } from './modules/health/http/routes.js';
import type { Config } from './platform/config.js';
import { requireJsonBodies } from './platform/content-type.js';
import { registerErrorHandler } from './platform/errors.js';
import { startJobs } from './platform/jobs.js';
import { loggerOptions } from './platform/logger.js';
import { buildDeps } from './deps.js';
import type { Clock } from './platform/clock.js';

/** Composition root: builds every dependency and registers every module plugin. */
export async function buildApp(
  config: Config,
  overrides: { clock?: Clock } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions(config) });
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
  await app.register(websocket);
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
    accountUseCases,
  } = deps;
  const jobs = await startJobs(config.DATABASE_URL);
  app.addHook('onClose', async () => {
    await jobs.stop({ graceful: true });
    await deps.destroy();
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
          accountUseCases,
          cookie: { secure: config.NODE_ENV !== 'development' },
        },
      }),
    { prefix: '/api' },
  );

  return app;
}
