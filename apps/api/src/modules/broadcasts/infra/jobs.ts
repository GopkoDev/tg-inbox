import { z } from 'zod';
import type { Clock } from '../../../platform/clock.js';
import { jobDb, type Jobs } from '../../../platform/jobs.js';
import type { MeasureBlockedShare } from '../app/blocked-share.js';
import type { BroadcastJobs } from '../app/ports.js';
import type { SendLink } from '../app/send-link.js';

export const SEND_LINK_QUEUE = 'broadcasts.send';
export const SEND_LINK_DLQ = 'broadcasts.send-dlq';
export const MEASURE_BLOCKED_SHARE_QUEUE = 'broadcasts.measure-blocked-share';

/**
 * A link sends for at most 20 s and one send waits at most 10 s for Telegram, so a link never gets
 * near this; a timed-out predecessor cannot still be sending when its successor starts (ADR-0007).
 */
export const SEND_LINK_EXPIRE_SECONDS = 60;
export const SEND_LINK_RETRY_LIMIT = 3;
/** Links of different workspaces one instance runs at once (sad.md §7). */
export const SEND_LINK_CONCURRENCY = 16;
/** The dead-letter handler restarts the workspace's chain this much later. */
export const DEAD_LETTER_RESTART_MS = 60_000;
export const MEASURE_RETRY_LIMIT = 2;

/** `broadcasts.send` payload (contracts/events.md): the workspace id only. */
export const SendLinkJob = z.strictObject({ workspace_id: z.uuid() });
export type SendLinkJob = z.infer<typeof SendLinkJob>;

/** `broadcasts.measure-blocked-share` payload: ids only. */
export const MeasureBlockedShareJob = z.strictObject({
  workspace_id: z.uuid(),
  broadcast_id: z.uuid(),
});
export type MeasureBlockedShareJob = z.infer<typeof MeasureBlockedShareJob>;

/**
 * Creates the three queues. `broadcasts.send` is `stately` with `singletonKey` = workspace id: one
 * link active per workspace across instances and one successor waiting beside it (ADR-0007); a
 * link that throws is retried 3 times with back-off, then dead-lettered. The measure queue is
 * `exclusive` per broadcast id: two endings of one broadcast keep one measure.
 */
export async function createBroadcastQueues(boss: Jobs): Promise<void> {
  await boss.createQueue(SEND_LINK_DLQ);
  await boss.createQueue(SEND_LINK_QUEUE, {
    policy: 'stately',
    retryLimit: SEND_LINK_RETRY_LIMIT,
    retryBackoff: true,
    retryDelay: 1,
    expireInSeconds: SEND_LINK_EXPIRE_SECONDS,
    deadLetter: SEND_LINK_DLQ,
  });
  await boss.createQueue(MEASURE_BLOCKED_SHARE_QUEUE, {
    policy: 'exclusive',
    retryLimit: MEASURE_RETRY_LIMIT,
  });
}

/** Queues a link outside any transaction (the dead-letter restart). */
async function sendLink(boss: Jobs, workspaceId: string, startAfter?: Date) {
  const payload: SendLinkJob = { workspace_id: workspaceId };
  await boss.send(SEND_LINK_QUEUE, payload, {
    singletonKey: workspaceId,
    ...(startAfter && { startAfter }),
  });
}

/**
 * The `BroadcastJobs` port over pg-boss. The queue starts after `buildDeps()`, so the enqueuers are
 * late-bound; each job is sent on the caller's transaction (committed or rolled back with the rows
 * beside it) and they fail loudly before `bind`. A singleton key already taken absorbs the job.
 */
export function createBroadcastJobs(): BroadcastJobs & { bind(boss: Jobs): void } {
  let boss: Jobs | undefined;
  const started = () => {
    if (!boss) throw new Error('the job queue is not started');
    return boss;
  };
  return {
    bind(instance) {
      boss = instance;
    },
    async enqueueSendLink(tx, workspaceId, startAfter) {
      const payload: SendLinkJob = { workspace_id: workspaceId };
      await started().send(SEND_LINK_QUEUE, payload, {
        singletonKey: workspaceId,
        db: jobDb(tx),
        ...(startAfter && { startAfter }),
      });
    },
    async enqueueBlockedShare(tx, workspaceId, broadcastId, startAfter) {
      const payload: MeasureBlockedShareJob = {
        workspace_id: workspaceId,
        broadcast_id: broadcastId,
      };
      await started().send(MEASURE_BLOCKED_SHARE_QUEUE, payload, {
        singletonKey: broadcastId,
        startAfter,
        db: jobDb(tx),
      });
    },
  };
}

export interface BroadcastJobsLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface BroadcastJobsDeps {
  sendLink: Pick<SendLink, 'runSendLink'>;
  measure: Pick<MeasureBlockedShare, 'measureBlockedShare'>;
  logger: BroadcastJobsLogger;
  clock: Clock;
}

export interface BroadcastJobsOptions {
  /**
   * Idle poll of the workers (0.5 s is the minimum pg-boss allows). Defaults: 1 s for the send
   * worker, whose 16 local workers each poll, and 0.5 s for the dead letter and the measure.
   */
  pollingIntervalSeconds?: number;
}

/**
 * Registers the workers of the broadcasts queues (created by `createBroadcastQueues`). A link that
 * throws fails its job (pg-boss retries it; the retry resolves the stranded in-flight send as not
 * confirmed). Logs carry ids only: never the text, a name, a username or a chat id.
 */
export async function registerBroadcastJobs(
  boss: Jobs,
  deps: BroadcastJobsDeps,
  options: BroadcastJobsOptions = {},
): Promise<void> {
  const { sendLink: link, measure, logger, clock } = deps;
  const pollingIntervalSeconds = options.pollingIntervalSeconds ?? 0.5;

  await boss.work(
    SEND_LINK_QUEUE,
    {
      pollingIntervalSeconds: options.pollingIntervalSeconds ?? 1,
      localConcurrency: SEND_LINK_CONCURRENCY,
    },
    async (jobs) => {
      for (const job of jobs) {
        const { workspace_id } = SendLinkJob.parse(job.data);
        await link.runSendLink(workspace_id);
      }
    },
  );

  // After the retries: alert, and restart the chain so the waiting recipients are not forgotten.
  await boss.work(SEND_LINK_DLQ, { pollingIntervalSeconds }, async (jobs) => {
    for (const job of jobs) {
      const parsed = SendLinkJob.safeParse(job.data);
      if (!parsed.success) continue;
      const workspaceId = parsed.data.workspace_id;
      logger.error(
        { alert: 'broadcasts.send.dead-letter', workspace_id: workspaceId },
        'a broadcasts sending link gave up',
      );
      await sendLink(boss, workspaceId, new Date(clock.now().getTime() + DEAD_LETTER_RESTART_MS));
    }
  });

  await boss.work(MEASURE_BLOCKED_SHARE_QUEUE, { pollingIntervalSeconds }, async (jobs) => {
    for (const job of jobs) {
      const { workspace_id, broadcast_id } = MeasureBlockedShareJob.parse(job.data);
      await measure.measureBlockedShare(workspace_id, broadcast_id);
    }
  });
}
