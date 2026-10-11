import { PgBoss } from 'pg-boss';

export type Jobs = PgBoss;

/**
 * pg-boss on the main database (its own `pgboss` schema, managed by pg-boss, not our migrations).
 * Queues are named `<module>.<job>`; workers are registered from the composition root.
 */
export async function startJobs(connectionString: string): Promise<Jobs> {
  const boss = new PgBoss(connectionString);
  await boss.start();
  return boss;
}
