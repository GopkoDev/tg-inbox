import type { Clock } from '../../../platform/clock.js';
import { LEASE_MS } from '../domain/constants.js';
import { leftScreenAt } from '../domain/presence.js';
import type { PingRepo, PresenceRepo } from './ports.js';

export interface PresenceDeps {
  presence: PresenceRepo;
  pings: Pick<PingRepo, 'markOpened'>;
  clock: Clock;
}

/**
 * What the inbox hub reports about each socket (ADR-0002). Every write is scoped by the socket's
 * workspace id and its connection id, so a frame can only touch its own lease. The hub holds both and
 * the authenticated account; nothing here comes from the client except `onScreen`.
 */
export interface Presence {
  /**
   * A tab's socket opened. Deletes the member's expired leases in this workspace (rows a crash left
   * behind never outlive the member's next open; the sweep only visits workspaces with a live link),
   * registers a 50 s lease and, when the tab is on screen, marks the member's latest ping opened.
   * The hub registers with `onScreen = false` and lets the first `presence` frame set it.
   */
  opened(
    workspaceId: string,
    accountId: string,
    connectionId: string,
    onScreen: boolean,
  ): Promise<void>;
  /** A pong: the lease lasts 50 s past now, never less than before. No-op when the lease is gone. */
  alive(workspaceId: string, connectionId: string): Promise<void>;
  /**
   * The tab went on or off screen. Leaving stamps `last_on_screen_at`; returning marks the member's
   * latest ping opened (spec section 7). `accountId` is the socket's authenticated member. No-op when
   * the lease is gone. `hiddenForMs` (off frames only) is how long ago the tab says it left the screen:
   * anchored on the server clock and bounded, it is stamped on a lease with no on-screen history (a
   * hidden tab that reconnected), so the tab keeps its 10 minutes (D1).
   */
  screen(
    workspaceId: string,
    connectionId: string,
    accountId: string,
    onScreen: boolean,
    hiddenForMs?: number,
  ): Promise<void>;
  /** A clean close (including 4401 / 4403): the lease goes at once. */
  closed(workspaceId: string, connectionId: string): Promise<void>;
}

export function createPresence({ presence, pings, clock }: PresenceDeps): Presence {
  const leaseEnd = (now: Date) => new Date(now.getTime() + LEASE_MS);
  return {
    async opened(workspaceId, accountId, connectionId, onScreen) {
      const now = clock.now();
      await presence.deleteExpired(workspaceId, now, accountId);
      await presence.open(workspaceId, {
        id: connectionId,
        accountId,
        liveUntil: leaseEnd(now),
        onScreen,
        at: now,
      });
      if (onScreen) await pings.markOpened(workspaceId, accountId, now);
    },

    async alive(workspaceId, connectionId) {
      await presence.extend(workspaceId, connectionId, leaseEnd(clock.now()));
    },

    async screen(workspaceId, connectionId, accountId, onScreen, hiddenForMs) {
      const now = clock.now();
      const left =
        !onScreen && hiddenForMs !== undefined ? leftScreenAt(hiddenForMs, now) : undefined;
      const found = await presence.setScreen(workspaceId, connectionId, onScreen, now, left);
      if (found && onScreen) await pings.markOpened(workspaceId, accountId, now);
    },

    async closed(workspaceId, connectionId) {
      await presence.close(workspaceId, connectionId);
    },
  };
}
