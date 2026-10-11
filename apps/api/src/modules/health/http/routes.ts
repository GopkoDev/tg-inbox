import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { HealthResponse } from '@tg/shared';
import type { Db } from '../../../platform/db.js';

export interface HealthDeps {
  db: Db;
}

export async function registerHealth(app: FastifyInstance, deps: HealthDeps): Promise<void> {
  app
    .withTypeProvider<ZodTypeProvider>()
    .get('/health', { schema: { response: { 200: HealthResponse } } }, async () => {
      await sql`select 1`.execute(deps.db);
      return { status: 'ok', db: 'up' } as const;
    });
}
