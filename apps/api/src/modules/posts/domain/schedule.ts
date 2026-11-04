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

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** The zone's offset from UTC (ms, positive east) at an instant. */
export function zoneOffsetMs(zone: string, instantMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instantMs));
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return wall - Math.floor(instantMs / 1000) * 1000;
}

export type LocalTimeResult =
  { ok: true; instant: Date } | { ok: false; reason: 'malformed' | 'does_not_exist' };

/**
 * A wall-clock time ("YYYY-MM-DDTHH:mm") in a zone as an instant. A time the zone skips does not
 * exist; a repeated time is read as its first occurrence.
 */
export function localTimeToInstant(local: string, zone: string): LocalTimeResult {
  const m = LOCAL_TIME.exec(local);
  if (!m) return { ok: false, reason: 'malformed' };
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h
  ) {
    return { ok: false, reason: 'malformed' };
  }
  const DAY = 86_400_000;
  const offsets = new Set([zoneOffsetMs(zone, wall - DAY), zoneOffsetMs(zone, wall + DAY)]);
  const instants = [...offsets]
    .map((off) => wall - off)
    .filter((t) => zoneOffsetMs(zone, t) === wall - t)
    .sort((a, b) => a - b);
  if (instants.length === 0) return { ok: false, reason: 'does_not_exist' };
  return { ok: true, instant: new Date(instants[0]!) };
}
