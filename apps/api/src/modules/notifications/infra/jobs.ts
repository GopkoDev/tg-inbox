import { z } from 'zod';
import { jobDb, type Jobs } from '../../../platform/jobs.js';
import type { Clock } from '../../../platform/clock.js';
import { SWEEP_EVERY_MS } from '../domain/constants.js';
import type { SendPings } from '../app/send-pings.js';
import type { DeliverAnswer } from '../app/deliver-answer.js';
import type { BotMessage, EnqueueBotMessage, Executor } from '../app/ports.js';

export const SEND_BOT_MESSAGE_QUEUE = 'notifications.send-bot-message';
export const SEND_BOT_MESSAGE_DLQ = 'notifications.send-bot-message-dlq';
export const SEND_PINGS_QUEUE = 'notifications.send-pings';
export const SCHEDULE_PINGS_QUEUE = 'notifications.schedule-pings';

/** `notifications.send-pings` payload: the workspace whose sweep this is (ids only). */
export const SendPingsJob = z.strictObject({ workspace_id: z.uuid() });
export type SendPingsJob = z.infer<typeof SendPingsJob>;

/** A sweep that never returns is failed after this long; the cron then restarts the chain. */
const SEND_PINGS_EXPIRE_SECONDS = 60;

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

/**
 * Creates the queues. The answer queue has a dead letter (a worker clears a removed link's id).
 * `send-pings` is `stately` with `singletonKey = workspace id`: one sweep running per workspace
 * across instances, and one next link waiting beside it. (`exclusive`, as events.md names it, would
 * refuse the chain's own next link while the current sweep is still active.) No retry: a failed run
 * is replaced by the next chain link or by the cron.
 */
export async function createNotificationQueues(boss: Jobs): Promise<void> {
  await boss.createQueue(SCHEDULE_PINGS_QUEUE, { retryLimit: 0 });
  await boss.createQueue(SEND_PINGS_QUEUE, {
    policy: 'stately',
    retryLimit: 0,
    expireInSeconds: SEND_PINGS_EXPIRE_SECONDS,
  });
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
  sendPings: Pick<SendPings, 'runSweep'>;
  workspacesWithLiveLink(): Promise<string[]>;
  startPings: StartPings;
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
  const { deliverAnswer, logger, clock } = deps;
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

  const handleSendPings = createSendPingsHandler({
    sweep: deps.sendPings,
    chain: (workspaceId, startAfter) => deps.startPings(workspaceId, { startAfter }),
    logger,
    clock,
  });
  await boss.work(
    SEND_PINGS_QUEUE,
    { ...polling, pollingIntervalSeconds: 1, localConcurrency: 4 },
    async (jobs) => {
      // A failing workspace must not hold back the others in the batch: settle each, then rethrow.
      const failures: unknown[] = [];
      for (const job of jobs) {
        try {
          await handleSendPings(job.data);
        } catch (err) {
          failures.push(err);
        }
      }
      if (failures.length > 0) throw failures[0];
    },
  );

  const handleSchedule = createSchedulePingsHandler({
    workspacesWithLiveLink: deps.workspacesWithLiveLink,
    start: (workspaceId) => deps.startPings(workspaceId),
    logger,
  });
  await boss.work(SCHEDULE_PINGS_QUEUE, polling, async () => {
    await handleSchedule();
  });
  await boss.schedule(SCHEDULE_PINGS_QUEUE, '* * * * *');
}

/**
 * Starts (or keeps) a workspace's `send-pings` chain. The singleton key absorbs the job when a link
 * of the chain is already waiting. `tx` puts the job on the caller's transaction (a new link starts
 * its chain with the commit); without it the job is sent on its own, optionally later.
 */
export type StartPings = (
  workspaceId: string,
  options?: { tx?: Executor; startAfter?: Date },
) => Promise<boolean>;

export function createPingStarter(): { start: StartPings; bind(boss: Jobs): void } {
  let boss: Jobs | undefined;
  return {
    bind(instance) {
      boss = instance;
    },
    async start(workspaceId, options = {}) {
      if (!boss) throw new Error('the job queue is not started');
      const payload: SendPingsJob = { workspace_id: workspaceId };
      const id = await boss.send(SEND_PINGS_QUEUE, payload, {
        singletonKey: workspaceId,
        ...(options.startAfter && { startAfter: options.startAfter }),
        ...(options.tx && { db: jobDb(options.tx) }),
      });
      return id !== null;
    },
  };
}

export interface SendPingsHandlerDeps {
  sweep: Pick<SendPings, 'runSweep'>;
  /** Enqueues the next link of the chain at `at`. */
  chain(workspaceId: string, at: Date): Promise<unknown>;
  logger: { error(obj: object, msg: string): void };
  clock: Clock;
}

/**
 * One `send-pings` job: sweep, then enqueue the next link. A failed sweep still enqueues the next
 * link in 20 s before the job fails, so the chain does not die on one error (the cron is the
 * backstop for a crash). The error is logged by code only: its message can carry a connection string.
 */
export function createSendPingsHandler(deps: SendPingsHandlerDeps) {
  const { sweep, chain, logger, clock } = deps;
  return async (data: unknown): Promise<void> => {
    const { workspace_id: workspaceId } = SendPingsJob.parse(data);
    let result: { nextRunAt: Date | null };
    try {
      result = await sweep.runSweep(workspaceId);
    } catch (err) {
      const { code } = (err ?? {}) as { code?: unknown };
      logger.error(
        {
          alert: 'notifications.send-pings.failed',
          workspaceId,
          code: typeof code === 'string' ? code : undefined,
        },
        'a ping sweep failed',
      );
      await chain(workspaceId, new Date(clock.now().getTime() + SWEEP_EVERY_MS));
      throw err;
    }
    if (result.nextRunAt) await chain(workspaceId, result.nextRunAt);
  };
}

export interface SchedulePingsHandlerDeps {
  /** The sixth controlled tenancy exception: workspace ids only (sad.md §8, ADR-0005). */
  workspacesWithLiveLink(): Promise<string[]>;
  start: (workspaceId: string) => Promise<boolean>;
  logger: { info(obj: object, msg: string): void };
}

/** The minute cron: restarts the chain of every workspace with a live link; live chains absorb it. */
export function createSchedulePingsHandler(deps: SchedulePingsHandlerDeps) {
  return async (): Promise<void> => {
    const workspaces = await deps.workspacesWithLiveLink();
    let started = 0;
    for (const workspaceId of workspaces) {
      if (await deps.start(workspaceId)) started += 1;
    }
    deps.logger.info({ workspaces: workspaces.length, started }, 'ping schedule tick');
  };
}
