import { z } from 'zod';
import type { Jobs } from '../../../platform/jobs.js';
import type { HealthCheck } from '../app/health-check.js';

export const SCHEDULE_HEALTH_CHECKS_QUEUE = 'bots.schedule-health-checks';
export const CHECK_HEALTH_QUEUE = 'bots.check-health';

/** `bots.check-health` payload (contracts/events.md). No token, no secret; unknown fields ignored. */
export const BotHealthCheckJob = z.object({ bot_id: z.uuid(), workspace_id: z.uuid() });
export type BotHealthCheckJob = z.infer<typeof BotHealthCheckJob>;

/** Covers two Bot API calls of at most 10 s each (sad.md §8 freshness budget). */
const CHECK_EXPIRE_SECONDS = 30;

export interface BotJobsOptions {
  /** Worker idle poll; pg-boss's default unless set (tests lower it). */
  pollingIntervalSeconds?: number;
  /** Called after each cron tick with the number of checks enqueued — the "tick ran" signal. */
  onTick?: (enqueued: number) => void;
}

/**
 * Registers the two health-check queues and their workers (ADR-0008). The cron tick enqueues one
 * check per due bot; the `exclusive` policy with `singletonKey = bot_id` keeps it to one queued or
 * active check per bot, so overlapping ticks run one check. Neither queue retries: a failed check
 * leaves the bot due, and the next tick (≤ 1 min) re-enqueues it.
 */
export async function registerBotJobs(
  boss: Jobs,
  healthCheck: HealthCheck,
  options: BotJobsOptions = {},
): Promise<{ enqueueDueChecks: () => Promise<number> }> {
  const work = options.pollingIntervalSeconds
    ? { pollingIntervalSeconds: options.pollingIntervalSeconds }
    : {};

  await boss.createQueue(SCHEDULE_HEALTH_CHECKS_QUEUE, { retryLimit: 0 });
  await boss.createQueue(CHECK_HEALTH_QUEUE, { policy: 'exclusive', retryLimit: 0 });

  async function enqueueDueChecks(): Promise<number> {
    const due = await healthCheck.scheduleChecks();
    let sent = 0;
    for (const { botId, workspaceId } of due) {
      const payload: BotHealthCheckJob = { bot_id: botId, workspace_id: workspaceId };
      const id = await boss.send(CHECK_HEALTH_QUEUE, payload, {
        singletonKey: botId,
        expireInSeconds: CHECK_EXPIRE_SECONDS,
        retryLimit: 0,
      });
      if (id !== null) sent += 1;
    }
    return sent;
  }

  await boss.work(SCHEDULE_HEALTH_CHECKS_QUEUE, work, async () => {
    options.onTick?.(await enqueueDueChecks());
  });

  await boss.work(CHECK_HEALTH_QUEUE, work, async (jobs) => {
    for (const job of jobs) {
      // An invalid payload throws: the job fails visibly and, with no retry, is not run again.
      const { bot_id, workspace_id } = BotHealthCheckJob.parse(job.data);
      await healthCheck.checkOne(workspace_id, bot_id);
    }
  });

  await boss.schedule(SCHEDULE_HEALTH_CHECKS_QUEUE, '* * * * *');

  return { enqueueDueChecks };
}
