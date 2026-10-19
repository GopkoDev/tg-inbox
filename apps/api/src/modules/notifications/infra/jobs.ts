import { z } from 'zod';
import { jobDb, type Jobs } from '../../../platform/jobs.js';
import type { Clock } from '../../../platform/clock.js';
import type { DeliverAnswer } from '../app/deliver-answer.js';
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

/** The inverse of `toJobPayload`: the answer a validated payload stands for. */
export function fromJobPayload(job: SendBotMessageJob): BotMessage {
  if (job.kind === 'link_expired')
    return { kind: job.kind, telegramUserId: BigInt(job.telegram_user_id) };
  if (job.kind === 'cannot_connect') {
    return {
      kind: job.kind,
      telegramUserId: BigInt(job.telegram_user_id),
      reason: job.reason,
    };
  }
  return { kind: job.kind, telegramLinkId: job.telegram_link_id };
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

export interface NotificationJobsLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface NotificationJobsOptions {
  /** Idle poll of the answer worker; 0.5 s keeps "Connected" prompt (the minimum pg-boss allows). */
  pollingIntervalSeconds?: number;
}

export interface NotificationJobsDeps {
  deliverAnswer: DeliverAnswer;
  logger: NotificationJobsLogger;
  clock: Clock;
}

/**
 * Registers the workers of the notifications queues (the queues are created by
 * `createNotificationQueues`). Logs carry the workspace id, the kind and an outcome code only: never
 * the text, a display name, a token or a Telegram user id.
 */
export async function registerNotificationJobs(
  boss: Jobs,
  deps: NotificationJobsDeps,
  options: NotificationJobsOptions = {},
): Promise<void> {
  const { deliverAnswer, logger } = deps;
  const polling = { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 0.5 };

  await boss.work(SEND_BOT_MESSAGE_QUEUE, { ...polling, includeMetadata: true }, async (jobs) => {
    for (const job of jobs) {
      // An invalid payload throws: it fails visibly and the retries dead-letter it.
      const payload = SendBotMessageJob.parse(job.data);
      const message = fromJobPayload(payload);
      const lastAttempt = job.retryCount >= job.retryLimit;
      const delivered = await deliverAnswer.deliver(payload.workspace_id, message, { lastAttempt });
      logger.info(
        { workspaceId: payload.workspace_id, kind: payload.kind, outcome: delivered.result },
        'send-bot-message job',
      );
      if (delivered.result === 'retry_at') {
        // Telegram's limit is a delayed job of its own, never a pg-boss retry (it would use them up).
        await boss.send(SEND_BOT_MESSAGE_QUEUE, payload, { startAfter: delivered.at });
      } else if (delivered.result === 'failed') {
        throw new Error('the answer was not accepted');
      }
    }
  });

  // A dead-lettered answer is not retried, but a removed link's Telegram id must still go.
  await boss.work(SEND_BOT_MESSAGE_DLQ, polling, async (jobs) => {
    for (const job of jobs) {
      const parsed = SendBotMessageJob.safeParse(job.data);
      if (!parsed.success) continue;
      await deliverAnswer.clearOnDeadLetter(parsed.data.workspace_id, fromJobPayload(parsed.data));
      logger.error(
        {
          alert: 'notifications.send-bot-message.dead-letter',
          workspaceId: parsed.data.workspace_id,
          kind: parsed.data.kind,
        },
        'an answer to a member gave up',
      );
    }
  });
}
