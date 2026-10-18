import { CompiledQuery, type Kysely } from 'kysely';
import type { DB } from './db.types.gen.js';
import { PgBoss, type ConstructorOptions } from 'pg-boss';

export type Jobs = PgBoss;

/** The executor pg-boss accepts as `db` (it does not export the type by name). */
type JobExecutor = NonNullable<ConstructorOptions['db']>;

/**
 * pg-boss on the main database (its own `pgboss` schema, managed by pg-boss, not our migrations).
 * Queues are named `<module>.<job>`; workers are registered from the composition root.
 */
export async function startJobs(connectionString: string): Promise<Jobs> {
  const boss = new PgBoss(connectionString);
  await boss.start();
  return boss;
}

/**
 * Lets pg-boss run its statements on a Kysely transaction (`boss.send(name, data, { db })`), so a job
 * is committed or rolled back together with the rows written beside it (ADR-0004).
 */
export function jobDb(executor: Pick<Kysely<DB>, 'executeQuery'>): JobExecutor {
  return {
    async executeSql(text, values = []) {
      const result = await executor.executeQuery(CompiledQuery.raw(text, values));
      return { rows: [...result.rows] };
    },
  };
}
