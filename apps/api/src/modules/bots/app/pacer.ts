/** Pings and bot answers per second and bot: a third of Telegram's ~30 per second (ADR-0006). */
export const MEMBER_MESSAGES_PER_SECOND = 10;

/**
 * Broadcast sends per second and bot (ADR-0008): 40 ms start slots, so any 1 s window holds at
 * most 25, leaving room under Telegram's ~30 for replies, pings and bot answers. A pacer of its
 * own, separate from the member-message one; replies (`sendText`) use neither.
 */
export const BROADCAST_MESSAGES_PER_SECOND = 25;

export interface Pacer {
  /** Resolves when a send of this bot may start; callers of one key start `1000 / perSecond` ms apart. */
  wait(key: string): Promise<void>;
}

export interface PacerOptions {
  perSecond?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** In-process, keyed by bot: each call takes the next free start slot of its key and waits for it. */
export function createPacer({
  perSecond = MEMBER_MESSAGES_PER_SECOND,
  now = Date.now,
  sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: PacerOptions = {}): Pacer {
  const gap = Math.ceil(1000 / perSecond);
  const nextFree = new Map<string, number>();
  return {
    async wait(key) {
      const t = now();
      const slot = Math.max(t, nextFree.get(key) ?? 0);
      nextFree.set(key, slot + gap);
      if (slot > t) await sleep(slot - t);
    },
  };
}
