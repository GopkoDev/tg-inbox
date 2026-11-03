import { z } from 'zod';
import type { Clock } from '../../../platform/clock.js';
import { jobDb, type Jobs } from '../../../platform/jobs.js';
import type { PostSendJobs } from '../app/publish.js';

export const POST_SEND_QUEUE = 'posts.send';
export const POST_SEND_DLQ = 'posts.send-dlq';

/** A send waits at most 10 s for Telegram; a timed-out predecessor is never still sending. */
export const POST_SEND_EXPIRE_SECONDS = 60;
export const POST_SEND_RETRY_LIMIT = 2;
/** Posts of different workspaces one instance sends at once. */
export const POST_SEND_CONCURRENCY = 8;

/** `posts.send` payload (contracts/events.md): ids and the scheduled moment only, never the text. */
export const PostSendPayload = z.strictObject({
  post_id: z.uuid(),
  workspace_id: z.uuid(),
  moment: z.string(),
});
export type PostSendPayload = z.infer<typeof PostSendPayload>;

const toJob = (p: PostSendPayload): PostJobIds => ({
  postId: p.post_id,
  workspaceId: p.workspace_id,
  moment: p.moment,
});

/**
 * Creates the queue and its dead letter. `posts.send` is `standard` (no singleton key: the claim
 * under the row lock makes a duplicate harmless); a throwing job is retried twice with back-off,
 * then dead-lettered (`retryLimit: 0`).
 */
export async function createPostQueues(boss: Jobs): Promise<void> {
  await boss.createQueue(POST_SEND_DLQ, { retryLimit: 0 });
  await boss.createQueue(POST_SEND_QUEUE, {
    policy: 'standard',
    retryLimit: POST_SEND_RETRY_LIMIT,
    retryBackoff: true,
    retryDelay: 1,
    expireInSeconds: POST_SEND_EXPIRE_SECONDS,
    deadLetter: POST_SEND_DLQ,
  });
}

/**
 * The `PostSendJobs` port over pg-boss. The queue starts after `buildDeps()`, so it is late-bound;
 * the job is sent on the caller's transaction and fails loudly before `bind`.
 */
export function createPostJobs(): PostSendJobs & { bind(boss: Jobs): void } {
  let boss: Jobs | undefined;
  return {
    bind(instance) {
      boss = instance;
    },
    async enqueueSend(tx, payload, startAfter) {
      if (!boss) throw new Error('the job queue is not started');
      const data: PostSendPayload = {
        post_id: payload.postId,
        workspace_id: payload.workspaceId,
        moment: payload.moment,
      };
      await boss.send(POST_SEND_QUEUE, data, { startAfter, db: jobDb(tx) });
    },
  };
}

export interface PostJobsLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** A type alias (not an interface) so a hook may take a plain record. */
export type PostJobIds = { postId: string; workspaceId: string; moment: string };

export interface PostJobsDeps {
  sender: { send(job: PostJobIds): Promise<unknown> };
  deadLetter: { settle(job: PostJobIds): Promise<unknown> };
  logger: PostJobsLogger;
  clock: Clock;
}

export interface PostJobsOptions {
  pollingIntervalSeconds?: number;
}

/**
 * Registers the workers of the posts queues. A send that throws fails its job (pg-boss retries it;
 * the retry settles a claim without an outcome as not confirmed). Logs carry ids only.
 */
export async function registerPostJobs(
  boss: Jobs,
  deps: PostJobsDeps,
  options: PostJobsOptions = {},
): Promise<void> {
  const { sender, deadLetter, logger } = deps;
  const pollingIntervalSeconds = options.pollingIntervalSeconds ?? 1;

  await boss.work(
    POST_SEND_QUEUE,
    { pollingIntervalSeconds, localConcurrency: POST_SEND_CONCURRENCY },
    async (jobs) => {
      for (const job of jobs) await sender.send(toJob(PostSendPayload.parse(job.data)));
    },
  );

  await boss.work(POST_SEND_DLQ, { pollingIntervalSeconds }, async (jobs) => {
    for (const job of jobs) {
      const parsed = PostSendPayload.safeParse(job.data);
      if (!parsed.success) continue;
      logger.error(
        {
          alert: 'posts.send.dead-letter',
          post_id: parsed.data.post_id,
          workspace_id: parsed.data.workspace_id,
        },
        'a posts send gave up',
      );
      await deadLetter.settle(toJob(parsed.data));
    }
  });
}
