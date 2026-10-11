export const SESSION_IDLE_LIMIT_MS = 30 * 86_400_000;
export const LAST_SEEN_REFRESH_MS = 60_000;

/** A session idle for more than 30 days is dead. */
export function sessionIsExpired(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() > SESSION_IDLE_LIMIT_MS;
}

/** Only user-triggered requests refresh `last_seen_at`, at most once a minute per session. */
export function shouldRefreshLastSeen(lastSeenAt: Date, now: Date, background: boolean): boolean {
  if (background) return false;
  return now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_REFRESH_MS;
}
