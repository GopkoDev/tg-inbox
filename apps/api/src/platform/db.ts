import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './db.types.gen.js';

export type Db = Kysely<DB>;

/** The one shared Kysely instance — created by the composition root, destroyed on app close. */
export function createDb(connectionString: string): Db {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  });
}
