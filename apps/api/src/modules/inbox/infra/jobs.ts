import { z } from 'zod';
import { jobDb, type Jobs } from '../../../platform/jobs.js';
import type { EnqueueDrain } from '../../conversations/app/ports.js';
import type { ReplyDelivery } from '../../conversations/app/replies.js';
import type { Deliver } from '../app/deliver.js';

export const DELIVER_REPLIES_QUEUE = 'inbox.deliver-replies';
export const DELIVER_REPLIES_DLQ = 'inbox.deliver-replies-dlq';

/** `inbox.deliver-replies` payload (contracts/events.md). Ids only: no reply text, no token. */
export const DeliverRepliesJob = z.object({ workspace_id: z.uuid(), conversation_id: z.uuid() });
export type DeliverRepliesJob = z.infer<typeof DeliverRepliesJob>;

/**
 * Creates the delivery queue and its dead letter. `stately` + `singletonKey = conversation id`
 * keeps one drain running and one waiting per conversation (ADR-0004).
 */
export async function createInboxQueues(boss: Jobs): Promise<void> {
  await boss.createQueue(DELIVER_REPLIES_DLQ);
  await boss.createQueue(DELIVER_REPLIES_QUEUE, {
    policy: 'stately',
    retryLimit: 3,
    expireInSeconds: 60,
    deadLetter: DELIVER_REPLIES_DLQ,
  });
}

/** Sends the drain job through the caller's transaction, so a committed reply always has a job. */
export function createEnqueueDrain(boss: Jobs): EnqueueDrain {
  return async (tx, workspaceId, conversationId) => {
    const payload: DeliverRepliesJob = {
      workspace_id: workspaceId,
      conversation_id: conversationId,
    };
    await boss.send(DELIVER_REPLIES_QUEUE, payload, {
      singletonKey: conversationId,
      db: jobDb(tx),
    });
  };
}

/** A Telegram back-off is a new delayed job, never a pg-boss retry (events.md). */
export function createEnqueueDelayed(boss: Jobs) {
  return async (workspaceId: string, conversationId: string, startAfterSeconds: number) => {
    const payload: DeliverRepliesJob = {
      workspace_id: workspaceId,
      conversation_id: conversationId,
    };
    await boss.send(DELIVER_REPLIES_QUEUE, payload, {
      singletonKey: conversationId,
      startAfter: startAfterSeconds,
    });
  };
}

export interface InboxJobsOptions {
  /** Idle poll; 0.5 s is the reply-latency target (sad.md §11). */
  pollingIntervalSeconds?: number;
  /** Local concurrency of the drain worker (sad.md §7). */
  localConcurrency?: number;
}

export interface InboxJobsLogger {
  error(obj: object, msg: string): void;
}

/**
 * Registers the drain worker and the dead-letter handler. A drain that throws is re-run by pg-boss
 * (crash semantics only); the re-run first resolves any stale in-flight attempt, so nothing is sent
 * twice. After 3 failed runs the dead-letter handler settles the conversation and raises an alert.
 * Logs carry ids only.
 */
export async function registerInboxJobs(
  boss: Jobs,
  deps: { deliver: Deliver; delivery: ReplyDelivery; logger: InboxJobsLogger },
  options: InboxJobsOptions = {},
): Promise<void> {
  const { deliver, delivery, logger } = deps;

  await boss.work(
    DELIVER_REPLIES_QUEUE,
    {
      pollingIntervalSeconds: options.pollingIntervalSeconds ?? 0.5,
      localConcurrency: options.localConcurrency ?? 2,
    },
    async (jobs) => {
      for (const job of jobs) {
        const { workspace_id, conversation_id } = DeliverRepliesJob.parse(job.data);
        await deliver.deliverConversation({
          workspaceId: workspace_id,
          conversationId: conversation_id,
        });
      }
    },
  );

  await boss.work(
    DELIVER_REPLIES_DLQ,
    { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 0.5 },
    async (jobs) => {
      for (const job of jobs) {
        const { workspace_id, conversation_id } = DeliverRepliesJob.parse(job.data);
        const result = await delivery.resolveDeadLetter(workspace_id, conversation_id);
        logger.error(
          {
            alert: 'inbox.deliver-replies.dead-letter',
            workspaceId: workspace_id,
            conversationId: conversation_id,
            notConfirmed: result.notConfirmed.length,
            interrupted: result.interrupted.length,
          },
          'reply delivery gave up on a conversation',
        );
      }
    },
  );
}
