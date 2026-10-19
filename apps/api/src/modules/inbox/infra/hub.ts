import type { LiveFrame } from '@tg/shared';
import { LiveFrame as LiveFrameSchema, PresenceFrame } from '@tg/shared';
import { newId } from '../../../platform/ids.js';
import type { RealtimeSignal } from '../../../platform/realtime.js';

/** The slice of a WebSocket the hub needs (a `ws` socket satisfies it). */
export interface LiveSocket {
  send(data: string): void;
  ping(): void;
  close(code: number, reason: string): void;
}

export interface LiveSocketOwner {
  workspaceId: string;
  accountId: string;
  sessionId: string;
}

/** What the hub reports about each socket to `notifications` (its presence use cases). */
export interface PresencePort {
  opened(
    workspaceId: string,
    accountId: string,
    connectionId: string,
    onScreen: boolean,
  ): Promise<void>;
  alive(workspaceId: string, connectionId: string): Promise<void>;
  screen(
    workspaceId: string,
    connectionId: string,
    accountId: string,
    onScreen: boolean,
  ): Promise<void>;
  closed(workspaceId: string, connectionId: string): Promise<void>;
}

/** The one client frame is tiny; anything larger is ignored unread (events.md, `LIVE_MAX_INBOUND_BYTES`). */
export const LIVE_MAX_INBOUND_BYTES = 1024;

export interface LiveHubDeps {
  sessions: { liveSessionIds(sessionIds: readonly string[]): Promise<string[]> };
  members: {
    activeMembersAmong(workspaceId: string, accountIds: readonly string[]): Promise<string[]>;
  };
  presence: PresencePort;
  logger: { warn(obj: object, msg: string): void; error(obj: object, msg: string): void };
  pingMs?: number;
  revalidateMs?: number;
  /** One presence write per socket per this many ms, last value wins (default 1000). */
  presenceCoalesceMs?: number;
}

export interface LiveHub {
  /** Registers the socket and its presence lease (a fresh connection id, not on screen until its first frame). */
  attach(socket: LiveSocket, owner: LiveSocketOwner): void;
  /** The socket closed or failed: its lease is deleted. */
  detach(socket: LiveSocket): void;
  /** A pong arrived: the socket's lease is extended. */
  pong(socket: LiveSocket): void;
  /** A client frame arrived. Only a valid `presence` frame is read; everything else is ignored. */
  message(socket: LiveSocket, data: unknown): void;
  /** Turns a realtime signal into frames for the sockets it concerns (events.md). */
  dispatch(signal: RealtimeSignal): void;
  /** Tells every socket that signals may have been missed. */
  resync(): void;
  /** One re-validation pass: session valid and membership active, one members query per workspace. */
  revalidate(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

export const CLOSE_ACCESS_REMOVED = 4403;
export const CLOSE_SESSION_ENDED = 4401;
export const CLOSE_GOING_AWAY = 1001;

/** The presence state of one socket (ADR-0002). */
interface Conn {
  id: string;
  owner: LiveSocketOwner;
  /** Presence calls of one socket run in order: a close never overtakes the open. */
  queue: Promise<void>;
  /** Waiting to be written: the last `on_screen` the tab reported. */
  pending: boolean | undefined;
  timer: NodeJS.Timeout | undefined;
}

export function createLiveHub(deps: LiveHubDeps): LiveHub {
  const { sessions, members, presence, logger } = deps;
  const coalesceMs = deps.presenceCoalesceMs ?? 1000;
  const sockets = new Map<LiveSocket, LiveSocketOwner>();
  const conns = new Map<LiveSocket, Conn>();
  let pingTimer: NodeJS.Timeout | null = null;
  let revalidateTimer: NodeJS.Timeout | null = null;
  let revalidating = false;

  const safe = (fn: () => void) => {
    try {
      fn();
    } catch {
      // A socket that is already closing: the close event will detach it.
    }
  };
  /**
   * Presence is best effort and fails safe: a lost write can only make a member away sooner (the lease
   * expires), never present. Logged by code only.
   */
  const run = (conn: Conn, fn: () => Promise<void>) => {
    conn.queue = conn.queue
      .then(fn)
      .catch((err: unknown) =>
        logger.warn({ code: (err as { code?: string } | null)?.code }, 'presence write failed'),
      );
  };
  /** Ends the socket's presence: drops a pending write and deletes the lease, once. */
  const release = (socket: LiveSocket) => {
    const conn = conns.get(socket);
    if (!conn) return;
    conns.delete(socket);
    clearTimeout(conn.timer);
    run(conn, () => presence.closed(conn.owner.workspaceId, conn.id));
  };
  const close = (socket: LiveSocket, code: number, reason: string) => {
    sockets.delete(socket);
    release(socket);
    safe(() => socket.close(code, reason));
  };
  const send = (socket: LiveSocket, frame: LiveFrame) => {
    const parsed = LiveFrameSchema.safeParse(frame);
    if (!parsed.success) {
      logger.error({ frameType: frame.type }, 'live frame failed its schema');
      return;
    }
    safe(() => socket.send(JSON.stringify(parsed.data)));
  };

  return {
    attach(socket, owner) {
      sockets.set(socket, owner);
      const conn: Conn = {
        id: newId(),
        owner,
        queue: Promise.resolve(),
        pending: undefined,
        timer: undefined,
      };
      conns.set(socket, conn);
      // Registered hidden: a tab that never sends its frame counts as connected but not on screen,
      // the safe direction (events.md, assumption 6).
      run(conn, () => presence.opened(owner.workspaceId, owner.accountId, conn.id, false));
    },
    detach(socket) {
      sockets.delete(socket);
      release(socket);
    },

    pong(socket) {
      const conn = conns.get(socket);
      if (conn) run(conn, () => presence.alive(conn.owner.workspaceId, conn.id));
    },

    message(socket, data) {
      const conn = conns.get(socket);
      if (!conn || !Buffer.isBuffer(data) || data.byteLength > LIVE_MAX_INBOUND_BYTES) return;
      let json: unknown;
      try {
        json = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      const frame = PresenceFrame.safeParse(json);
      if (!frame.success) return;
      // One write per socket per window, the last value wins.
      conn.pending = frame.data.on_screen;
      conn.timer ??= setTimeout(() => {
        conn.timer = undefined;
        const onScreen = conn.pending;
        conn.pending = undefined;
        if (onScreen === undefined) return;
        run(conn, () =>
          presence.screen(conn.owner.workspaceId, conn.id, conn.owner.accountId, onScreen),
        );
      }, coalesceMs);
      conn.timer.unref();
    },

    dispatch(signal) {
      if (signal.type === 'membership.deactivated') {
        for (const [socket, o] of [...sockets]) {
          if (o.workspaceId === signal.workspace_id && o.accountId === signal.account_id) {
            close(socket, CLOSE_ACCESS_REMOVED, 'access removed');
          }
        }
        return;
      }
      let frame: LiveFrame;
      let onlyAccount: string | undefined;
      if (signal.type === 'bot.changed') {
        frame = { type: 'bot.changed', v: 1, workspace_id: signal.workspace_id };
      } else if (signal.type === 'telegram_link.changed') {
        frame = { type: 'telegram_link.changed', v: 1, workspace_id: signal.workspace_id };
        onlyAccount = signal.account_id;
      } else {
        frame = {
          type: 'conversation.changed',
          v: 1,
          workspace_id: signal.workspace_id,
          conversation_id: signal.conversation_id,
          item: signal.item,
          change: signal.change,
        };
        if (signal.change === 'read') onlyAccount = signal.account_id;
      }
      for (const [socket, o] of sockets) {
        if (o.workspaceId !== signal.workspace_id) continue;
        if (onlyAccount !== undefined && o.accountId !== onlyAccount) continue;
        send(socket, frame);
      }
    },

    resync() {
      for (const [socket, o] of sockets) {
        send(socket, { type: 'resync', v: 1, workspace_id: o.workspaceId });
      }
    },

    async revalidate() {
      if (revalidating || sockets.size === 0) return;
      revalidating = true;
      try {
        const byWorkspace = new Map<string, Array<[LiveSocket, LiveSocketOwner]>>();
        for (const entry of sockets) {
          const list = byWorkspace.get(entry[1].workspaceId) ?? [];
          list.push(entry);
          byWorkspace.set(entry[1].workspaceId, list);
        }
        for (const [workspaceId, entries] of byWorkspace) {
          try {
            const live = new Set(
              await sessions.liveSessionIds(entries.map(([, o]) => o.sessionId)),
            );
            const stillOpen = entries.filter(([, o]) => live.has(o.sessionId));
            for (const [socket, o] of entries) {
              if (!live.has(o.sessionId)) close(socket, CLOSE_SESSION_ENDED, 'session ended');
            }
            if (stillOpen.length === 0) continue;
            const active = new Set(
              await members.activeMembersAmong(workspaceId, [
                ...new Set(stillOpen.map(([, o]) => o.accountId)),
              ]),
            );
            for (const [socket, o] of stillOpen) {
              if (!active.has(o.accountId)) close(socket, CLOSE_ACCESS_REMOVED, 'access removed');
            }
          } catch (err) {
            // Fail open for this pass only: the next tick retries.
            logger.warn({ code: (err as { code?: string }).code }, 'live re-validation failed');
          }
        }
      } finally {
        revalidating = false;
      }
    },

    start() {
      if (pingTimer) return;
      pingTimer = setInterval(() => {
        for (const socket of sockets.keys()) safe(() => socket.ping());
      }, deps.pingMs ?? 25_000);
      revalidateTimer = setInterval(() => void this.revalidate(), deps.revalidateMs ?? 5_000);
      pingTimer.unref();
      revalidateTimer.unref();
    },

    async stop() {
      if (pingTimer) clearInterval(pingTimer);
      if (revalidateTimer) clearInterval(revalidateTimer);
      pingTimer = revalidateTimer = null;
      const open = [...conns.values()];
      for (const socket of [...sockets.keys()])
        close(socket, CLOSE_GOING_AWAY, 'server going away');
      // The leases are gone before the database is released.
      await Promise.all(open.map((c) => c.queue));
    },
  };
}
