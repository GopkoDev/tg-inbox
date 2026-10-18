import { CompiledQuery, type Kysely } from 'kysely';
import type { DB } from './db.types.gen.js';
import { PgBoss, type ConstructorOptions } from 'pg-boss';

export type Jobs = PgBoss;

/** The executor pg-boss accepts as `db` (it does not export the type by name). */
type JobExecutor = NonNullable<ConstructorOptions['db']>;

export interface JobsLogger {
  error(obj: object, msg: string): void;
}

/**
 * pg-boss on the main database (its own `pgboss` schema, managed by pg-boss, not our migrations).
 * Queues are named `<module>.<job>`; workers are registered from the composition root.
 *
 * pg-boss emits `error` for failures of its own pollers and timers (a database blip); without a
 * listener Node throws it and the process dies mid-send. It is logged by code and queue only: the
 * message can carry the connection string.
 */
export async function startJobs(connectionString: string, logger?: JobsLogger): Promise<Jobs> {
  const boss = new PgBoss(connectionString);
  boss.on('error', (err: unknown) => {
    const { code, queue } = (err ?? {}) as { code?: unknown; queue?: unknown };
    logger?.error(
      {
        code: typeof code === 'string' ? code : undefined,
        queue: typeof queue === 'string' ? queue : undefined,
      },
      'job queue error',
    );
  });
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
