// The sending chain's pace and turns (ADR-0008, ADR-0011; AC-15).

/** At most 25 sends per second per bot: one start every 40 ms. */
export const PACE_PER_SECOND = 25;
export const START_SPACING_MS = 1000 / PACE_PER_SECOND;
/** Sends in flight at once; eight cover a 320 ms Telegram round trip at full pace. */
export const MAX_IN_FLIGHT = 8;
/** One link of the chain runs at most this long, then queues its successor. */
export const LINK_MS = 20_000;
/** A send with no answer after this is not confirmed. */
export const SEND_TIMEOUT_MS = 10_000;
/** `broadcast.changed report` at most once per second per broadcast. */
export const REPORT_COALESCE_MS = 1_000;

/**
 * The broadcast whose turn is next: the one after `lastServed` in `sendingByLaunch` (oldest launch
 * first), wrapping round; the oldest when `lastServed` is none or no longer sending.
 */
export const nextTurn = (
  sendingByLaunch: readonly string[],
  lastServed: string | null,
): string | null => {
  if (sendingByLaunch.length === 0) return null;
  const at = lastServed === null ? -1 : sendingByLaunch.indexOf(lastServed);
  return sendingByLaunch[(at + 1) % sendingByLaunch.length] ?? null;
};

/**
 * Coalesces report signals per broadcast: the leading one goes at once, any within the next second
 * owe one trailing publish, due once the second has passed.
 */
export class ReportCoalescer {
  private readonly lastAt = new Map<string, number>();
  private readonly owed = new Set<string>();

  constructor(private readonly windowMs = REPORT_COALESCE_MS) {}

  /** True when a report for `broadcastId` may be published now (and records it). */
  shouldPublish(broadcastId: string, now: number): boolean {
    const last = this.lastAt.get(broadcastId);
    if (last !== undefined && now - last < this.windowMs) {
      this.owed.add(broadcastId);
      return false;
    }
    this.lastAt.set(broadcastId, now);
    this.owed.delete(broadcastId);
    return true;
  }

  /** The broadcasts whose owed publish is due at `now` (recorded as published). */
  flushDue(now: number): string[] {
    const due: string[] = [];
    for (const id of this.owed) {
      const last = this.lastAt.get(id) ?? -Infinity;
      if (now - last >= this.windowMs) due.push(id);
    }
    for (const id of due) {
      this.owed.delete(id);
      this.lastAt.set(id, now);
    }
    return due;
  }

  /** The broadcasts that still owe a publish (for the link's final flush). */
  pending(): string[] {
    return [...this.owed];
  }
}
