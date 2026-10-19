import { LiveFrame, type PresenceFrame } from '@tg/shared';
import { API_BASE_URL } from './client';

/** The slice of `WebSocket` this client uses; tests pass a fake. */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  close: (code?: number) => void;
  /** Sends one text frame (the presence frame); only called while the socket is open. */
  send: (data: string) => void;
}

export interface LiveHandlers {
  onFrame: (frame: LiveFrame) => void;
  /** The socket opened after a drop or a failed attempt: signals may have been missed. */
  onReconnected: () => void;
  /** The server ended the session for good (4401 session gone, 4403 access removed). */
  onClosed: (code: number) => void;
  /** A frame that is not JSON or fails the shared schema was dropped: signals may be missed. */
  onInvalidFrame?: () => void;
}

export interface LiveOptions {
  createSocket?: (url: string) => SocketLike;
  /** Delay before reconnect attempt `attempt` (0-based). */
  backoffMs?: (attempt: number) => number;
  /** Reopened after the server ended an earlier session: the first open reports reconnected. */
  resumed?: boolean;
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
 * One live socket for one workspace (ADR-0002). Sends the presence frame after every open and on visibilitychange
 * (with `hidden_for_ms` while hidden, when the tab was seen leaving the screen). Reconnects with backoff after 1001 or any drop,
 * never after 4401/4403. Frames that fail the shared schema (unknown types) are dropped and reported to `onInvalidFrame`.
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
  let resumed = options.resumed ?? false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let socket: SocketLike | undefined;
  let open = false;

  // When this tab left the screen, on the monotonic clock (a wall clock can jump or run ahead), kept
  // across reconnects so a hidden tab that reconnects keeps its 10 minutes (D1). Unknown (undefined)
  // for a tab hidden since it opened: no on-screen history.
  let hiddenAt: number | undefined;
  // Presence (events.md): `on_screen` right after every open and on every visibilitychange.
  const sendPresence = () => {
    if (!open || !socket) return;
    const onScreen = document.visibilityState === 'visible';
    const frame: PresenceFrame = {
      type: 'presence',
      v: 1,
      on_screen: onScreen,
      ...(!onScreen && hiddenAt !== undefined
        ? { hidden_for_ms: Math.max(0, Math.round(performance.now() - hiddenAt)) }
        : {}),
    };
    try {
      socket.send(JSON.stringify(frame));
    } catch {
      // a socket closing underneath: the close event drives the reconnect
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') hiddenAt = undefined;
    else hiddenAt ??= performance.now();
    sendPresence();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const stop = () => {
    stopped = true;
    open = false;
    document.removeEventListener('visibilitychange', onVisibility);
  };

  const connect = () => {
    const current = createSocket(liveUrl(workspaceId));
    socket = current;
    current.onopen = () => {
      if (stopped) return;
      // Any failed attempt before this open (a drop, or a first try that never opened) may have
      // missed signals.
      const missed = attempt > 0 || resumed;
      attempt = 0;
      resumed = false;
      open = true;
      sendPresence();
      if (missed) handlers.onReconnected();
    };
    current.onmessage = (event) => {
      if (stopped || typeof event.data !== 'string') return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        handlers.onInvalidFrame?.();
        return;
      }
      const frame = LiveFrame.safeParse(raw);
      if (frame.success) handlers.onFrame(frame.data);
      else handlers.onInvalidFrame?.();
    };
    current.onclose = (event) => {
      if (stopped) return;
      open = false;
      if (NO_RECONNECT.has(event.code)) {
        stop();
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
      stop();
      clearTimeout(timer);
      socket?.close();
    },
  };
}
