/** Emails are trimmed and lower-cased before every comparison. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
