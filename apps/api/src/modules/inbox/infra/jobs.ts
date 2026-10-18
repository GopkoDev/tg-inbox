import { z } from 'zod';
import { jobDb, type Jobs } from '../../../platform/jobs.js';
import type { Clock } from '../../../platform/clock.js';
import type { DrainQueued, EnqueueDrain } from '../../conversations/app/ports.js';
import type { ReplyDelivery } from '../../conversations/app/replies.js';
import type { Deliver } from '../app/deliver.js';
import { SEND_TIMEOUT_MS } from '../domain/rules.js';

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

/** Whether a drain job of the conversation is queued, waiting to retry or running, on `tx`. */
export function createDrainQueued(boss: Jobs): DrainQueued {
  return async (tx, _workspaceId, conversationId) => {
    const jobs = await boss.findJobs(DELIVER_REPLIES_QUEUE, {
      key: conversationId,
      db: jobDb(tx),
    });
    return jobs.some((j) => j.state === 'created' || j.state === 'retry' || j.state === 'active');
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
 * twice. After 3 failed runs the dead-letter handler settles the conversation and raises an alert:
 * it resolves only stale in-flight attempts, and interrupts waiting replies only when no other drain
 * job of the conversation is queued or running. Logs carry ids only.
 */
export async function registerInboxJobs(
  boss: Jobs,
  deps: { deliver: Deliver; delivery: ReplyDelivery; logger: InboxJobsLogger; clock: Clock },
  options: InboxJobsOptions = {},
): Promise<void> {
  const { deliver, delivery, logger, clock } = deps;
  const drainQueued = createDrainQueued(boss);
  const enqueueDelayed = createEnqueueDelayed(boss);

  await boss.work(
    DELIVER_REPLIES_QUEUE,
    {
      pollingIntervalSeconds: options.pollingIntervalSeconds ?? 0.5,
      localConcurrency: options.localConcurrency ?? 2,
    },
    async (jobs) => {
      for (const job of jobs) {
        const { workspace_id, conversation_id } = DeliverRepliesJob.parse(job.data);
        // The signal aborts when the job expires or the worker stops: no attempt starts after it.
        await deliver.deliverConversation({
          workspaceId: workspace_id,
          conversationId: conversation_id,
          signal: job.signal,
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
        const result = await delivery.resolveDeadLetter(workspace_id, conversation_id, {
          staleBefore: new Date(clock.now().getTime() - SEND_TIMEOUT_MS),
          drainQueued,
        });
        if (result.inFlightSince) {
          // A young attempt may still reach Telegram: a later drain resolves it once it is stale.
          const remainingMs =
            result.inFlightSince.getTime() + SEND_TIMEOUT_MS - clock.now().getTime();
          await enqueueDelayed(
            workspace_id,
            conversation_id,
            Math.max(1, Math.ceil((remainingMs + 1) / 1000)),
          );
        }
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
