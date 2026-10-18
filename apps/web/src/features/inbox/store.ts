import type {
  Conversation,
  InboxBotStatus,
  LiveFrame,
  ThreadItem,
  ThreadMessage,
  ThreadPage,
  ThreadReply,
} from '@tg/shared';
import { create } from 'zustand';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { openLiveSocket, type LiveClient } from '@/shared/api/realtime';
import * as source from './api-source';

const BACKGROUND = { background: true } as const;
const PAGE_SIZE = 30;

export type ListStatus = 'loading' | 'ready' | 'error';
/** `stopped`: the server ended the session (4401/4403); no reconnect, the next request decides. */
export type LiveStatus = 'idle' | 'live' | 'stopped';

export interface OpenThread {
  conversationId: string;
  status: ListStatus;
  items: ThreadItem[];
  hasPrev: boolean;
  prevCursor: string | null;
  readThroughAt: string | null;
}

/**
 * The inbox of ONE workspace (`workspaceId`), shared by SCR-01..05. Entering another workspace
 * resets everything and closes the socket synchronously; every answer or frame tagged with any
 * other workspace id is dropped, so no conversation of one workspace is ever drawn in another.
 */
interface InboxState {
  workspaceId: string | null;
  listStatus: ListStatus;
  conversations: Conversation[];
  hasNext: boolean;
  nextCursor: string | null;
  bot: InboxBotStatus | null;
  thread: OpenThread | null;
  live: LiveStatus;
  enter: (workspaceId: string) => Promise<void>;
  leave: () => void;
  openThread: (workspaceId: string, conversationId: string) => Promise<void>;
  closeThread: () => void;
}

const EMPTY: Omit<InboxState, 'enter' | 'leave' | 'openThread' | 'closeThread'> = {
  workspaceId: null,
  listStatus: 'loading',
  conversations: [],
  hasNext: false,
  nextCursor: null,
  bot: null,
  thread: null,
  live: 'idle',
};

let client: LiveClient | null = null;
/** Bumped on every reset: a request started before it is stale. */
let epoch = 0;
const running = new Map<string, { again: boolean }>();

const byActivity = (a: Conversation, b: Conversation) =>
  b.last_activity_at.localeCompare(a.last_activity_at) || b.id.localeCompare(a.id);

function itemKey(item: ThreadItem): string {
  return item.type === 'message' ? item.sent_at : item.position_at;
}
const byPosition = (a: ThreadItem, b: ThreadItem) =>
  (itemKey(a) ?? '').localeCompare(itemKey(b) ?? '') || a.id.localeCompare(b.id);

function upsertItem(items: ThreadItem[], item: ThreadItem): ThreadItem[] {
  return [...items.filter((i) => i.id !== item.id), item].sort(byPosition);
}

function upsertConversation(list: Conversation[], row: Conversation): Conversation[] {
  return [...list.filter((c) => c.id !== row.id), row].sort(byActivity);
}

export const useInboxStore = create<InboxState>()((set, get) => {
  const closeSocket = () => {
    client?.close();
    client = null;
  };
  const reset = () => {
    epoch++;
    closeSocket();
    running.clear();
    set({ ...EMPTY });
  };

  /** True while the request's workspace is still the store's (not left, not switched). */
  const current = (workspaceId: string, startedAt: number) =>
    get().workspaceId === workspaceId && epoch === startedAt;

  /** Runs `task`; calls arriving while it runs collapse into one more run after it. */
  const coalesce = (key: string, task: () => Promise<void>) => {
    const entry = running.get(key);
    if (entry) {
      entry.again = true;
      return;
    }
    const state = { again: false };
    running.set(key, state);
    const run = async () => {
      try {
        await task();
      } catch {
        // a missed refetch heals on the next frame, reconnect or resync
      }
      if (running.get(key) !== state) return;
      if (state.again) {
        state.again = false;
        void run();
      } else running.delete(key);
    };
    void run();
  };

  const loadList = async (workspaceId: string, options: { background: boolean }) => {
    const startedAt = epoch;
    try {
      const page = await source.listConversations(
        workspaceId,
        { limit: PAGE_SIZE },
        options.background ? BACKGROUND : {},
      );
      if (!current(workspaceId, startedAt) || page.workspace_id !== workspaceId) return;
      set({
        conversations: [...page.items].sort(byActivity),
        hasNext: page.has_next,
        nextCursor: page.next_cursor,
        listStatus: 'ready',
      });
    } catch {
      if (current(workspaceId, startedAt) && !options.background) set({ listStatus: 'error' });
    }
  };

  const loadBot = async (workspaceId: string) => {
    const startedAt = epoch;
    try {
      const bot = await source.getInboxBotStatus(workspaceId, BACKGROUND);
      if (current(workspaceId, startedAt) && bot.workspace_id === workspaceId) set({ bot });
    } catch {
      // keeps the last known status
    }
  };

  const loadThread = async (
    workspaceId: string,
    conversationId: string,
    options: { background: boolean },
  ) => {
    const startedAt = epoch;
    try {
      const page: ThreadPage = await source.listThreadItems(
        workspaceId,
        conversationId,
        { limit: PAGE_SIZE },
        options.background ? BACKGROUND : {},
      );
      const open = get().thread;
      if (
        !current(workspaceId, startedAt) ||
        page.workspace_id !== workspaceId ||
        open?.conversationId !== conversationId
      )
        return;
      set({
        thread: {
          conversationId,
          status: 'ready',
          items: [...page.items].sort(byPosition),
          hasPrev: page.has_prev,
          prevCursor: page.prev_cursor,
          readThroughAt: page.read_through_at,
        },
      });
    } catch {
      const open = get().thread;
      if (
        current(workspaceId, startedAt) &&
        open?.conversationId === conversationId &&
        !options.background
      )
        set({ thread: { ...open, status: 'error' } });
    }
  };

  /** After a (re)connect or `resync`: the three authoritative re-reads. */
  const rereadAll = (workspaceId: string) => {
    void loadList(workspaceId, { background: true });
    const open = get().thread;
    if (open) void loadThread(workspaceId, open.conversationId, { background: true });
    void loadBot(workspaceId);
  };

  const refetchRow = (workspaceId: string, conversationId: string) =>
    coalesce(`row:${conversationId}`, async () => {
      const startedAt = epoch;
      const row = await source.getConversation(workspaceId, conversationId, BACKGROUND);
      if (!current(workspaceId, startedAt) || row.workspace_id !== workspaceId) return;
      set((s) => ({ conversations: upsertConversation(s.conversations, row) }));
    });

  const mergeItem = (workspaceId: string, item: ThreadMessage | ThreadReply) => {
    const open = get().thread;
    if (!open || item.workspace_id !== workspaceId || open.conversationId !== item.conversation_id)
      return;
    set({ thread: { ...open, items: upsertItem(open.items, item) } });
  };

  const refetchItem = (
    workspaceId: string,
    conversationId: string,
    item: { type: 'message' | 'reply'; id: string },
    markRead: boolean,
  ) =>
    coalesce(`item:${item.id}`, async () => {
      const startedAt = epoch;
      if (item.type === 'reply') {
        const reply = await source.getThreadReply(workspaceId, conversationId, item.id, BACKGROUND);
        if (current(workspaceId, startedAt)) mergeItem(workspaceId, reply);
        return;
      }
      const message = await source.getThreadMessage(
        workspaceId,
        conversationId,
        item.id,
        BACKGROUND,
      );
      if (!current(workspaceId, startedAt)) return;
      mergeItem(workspaceId, message);
      if (markRead && document.visibilityState === 'visible')
        await source.markConversationRead(
          workspaceId,
          conversationId,
          message.received_at,
          BACKGROUND,
        );
    });

  const onFrame = (workspaceId: string, frame: LiveFrame) => {
    if (frame.workspace_id !== workspaceId || get().workspaceId !== workspaceId) return;
    switch (frame.type) {
      case 'bot.changed':
        void loadBot(workspaceId);
        return;
      case 'resync':
        rereadAll(workspaceId);
        return;
      case 'conversation.changed': {
        const { conversation_id: conversationId, item, change } = frame;
        const open = get().thread?.conversationId === conversationId;
        if (item && open) refetchItem(workspaceId, conversationId, item, change === 'created');
        const row = get().conversations.find((c) => c.id === conversationId);
        const rowChanges =
          change === 'read' ||
          (change === 'created' && item?.type === 'message') ||
          (change === 'edited' && (!row || row.last_item.id === item?.id)) ||
          change === 'state';
        if (rowChanges) refetchRow(workspaceId, conversationId);
        return;
      }
    }
  };

  return {
    ...EMPTY,
    async enter(workspaceId) {
      if (get().workspaceId === workspaceId) return;
      reset();
      set({ workspaceId });
      client = openLiveSocket(workspaceId, {
        onFrame: (frame) => onFrame(workspaceId, frame),
        onReconnected: () => rereadAll(workspaceId),
        onClosed: () => {
          if (get().workspaceId === workspaceId) set({ live: 'stopped' });
        },
      });
      set({ live: 'live' });
      await Promise.all([loadList(workspaceId, { background: false }), loadBot(workspaceId)]);
    },
    leave: reset,
    async openThread(workspaceId, conversationId) {
      if (get().workspaceId !== workspaceId) return;
      set({
        thread: {
          conversationId,
          status: 'loading',
          items: [],
          hasPrev: false,
          prevCursor: null,
          readThroughAt: null,
        },
      });
      await loadThread(workspaceId, conversationId, { background: false });
    },
    closeThread: () => set({ thread: null }),
  };
});

// Workspace switch, access removed and sign-out change the current workspace: drop the inbox
// (and its socket) synchronously, before any component re-renders.
useWorkspaceStore.subscribe((state, prev) => {
  if (state.current?.id !== prev.current?.id) useInboxStore.getState().leave();
});
