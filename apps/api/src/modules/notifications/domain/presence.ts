import { LEASE_MS, PRESENCE_WINDOW_MS } from './constants.js';

/** One open workspace tab of a member (a `tab_presences` row). */
export interface PresenceLease {
  liveUntil: Date;
  onScreen: boolean;
  lastOnScreenAt: Date | null;
}

/**
 * Present for a workspace: some lease is live (`liveUntil` in the future) and its tab is on screen, or
 * left the screen less than 10 minutes ago (D1, ADR-0002).
 */
export function isPresent(leases: readonly PresenceLease[], now: Date): boolean {
  const t = now.getTime();
  return leases.some(
    (l) =>
      l.liveUntil.getTime() > t &&
      (l.onScreen ||
        (l.lastOnScreenAt !== null && l.lastOnScreenAt.getTime() > t - PRESENCE_WINDOW_MS)),
  );
}

export function isAway(leases: readonly PresenceLease[], now: Date): boolean {
  return !isPresent(leases, now);
}

/**
 * The time a tab says it left the screen, bounded by the server clock: never in the future, never
 * older than the presence window plus one lease (older counts away anyway). Only this bound is trusted.
 */
export function boundHiddenSince(claimed: Date, now: Date): Date {
  const t = now.getTime();
  return new Date(Math.min(t, Math.max(claimed.getTime(), t - PRESENCE_WINDOW_MS - LEASE_MS)));
}
