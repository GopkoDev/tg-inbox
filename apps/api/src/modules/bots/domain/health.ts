/**
 * A bot is due for a Telegram check 3 minutes after the last one. With the 1-minute cron tick, two
 * Bot API calls of at most 10 s and queue pickup, the shown state is never older than 5 minutes
 * (AC-15, sad.md §8 Freshness budget). The threshold is a domain rule, not configuration.
 */
export const DUE_AFTER_MS = 3 * 60_000;

export function isDueForCheck(lastCheckedAt: Date, now: Date): boolean {
  return now.getTime() - lastCheckedAt.getTime() >= DUE_AFTER_MS;
}
