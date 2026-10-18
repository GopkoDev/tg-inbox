import { z } from 'zod';
import { jobDb, type Jobs } from '../../../platform/jobs.js';
import type { EnqueueDrain } from '../../conversations/app/ports.js';

export const DELIVER_REPLIES_QUEUE = 'inbox.deliver-replies';
export const DELIVER_REPLIES_DLQ = 'inbox.deliver-replies-dlq';

/** `inbox.deliver-replies` payload (contracts/events.md). Ids only: no reply text, no token. */
export const DeliverRepliesJob = z.object({ workspace_id: z.uuid(), conversation_id: z.uuid() });
export type DeliverRepliesJob = z.infer<typeof DeliverRepliesJob>;

/**
 * Creates the delivery queue and its dead letter. `stately` + `singletonKey = conversation id`
 * keeps one drain running and one waiting per conversation (ADR-0004). The worker is T18's.
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
