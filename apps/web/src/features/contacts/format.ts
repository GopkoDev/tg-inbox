import { formatBotDay, formatBotTime } from '@/features/bot/settings/format';
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
