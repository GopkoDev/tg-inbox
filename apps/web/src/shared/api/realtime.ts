import { LiveFrame } from '@tg/shared';
import { API_BASE_URL } from './client';

/** The slice of `WebSocket` this client uses; tests pass a fake. */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  close: (code?: number) => void;
}

export interface LiveHandlers {
  onFrame: (frame: LiveFrame) => void;
  /** The socket opened after a drop or a failed attempt: signals may have been missed. */
  onReconnected: () => void;
  /** The server ended the session for good (4401 session gone, 4403 access removed). */
  onClosed: (code: number) => void;
}

export interface LiveOptions {
  createSocket?: (url: string) => SocketLike;
  /** Delay before reconnect attempt `attempt` (0-based). */
  backoffMs?: (attempt: number) => number;
}

export interface LiveClient {
  close: () => void;
}

const NO_RECONNECT = new Set([4401, 4403]);

const defaultBackoff = (attempt: number) =>
  Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + Math.random() / 2);

function liveUrl(workspaceId: string): string {
  const path = `/api/workspaces/${encodeURIComponent(workspaceId)}/inbox/live`;
  const url = new URL(`${API_BASE_URL}${path}`, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/**
 * One live socket for one workspace (ADR-0002). Reconnects with backoff after 1001 or any drop,
 * never after 4401/4403. Frames that fail the shared schema (unknown types) are ignored.
 */
export function openLiveSocket(
  workspaceId: string,
  handlers: LiveHandlers,
  options: LiveOptions = {},
): LiveClient {
  const createSocket =
    options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
  const backoff = options.backoffMs ?? defaultBackoff;
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let socket: SocketLike | undefined;

  const connect = () => {
    const current = createSocket(liveUrl(workspaceId));
    socket = current;
    current.onopen = () => {
      if (stopped) return;
      // Any failed attempt before this open (a drop, or a first try that never opened) may have
      // missed signals.
      const missed = attempt > 0;
      attempt = 0;
      if (missed) handlers.onReconnected();
    };
    current.onmessage = (event) => {
      if (stopped || typeof event.data !== 'string') return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      const frame = LiveFrame.safeParse(raw);
      if (frame.success) handlers.onFrame(frame.data);
    };
    current.onclose = (event) => {
      if (stopped) return;
      if (NO_RECONNECT.has(event.code)) {
        stopped = true;
        handlers.onClosed(event.code);
        return;
      }
      timer = setTimeout(connect, backoff(attempt++));
    };
    current.onerror = () => undefined; // the close event follows and drives the reconnect
  };

  connect();
  return {
    close() {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    },
  };
}
