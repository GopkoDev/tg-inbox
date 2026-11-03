export const MIN_AHEAD_MS = 2 * 60_000;
export const MAX_AHEAD_MS = 90 * 86_400_000;
export const MISS_WINDOW_MS = 15 * 60_000;
export const CHAT_SPACING_MS = 3000;

export type RangeCheck = { ok: true } | { ok: false; reason: 'too_soon' | 'too_far' };

export function checkRange(instant: Date, now: Date): RangeCheck {
  const ahead = instant.getTime() - now.getTime();
  if (ahead < MIN_AHEAD_MS) return { ok: false, reason: 'too_soon' };
  if (ahead > MAX_AHEAD_MS) return { ok: false, reason: 'too_far' };
  return { ok: true };
}

/** Missed only when the send starts more than 15 minutes after the scheduled time. */
export function isMissed(scheduledFor: Date, now: Date): boolean {
  return now.getTime() - scheduledFor.getTime() > MISS_WINDOW_MS;
}

export function nextSendAt(last: Date): Date {
  return new Date(last.getTime() + CHAT_SPACING_MS);
}
