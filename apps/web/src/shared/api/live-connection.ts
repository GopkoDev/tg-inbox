import type { LiveHandlers, LiveOptions } from './realtime';
import { openLiveSocket, type LiveClient } from './realtime';

/** A consumer of the tab's live connection: the same callbacks `openLiveSocket` takes. */
export type LiveSubscriber = LiveHandlers;
/** `stopped`: the server ended the session (4401/4403); no reconnect, the next request decides. */
export type LiveConnectionStatus = 'idle' | 'live' | 'stopped';

interface Entry {
  owners: number;
  client: LiveClient;
  status: LiveConnectionStatus;
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

/**
 * The tab's one live connection for `workspaceId`, owned by the workspace frame (SAD §4,
 * ADR-0002). Opening the same workspace again shares the socket; it closes with the last owner.
 * Frames, reconnects, dropped frames and the server's end-of-session reach every subscriber.
 */
export function openLiveConnection(
  workspaceId: string,
  options: LiveOptions = {},
): { close: () => void } {
  let entry = connections.get(workspaceId);
  if (entry) entry.owners++;
  else {
    const live = () => connections.get(workspaceId) === created;
    const created: Entry = {
      owners: 1,
      status: 'live',
      client: openLiveSocket(
        workspaceId,
        {
          onFrame: (frame) => live() && each(workspaceId, (s) => s.onFrame(frame)),
          onReconnected: () => live() && each(workspaceId, (s) => s.onReconnected()),
          onInvalidFrame: () => live() && each(workspaceId, (s) => s.onInvalidFrame?.()),
          onClosed: (code) => {
            if (!live()) return;
            created.status = 'stopped';
            each(workspaceId, (s) => s.onClosed(code));
          },
        },
        options,
      ),
    };
    connections.set(workspaceId, created);
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
