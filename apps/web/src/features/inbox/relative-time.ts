const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** «How long ago» for a list row: now, 5m, 3h, Yest., then a short date. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const diff = now.getTime() - at.getTime();
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  const days = Math.round((startOfDay(now) - startOfDay(at)) / (24 * HOUR));
  if (days <= 0) return `${Math.floor(diff / HOUR)}h`;
  if (days === 1) return 'Yest.';
  return at.toLocaleDateString('en', { day: 'numeric', month: 'short' });
}
