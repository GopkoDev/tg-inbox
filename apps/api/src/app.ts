import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { registerHealth } from './modules/health/http/routes.js';
import type { Config } from './platform/config.js';
import { createDb } from './platform/db.js';
import { registerErrorHandler } from './platform/errors.js';
import { startJobs } from './platform/jobs.js';
import { loggerOptions } from './platform/logger.js';

/** Composition root: builds every dependency and registers every module plugin. */
export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions(config) });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  await app.register(websocket);

  const db = createDb(config.DATABASE_URL);
  const jobs = await startJobs(config.DATABASE_URL);
  app.addHook('onClose', async () => {
    await jobs.stop({ graceful: true });
    await db.destroy();
  });

  await registerHealth(app, { db });

  return app;
}
