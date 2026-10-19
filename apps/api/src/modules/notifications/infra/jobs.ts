import { z } from 'zod';
import { jobDb, type Jobs } from '../../../platform/jobs.js';
import type { BotMessage, EnqueueBotMessage } from '../app/ports.js';

export const SEND_BOT_MESSAGE_QUEUE = 'notifications.send-bot-message';
export const SEND_BOT_MESSAGE_DLQ = 'notifications.send-bot-message-dlq';

const id = z.uuid();
const userId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const reason = z.enum(['telegram_linked_to_teammate', 'member_linked_elsewhere']);

/**
 * `notifications.send-bot-message` payload (contracts/events.md): ids, kinds and the Telegram user id
 * of the two answers that have no link - never a name, text, token or hash. Exactly one recipient
 * per kind; `reason` only for `cannot_connect`.
 */
export const SendBotMessageJob = z.discriminatedUnion('kind', [
  z.strictObject({
    workspace_id: id,
    kind: z.enum([
      'connected',
      'already_connected',
      'notifications_off',
      'chat_only_notifications',
    ]),
    telegram_link_id: id,
  }),
  z.strictObject({ workspace_id: id, kind: z.literal('link_expired'), telegram_user_id: userId }),
  z.strictObject({
    workspace_id: id,
    kind: z.literal('cannot_connect'),
    telegram_user_id: userId,
    reason,
  }),
]);
export type SendBotMessageJob = z.infer<typeof SendBotMessageJob>;

export function toJobPayload(workspaceId: string, message: BotMessage): SendBotMessageJob {
  if (message.kind === 'link_expired') {
    return {
      workspace_id: workspaceId,
      kind: message.kind,
      telegram_user_id: String(message.telegramUserId),
    };
  }
  if (message.kind === 'cannot_connect') {
    return {
      workspace_id: workspaceId,
      kind: message.kind,
      telegram_user_id: String(message.telegramUserId),
      reason: message.reason,
    };
  }
  return {
    workspace_id: workspaceId,
    kind: message.kind,
    telegram_link_id: message.telegramLinkId,
  };
}

/** Creates the answer queue and its dead letter (no handler: the panel state is already right). */
export async function createNotificationQueues(boss: Jobs): Promise<void> {
  await boss.createQueue(SEND_BOT_MESSAGE_DLQ);
  await boss.createQueue(SEND_BOT_MESSAGE_QUEUE, {
    retryLimit: 2,
    retryBackoff: true,
    expireInSeconds: 30,
    deadLetter: SEND_BOT_MESSAGE_DLQ,
  });
}

/**
 * The pg-boss instance is started by the composition root after `buildDeps()`, so the use cases get
 * this late-bound sender; it puts the job on the caller's transaction (committed or rolled back with
 * the rows beside it, ADR-0004) and fails loudly if used before `bind`.
 */
export function createBotMessageSender(): { enqueue: EnqueueBotMessage; bind(boss: Jobs): void } {
  let boss: Jobs | undefined;
  return {
    bind(instance) {
      boss = instance;
    },
    async enqueue(tx, workspaceId, message) {
      if (!boss) throw new Error('the job queue is not started');
      await boss.send(SEND_BOT_MESSAGE_QUEUE, toJobPayload(workspaceId, message), {
        db: jobDb(tx),
      });
    },
  };
}
