export const LOCKOUT_THRESHOLD = 10;
export const LOCKOUT_WINDOW_MS = 15 * 60_000;

export type LockoutState = { locked: false } | { locked: true; until: Date };

/**
 * 10 failures within 15 minutes lock the email for 15 minutes counted from the 10th failure.
 * `failureTimes` are the recorded failures since the last success / reset, in any order.
 */
export function lockoutState(failureTimes: readonly Date[], now: Date): LockoutState {
  const times = failureTimes.map((d) => d.getTime()).sort((a, b) => a - b);
  let lockEnd: number | undefined;
  for (let i = LOCKOUT_THRESHOLD - 1; i < times.length; i++) {
    const first = times[i - (LOCKOUT_THRESHOLD - 1)]!;
    if (times[i]! - first <= LOCKOUT_WINDOW_MS) lockEnd = times[i]! + LOCKOUT_WINDOW_MS;
  }
  if (lockEnd !== undefined && now.getTime() < lockEnd) {
    return { locked: true, until: new Date(lockEnd) };
  }
  return { locked: false };
}
