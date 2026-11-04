import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { systemClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { startJobs, type Jobs } from '../../../platform/jobs.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import {
  createPostJobs,
  createPostQueues,
  POST_SEND_DLQ,
  POST_SEND_QUEUE,
  registerPostJobs,
} from './jobs.js';

interface JobRow {
  state: string;
  data: Record<string, unknown>;
  singleton_key: string | null;
  retry_limit: number;
  start_after: Date;
}

const jobsOf = async (db: Db, name: string, postId: string) =>
  (
    await sql<JobRow>`
      select state, data, singleton_key, retry_limit, start_after from pgboss.job
      where name = ${name} and data->>'post_id' = ${postId} order by created_on`.execute(db)
  ).rows;

describe('posts queues on pg-boss (stand-in sender)', () => {
  let database: TestDatabase;
  let db: Db;
  let boss: Jobs;
  const jobs = createPostJobs();
  const sent: Record<string, unknown>[] = [];
  const settled: Record<string, unknown>[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    boss = await startJobs(database.url);
    await createPostQueues(boss);
    await registerPostJobs(
      boss,
      {
        sender: {
          async send(job) {
            sent.push(job);
          },
        },
        deadLetter: {
          async settle(job) {
            settled.push(job);
          },
        },
        logger: { info() {}, error() {} },
        clock: systemClock,
      },
      { pollingIntervalSeconds: 0.5 },
    );
    jobs.bind(boss);
  }, 120_000);

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await db?.destroy();
    await database?.stop();
  });

  it('fails loudly before the queue is bound', async () => {
    const unbound = createPostJobs();
    await expect(
      db
        .transaction()
        .execute((tx) =>
          unbound.enqueueSend(
            tx,
            { postId: newId(), workspaceId: newId(), moment: new Date().toISOString() },
            new Date(),
          ),
        ),
    ).rejects.toThrow('the job queue is not started');
  });

  it('a queued send runs with ids only, standard policy, no singleton key, retry 2', async () => {
    const postId = newId();
    const workspaceId = newId();
    const moment = new Date().toISOString();
    await db
      .transaction()
      .execute((tx) => jobs.enqueueSend(tx, { postId, workspaceId, moment }, new Date()));

    await vi.waitFor(() => expect(sent).toEqual([{ postId, workspaceId, moment }]), {
      timeout: 15_000,
    });
    const [row] = await jobsOf(db, POST_SEND_QUEUE, postId);
    expect(row!.data).toEqual({ post_id: postId, workspace_id: workspaceId, moment });
    expect(row!.singleton_key).toBeNull();
    expect(row!.retry_limit).toBe(2);
  });

  it('a job in the dead letter queue is settled', async () => {
    const postId = newId();
    const workspaceId = newId();
    const moment = new Date().toISOString();
    await boss.send(POST_SEND_DLQ, { post_id: postId, workspace_id: workspaceId, moment });
    await vi.waitFor(() => expect(settled).toEqual([{ postId, workspaceId, moment }]), {
      timeout: 15_000,
    });
  });
});
