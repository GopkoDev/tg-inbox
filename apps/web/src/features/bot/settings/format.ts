const FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** A bot time in the viewer's locale and time zone: date + hours:minutes (screens.md SCR-02). */
export function formatBotTime(iso: string): string {
  return FORMAT.format(new Date(iso));
}
