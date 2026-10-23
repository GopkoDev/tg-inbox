const FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** A bot time in the viewer's locale and time zone: date + hours:minutes (screens.md SCR-02). */
export function formatBotTime(iso: string): string {
  return FORMAT.format(new Date(iso));
}

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

/** A clock time in the viewer's locale and time zone (e.g. «09:26»). */
export function formatBotClock(iso: string): string {
  return CLOCK.format(new Date(iso));
}

/** A day and month in the viewer's locale (e.g. «19 Oct»). */
export function formatBotDay(iso: string): string {
  return DAY.format(new Date(iso));
}
