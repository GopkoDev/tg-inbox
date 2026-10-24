/** Pings and bot answers per second and bot: a third of Telegram's ~30 per second (ADR-0006). */
export const MEMBER_MESSAGES_PER_SECOND = 10;

/**
 * Broadcast sends per second and bot (ADR-0008): starts at least 40 ms apart, so any 1 s window
 * holds at most 25, leaving room under Telegram's ~30 for replies, pings and bot answers. A pacer
 * of its own, separate from the member-message one; replies (`sendText`) use neither.
 */
export const BROADCAST_MESSAGES_PER_SECOND = 25;

export interface Pacer {
  /**
   * Resolves when a send of this bot may start. Callers of one key are released one at a time, in
   * call order, each at least `1000 / perSecond` ms after the previous one was actually released.
   */
  wait(key: string): Promise<void>;
}

export interface PacerOptions {
  perSecond?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * In-process, keyed by bot. The gap is measured from the previous caller's actual release, never
 * from a slot reserved in advance: a timer that fires late (an event-loop stall) delays the queue
 * behind it instead of letting the delayed callers start together.
 */
export function createPacer({
  perSecond = MEMBER_MESSAGES_PER_SECOND,
  now = () => performance.now(),
  sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: PacerOptions = {}): Pacer {
  const gap = Math.ceil(1000 / perSecond);
  const lastStart = new Map<string, number>();
  const tail = new Map<string, Promise<void>>();

  async function release(key: string) {
    for (;;) {
      const t = now();
      const last = lastStart.get(key);
      const due = last === undefined ? t : last + gap;
      if (t >= due) {
        lastStart.set(key, t);
        return;
      }
      await sleep(due - t);
    }
  }

  return {
    wait(key) {
      const turn = (tail.get(key) ?? Promise.resolve()).then(() => release(key));
      tail.set(key, turn);
      // The last caller of a quiet key drops its chain, so the map does not grow with idle bots.
      void turn.then(() => {
        if (tail.get(key) === turn) tail.delete(key);
      });
      return turn;
    },
  };
}
