import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './db.types.gen.js';

export type Db = Kysely<DB>;

/** The one shared Kysely instance — created by the composition root, destroyed on app close. */
export function createDb(
  connectionString: string,
  pool: { max?: number; connectionTimeoutMillis?: number } = {},
): Db {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({
        connectionString,
        max: pool.max ?? 10,
        // A request waits at most this long for a connection, then fails instead of hanging.
        connectionTimeoutMillis: pool.connectionTimeoutMillis ?? 5000,
      }),
    }),
  });
}
