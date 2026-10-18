import type { LiveFrame } from '@tg/shared';
import { LiveFrame as LiveFrameSchema } from '@tg/shared';
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

export interface LiveHubDeps {
  sessions: { liveSessionIds(sessionIds: readonly string[]): Promise<string[]> };
  members: {
    activeMembersAmong(workspaceId: string, accountIds: readonly string[]): Promise<string[]>;
  };
  logger: { warn(obj: object, msg: string): void; error(obj: object, msg: string): void };
  pingMs?: number;
  revalidateMs?: number;
}

export interface LiveHub {
  attach(socket: LiveSocket, owner: LiveSocketOwner): void;
  detach(socket: LiveSocket): void;
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

export function createLiveHub(deps: LiveHubDeps): LiveHub {
  const { sessions, members, logger } = deps;
  const sockets = new Map<LiveSocket, LiveSocketOwner>();
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
  const close = (socket: LiveSocket, code: number, reason: string) => {
    sockets.delete(socket);
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
    },
    detach(socket) {
      sockets.delete(socket);
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
      for (const socket of [...sockets.keys()])
        close(socket, CLOSE_GOING_AWAY, 'server going away');
    },
  };
}
