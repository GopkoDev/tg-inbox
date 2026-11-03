export const DAILY_SENT_LIMIT = 30;
export const SCHEDULED_WAITING_LIMIT = 100;
export const DESTINATION_LIMIT = 20;
const DAY_MS = 24 * 3_600_000;

function counted(sentTimes: readonly Date[], now: Date): Date[] {
  const from = now.getTime() - DAY_MS;
  return sentTimes.filter((t) => t.getTime() > from).sort((a, b) => a.getTime() - b.getTime());
}

export function dailyLimitReached(sentTimes: readonly Date[], now: Date): boolean {
  return counted(sentTimes, now).length >= DAILY_SENT_LIMIT;
}

export function scheduledLimitReached(waiting: number): boolean {
  return waiting >= SCHEDULED_WAITING_LIMIT;
}

/** When posting is possible again: the send that makes the count drop below the limit leaves the window. */
export function freesAt(sentTimes: readonly Date[], now: Date): Date | null {
  const c = counted(sentTimes, now);
  if (c.length < DAILY_SENT_LIMIT) return null;
  const oldest = c[c.length - DAILY_SENT_LIMIT]!;
  return new Date(oldest.getTime() + DAY_MS);
}
