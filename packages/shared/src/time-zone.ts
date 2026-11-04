export type LocalToInstant = { ok: true; instant: Date } | { ok: false; error: 'does_not_exist' };

const DAY_MS = 24 * 60 * 60 * 1000;

export function isValidTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function parts(instant: Date, zone: string, extra: Intl.DateTimeFormatOptions = {}) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...extra,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) out[p.type] = p.value;
  return out;
}

/** Local wall time `YYYY-MM-DDTHH:mm` of an instant in a zone (for prefilling). */
export function instantToLocal(instant: Date, zone: string): string {
  const p = parts(instant, zone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * Local wall time in a zone to an instant. A time skipped by a daylight-saving
 * change does not exist; a repeated one resolves to its first occurrence.
 */
export function localToInstant(local: string, zone: string): LocalToInstant {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return { ok: false, error: 'does_not_exist' };
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  const offsetAt = (t: number) => {
    const d = new Date(t);
    const l = instantToLocal(d, zone);
    const lm = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(l)!;
    return (
      Date.UTC(+lm[1]!, +lm[2]! - 1, +lm[3]!, +lm[4]!, +lm[5]!) - Math.floor(t / 60000) * 60000
    );
  };
  const offsets = new Set([offsetAt(wall - DAY_MS), offsetAt(wall + DAY_MS)]);
  const matches = [...offsets]
    .map((o) => wall - o)
    .filter((t) => instantToLocal(new Date(t), zone) === local)
    .sort((a, b) => a - b);
  const first = matches[0];
  return first === undefined
    ? { ok: false, error: 'does_not_exist' }
    : { ok: true, instant: new Date(first) };
}

/** `Wed 4 Nov, 09:00 (Europe/Kyiv)` — always names the zone. */
export function formatInZone(instant: Date, zone: string): string {
  const p = parts(instant, zone, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute} (${zone})`;
}
