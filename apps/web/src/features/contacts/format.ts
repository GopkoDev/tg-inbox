import { formatBotClock, formatBotDay, formatBotTime } from '@/features/bot/settings/format';
import { relativeTime } from '@/features/inbox/relative-time';

/** First and last name, a missing last name simply left out. */
export const contactFullName = (c: { first_name: string; last_name: string | null }) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ');

let names: Intl.DisplayNames | null | undefined;

/** The language's English name («Ukrainian»), the code itself when it cannot be named, «Unknown» for none. */
export function languageName(code: string | null): string {
  if (!code) return 'Unknown';
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(['en'], { type: 'language' });
    } catch {
      names = null;
    }
  }
  try {
    return names?.of(code) || code;
  } catch {
    return code;
  }
}

/** «19 Oct», or «Never» when the contact has not written (missing values are words, not blanks). */
export const firstWroteText = (iso: string | null) => (iso ? formatBotDay(iso) : 'Never');

/** «3m» / «Yest.» / «19 Oct» for a list row, the full date-time for its title, «Never» for none. */
export function lastWrote(iso: string | null, now: Date = new Date()) {
  return iso
    ? { text: relativeTime(iso, now), title: formatBotTime(iso) }
    : { text: 'Never', title: undefined };
}

const FULL_DAY = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** «2 Sep 2026» for the profile's facts line. */
export const formatFullDay = (iso: string) => FULL_DAY.format(new Date(iso));

/** «19 Oct, 10:02»: a history line's time, in the viewer's locale and time zone. */
export const formatHistoryTime = (iso: string) => `${formatBotDay(iso)}, ${formatBotClock(iso)}`;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** «just now» / «3 min ago» / «2 h ago» / «yesterday» / «19 Oct» for the profile's facts line. */
export function agoText(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 2 * DAY) return 'yesterday';
  return formatBotDay(iso);
}
