import { resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { Migrator } from 'kysely/migration';
import { TSFileMigrationProvider } from 'kysely-ctl';
import pg from 'pg';
import type { Config } from '../platform/config.js';

const MIGRATION_FOLDER = resolve(import.meta.dirname, '../../migrations');

export interface TestDatabase {
  url: string;
  stop(): Promise<void>;
}

/** Ephemeral Postgres 16 with every migration applied — one per integration suite. */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:16-alpine',
  ).start();
  const url = container.getConnectionUri();
  await migrateToLatest(url);
  return {
    url,
    stop: async () => {
      await waitForClientsToDisconnect(url);
      await container.stop();
    },
  };
}

/**
 * `pool.end()` resolves before its sockets are closed, so a container stop right after it can
 * terminate backends that are still ending (FATAL 57P01, surfacing as an uncaught error). Wait
 * until no other client backend is left before stopping.
 */
async function waitForClientsToDisconnect(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    for (let i = 0; i < 100; i++) {
      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity
          where backend_type = 'client backend' and pid <> pg_backend_pid()`,
      );
      if (rows[0]?.n === 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    await client.end();
  }
}

async function migrateToLatest(connectionString: string): Promise<void> {
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  });
  try {
    const migrator = new Migrator({
      db,
      provider: new TSFileMigrationProvider({ migrationFolder: MIGRATION_FOLDER }),
    });
    const { error } = await migrator.migrateToLatest();
    if (error) throw error;
  } finally {
    await db.destroy();
  }
}

export function testConfig(databaseUrl: string): Config {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: 0,
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    PUBLIC_WEB_URL: 'http://localhost:5173',
  };
}
