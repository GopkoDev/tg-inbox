import type { LiveHandlers, LiveOptions } from './realtime';
import { openLiveSocket, type LiveClient } from './realtime';

/** A consumer of the tab's live connection: the same callbacks `openLiveSocket` takes. */
export type LiveSubscriber = LiveHandlers;
/** `stopped`: the server ended the session (4401/4403); no reconnect until a request succeeds. */
export type LiveConnectionStatus = 'idle' | 'live' | 'stopped';

interface Entry {
  owners: number;
  client: LiveClient;
  status: LiveConnectionStatus;
  options: LiveOptions;
}

const connections = new Map<string, Entry>();
/** Kept apart from the sockets: a page subscribes before (child effects run first) or after the frame opens it. */
const subscribers = new Map<string, Set<LiveSubscriber>>();

function each(workspaceId: string, call: (subscriber: LiveSubscriber) => void) {
  for (const subscriber of [...(subscribers.get(workspaceId) ?? [])]) {
    try {
      call(subscriber);
    } catch {
      // one subscriber failing must not starve the others
    }
  }
}

/** A socket for `entry`, fanning out while `entry` is the workspace's connection. */
function connect(workspaceId: string, entry: Entry, options: LiveOptions): LiveClient {
  const live = () => connections.get(workspaceId) === entry;
  return openLiveSocket(
    workspaceId,
    {
      onFrame: (frame) => live() && each(workspaceId, (s) => s.onFrame(frame)),
      onReconnected: () => live() && each(workspaceId, (s) => s.onReconnected()),
      onInvalidFrame: () => live() && each(workspaceId, (s) => s.onInvalidFrame?.()),
      onClosed: (code) => {
        if (!live()) return;
        entry.status = 'stopped';
        each(workspaceId, (s) => s.onClosed(code));
      },
    },
    options,
  );
}

/** A stopped entry gets a fresh socket; it reports reconnected on open (signals were missed). */
function resume(workspaceId: string, entry: Entry) {
  entry.status = 'live';
  entry.client = connect(workspaceId, entry, { ...entry.options, resumed: true });
}

/**
 * The tab's one live connection for `workspaceId`, owned by the workspace frame (SAD §4,
 * ADR-0002). Opening the same workspace again shares the socket; it closes with the last owner.
 * Frames, reconnects, dropped frames and the server's end-of-session reach every subscriber.
 * Opening a workspace whose session the server ended replaces the stopped socket.
 */
export function openLiveConnection(
  workspaceId: string,
  options: LiveOptions = {},
): { close: () => void } {
  let entry = connections.get(workspaceId);
  if (entry) {
    entry.owners++;
    if (entry.status === 'stopped') resume(workspaceId, entry);
  } else {
    const created: Entry = {
      owners: 1,
      status: 'live',
      options,
      client: { close: () => undefined },
    };
    connections.set(workspaceId, created);
    created.client = connect(workspaceId, created, options);
    entry = created;
  }
  const owned = entry;
  let released = false;
  return {
    close() {
      if (released) return;
      released = true;
      if (--owned.owners > 0) return;
      owned.client.close();
      if (connections.get(workspaceId) === owned) connections.delete(workspaceId);
    },
  };
}

/**
 * After the server ended the session (4401/4403), a later request that succeeded says the member
 * may listen again: reopen the stopped socket for the owners still holding it. A live or unopened
 * connection is left alone.
 */
export function reviveLiveConnection(workspaceId: string): void {
  const entry = connections.get(workspaceId);
  if (entry?.status === 'stopped') resume(workspaceId, entry);
}

export function liveStatus(workspaceId: string): LiveConnectionStatus {
  return connections.get(workspaceId)?.status ?? 'idle';
}

/** Receives the workspace's live frames until the returned function is called. */
export function subscribeLive(workspaceId: string, subscriber: LiveSubscriber): () => void {
  let set = subscribers.get(workspaceId);
  if (!set) subscribers.set(workspaceId, (set = new Set()));
  set.add(subscriber);
  return () => {
    set.delete(subscriber);
    if (set.size === 0 && subscribers.get(workspaceId) === set) subscribers.delete(workspaceId);
  };
}
