import type {
  ContactSummary,
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
import { BotCannotReplyError, ReplyLimitReachedError, TeammateRepliedError } from '@tg/shared';
import { ApiError } from '@/shared/api/client';
import { openLiveSocket, type LiveClient } from '@/shared/api/realtime';
import * as source from './api-source';
import { canSendReply } from './reply';

const BACKGROUND = { background: true } as const;
const PAGE_SIZE = 30;

export type ListStatus = 'loading' | 'ready' | 'error';
/** `stopped`: the server ended the session (4401/4403); no reconnect, the next request decides. */
export type LiveStatus = 'idle' | 'live' | 'stopped';

export type ThreadStatus = ListStatus | 'not_found';
export type OlderStatus = 'idle' | 'loading' | 'error';

export interface OpenThread {
  conversationId: string;
  status: ThreadStatus;
  contact: ContactSummary | null;
  older: OlderStatus;
  items: ThreadItem[];
  hasPrev: boolean;
  prevCursor: string | null;
  readThroughAt: string | null;
}

/** What the reply box of one conversation keeps for this tab (sad.md §4). */
export interface Draft {
  text: string;
  clientKey: string;
  lastSeenReplyId: string | null;
}

/** How a `sendReply` attempt ended; the composer maps each to a state of SCR-02 / SCR-04. */
export type SendResult =
  | { kind: 'sent' }
  | { kind: 'busy' }
  | { kind: 'invalid' }
  | { kind: 'teammate'; reply: { id: string; displayName: string; positionAt: string } }
  | { kind: 'limited'; retryAt: string }
  | { kind: 'unavailable' }
  | { kind: 'rejected'; message: string }
  | { kind: 'failed' };

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
  /** Reply drafts of this tab, by conversation id. */
  drafts: Record<string, Draft>;
  live: LiveStatus;
  setDraftText: (conversationId: string, text: string) => void;
  keepEditing: (conversationId: string, lastSeenReplyId: string) => void;
  sendReply: (
    workspaceId: string,
    conversationId: string,
    options?: { confirmTeammate?: boolean },
  ) => Promise<SendResult>;
  enter: (workspaceId: string) => Promise<void>;
  leave: () => void;
  openThread: (workspaceId: string, conversationId: string) => Promise<void>;
  loadOlder: (workspaceId: string, conversationId: string) => Promise<void>;
  closeThread: () => void;
}

const EMPTY: Omit<
  InboxState,
  | 'enter'
  | 'leave'
  | 'openThread'
  | 'loadOlder'
  | 'closeThread'
  | 'setDraftText'
  | 'keepEditing'
  | 'sendReply'
> = {
  workspaceId: null,
  listStatus: 'loading',
  conversations: [],
  hasNext: false,
  nextCursor: null,
  bot: null,
  thread: null,
  drafts: {},
  live: 'idle',
};

let client: LiveClient | null = null;
/** Conversations with a `sendReply` in flight: a second Enter is ignored. */
const sending = new Set<string>();
const newestReplyId = (items: ThreadItem[] | undefined): string | null =>
  items?.filter((i) => i.type === 'reply').at(-1)?.id ?? null;
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
const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;

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
    sending.clear();
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
          ...open,
          conversationId,
          status: 'ready',
          older: 'idle',
          items: [...page.items].sort(byPosition),
          hasPrev: page.has_prev,
          prevCursor: page.prev_cursor,
          readThroughAt: page.read_through_at,
        },
      });
    } catch (error) {
      const open = get().thread;
      if (
        current(workspaceId, startedAt) &&
        open?.conversationId === conversationId &&
        (!options.background || isNotFound(error))
      )
        set({ thread: { ...open, status: isNotFound(error) ? 'not_found' : 'error' } });
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
    const first = open.items[0];
    const known = open.items.some((i) => i.id === item.id);
    // Older than everything loaded while earlier pages exist: it shows once its page is loaded.
    if (!known && open.hasPrev && first && byPosition(item, first) < 0) return;
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

  const draftOf = (conversationId: string): Draft =>
    get().drafts[conversationId] ?? {
      text: '',
      clientKey: crypto.randomUUID(),
      lastSeenReplyId: null,
    };
  const putDraft = (conversationId: string, draft: Draft) =>
    set((s) => ({ drafts: { ...s.drafts, [conversationId]: draft } }));

  return {
    ...EMPTY,
    setDraftText(conversationId, text) {
      const draft = draftOf(conversationId);
      const thread = get().thread;
      // The newest reply on screen when typing begins is what AC-16 compares against.
      const began = draft.text === '' && text !== '';
      putDraft(conversationId, {
        ...draft,
        text,
        lastSeenReplyId:
          began && thread?.conversationId === conversationId
            ? newestReplyId(thread.items)
            : draft.lastSeenReplyId,
      });
    },
    keepEditing(conversationId, lastSeenReplyId) {
      putDraft(conversationId, { ...draftOf(conversationId), lastSeenReplyId });
    },
    async sendReply(workspaceId, conversationId, options = {}) {
      const draft = draftOf(conversationId);
      if (get().workspaceId !== workspaceId) return { kind: 'failed' };
      if (!canSendReply(draft.text)) return { kind: 'invalid' };
      if (sending.has(conversationId)) return { kind: 'busy' };
      sending.add(conversationId);
      const startedAt = epoch;
      try {
        const sent = await source.sendReply(workspaceId, conversationId, {
          client_key: draft.clientKey,
          body: draft.text.trim(),
          last_seen_reply_id: draft.lastSeenReplyId,
          ...(options.confirmTeammate ? { confirm_teammate_reply: true } : {}),
        });
        if (!current(workspaceId, startedAt) || sent.workspace_id !== workspaceId)
          return { kind: 'failed' };
        const open = get().thread;
        const items =
          open?.conversationId === conversationId ? upsertItem(open.items, sent) : undefined;
        if (open && items) set({ thread: { ...open, items } });
        putDraft(conversationId, {
          text: '',
          clientKey: crypto.randomUUID(),
          lastSeenReplyId: newestReplyId(items) ?? sent.id,
        });
        return { kind: 'sent' };
      } catch (error) {
        if (!current(workspaceId, startedAt)) return { kind: 'failed' };
        if (error instanceof ApiError) {
          const envelope = (code: string) => ({
            error: { code, message: '', details: error.details },
          });
          if (error.code === 'TEAMMATE_REPLIED') {
            const parsed = TeammateRepliedError.safeParse(envelope(error.code));
            if (parsed.success) {
              const { reply } = parsed.data.error.details;
              return {
                kind: 'teammate',
                reply: {
                  id: reply.id,
                  displayName: reply.author.display_name,
                  positionAt: reply.position_at,
                },
              };
            }
          } else if (error.code === 'REPLY_LIMIT_REACHED') {
            const parsed = ReplyLimitReachedError.safeParse(envelope(error.code));
            if (parsed.success)
              return { kind: 'limited', retryAt: parsed.data.error.details.retry_at };
          } else if (error.code === 'BOT_CANNOT_REPLY') {
            const parsed = BotCannotReplyError.safeParse(envelope(error.code));
            if (parsed.success && parsed.data.error.details.bot.workspace_id === workspaceId)
              set({ bot: parsed.data.error.details.bot });
            else void loadBot(workspaceId);
            return { kind: 'unavailable' };
          } else if (error.status === 400 && error.code === 'VALIDATION_ERROR')
            return { kind: 'rejected', message: error.message };
        }
        return { kind: 'failed' };
      } finally {
        sending.delete(conversationId);
      }
    },
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
      const row = get().conversations.find((c) => c.id === conversationId);
      set({
        thread: {
          conversationId,
          status: 'loading',
          contact: row?.contact ?? null,
          older: 'idle',
          items: [],
          hasPrev: false,
          prevCursor: null,
          readThroughAt: null,
        },
      });
      const startedAt = epoch;
      void Promise.resolve()
        .then(() => source.getConversation(workspaceId, conversationId))
        .then((summary) => {
          const open = get().thread;
          if (
            !summary ||
            !current(workspaceId, startedAt) ||
            summary.workspace_id !== workspaceId ||
            open?.conversationId !== conversationId
          )
            return;
          set({ thread: { ...open, contact: summary.contact } });
        })
        .catch((error: unknown) => {
          const open = get().thread;
          if (
            isNotFound(error) &&
            current(workspaceId, startedAt) &&
            open?.conversationId === conversationId
          )
            set({ thread: { ...open, status: 'not_found' } });
        });
      await loadThread(workspaceId, conversationId, { background: false });
    },
    async loadOlder(workspaceId, conversationId) {
      const open = get().thread;
      if (
        get().workspaceId !== workspaceId ||
        open?.conversationId !== conversationId ||
        open.status !== 'ready' ||
        !open.hasPrev ||
        !open.prevCursor ||
        open.older === 'loading'
      )
        return;
      const startedAt = epoch;
      set({ thread: { ...open, older: 'loading' } });
      try {
        const page = await source.listThreadItems(
          workspaceId,
          conversationId,
          { before: open.prevCursor, limit: PAGE_SIZE },
          {},
        );
        const now = get().thread;
        if (
          !current(workspaceId, startedAt) ||
          page.workspace_id !== workspaceId ||
          now?.conversationId !== conversationId
        )
          return;
        const known = new Set(now.items.map((i) => i.id));
        set({
          thread: {
            ...now,
            older: 'idle',
            items: [...page.items.filter((i) => !known.has(i.id)), ...now.items].sort(byPosition),
            hasPrev: page.has_prev,
            prevCursor: page.prev_cursor,
          },
        });
      } catch {
        const now = get().thread;
        if (current(workspaceId, startedAt) && now?.conversationId === conversationId)
          set({ thread: { ...now, older: 'error' } });
      }
    },
    closeThread: () => set({ thread: null }),
  };
});

// Workspace switch, access removed and sign-out change the current workspace: drop the inbox
// (and its socket) synchronously, before any component re-renders.
useWorkspaceStore.subscribe((state, prev) => {
  if (state.current?.id !== prev.current?.id) useInboxStore.getState().leave();
});
