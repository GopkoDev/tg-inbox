import type {
  ContactSummary,
  Conversation,
  ConversationStateChange,
  ConversationSummary,
  InboxBotStatus,
  LiveFrame,
  ThreadActivity,
  ThreadItem,
  ThreadMessage,
  ThreadPage,
  ThreadReply,
} from '@tg/shared';
import { create } from 'zustand';
import { useAuthStore } from '@/features/auth/store';
import { useWorkspaceStore } from '@/features/workspaces/store';
import {
  AssigneeNotActiveError,
  BotCannotReplyError,
  ChangeLimitReachedError,
  CloseNeedsConfirmationError,
  ConversationStateChangedError,
  ReplyLimitReachedError,
  ReplyNotResendableError,
  TeammateRepliedError,
} from '@tg/shared';
import { ApiError } from '@/shared/api/client';
import { openLiveSocket, type LiveClient } from '@/shared/api/realtime';
import * as source from './api-source';
import { belongsToLens, DEFAULT_LENS, sameLens, type InboxLens } from './lens';
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
  /**
   * The conversation's last summary read or answered: its state version and close snapshot are
   * what the change requests send (sad.md §4). Replaced by every later answer and refusal.
   */
  summary?: ConversationSummary | null;
  older: OlderStatus;
  items: ThreadItem[];
  hasPrev: boolean;
  prevCursor: string | null;
  readThroughAt: string | null;
  /**
   * The newest reply of the whole conversation (the page's `newest_reply_id`, then live replies),
   * which may sit on a page not loaded yet; `undefined` = unknown, the loaded items decide.
   */
  newestReplyId?: string | null;
  /**
   * The newest item shown that came from a thread page (not placed live); a background re-read
   * of the latest page merges only when it reaches back to it, so no gap is left unloadable.
   */
  pagedNewest?: ThreadItem | null;
}

/** What the reply box of one conversation keeps for this tab (sad.md §4). */
export interface Draft {
  text: string;
  clientKey: string;
  lastSeenReplyId: string | null;
  /** The body last sent with `clientKey`: only an identical retry may reuse the key. */
  attemptedBody?: string | null;
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

/** How a `resendReply` attempt ended; ReplyDeliveryState maps each to a state of SCR-02 / SCR-05. */
export type ResendResult =
  | { kind: 'sent' }
  | { kind: 'busy' }
  | { kind: 'redrawn' }
  | { kind: 'confirmation_required' }
  | { kind: 'limited'; retryAt: string }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

/** How a change action ended; the actions bar maps each to a state of SCR-02 / SCR-10..13. */
export type ChangeResult =
  | { kind: 'recorded' | 'unchanged'; change: ConversationStateChange }
  | { kind: 'stale'; latestChange: ThreadActivity | null }
  | {
      kind: 'needs_confirmation';
      reasons: CloseNeedsConfirmationReason[];
      staleChange: ThreadActivity | null;
      newestUnreadMessage: { id: string; received_at: string } | null;
    }
  | { kind: 'assignee_not_active' }
  | { kind: 'limited'; retryAt: string }
  | { kind: 'busy' }
  | { kind: 'not_found' }
  | { kind: 'access_removed' }
  | { kind: 'failed' };
type CloseNeedsConfirmationReason = ReturnType<
  typeof CloseNeedsConfirmationError.parse
>['error']['details']['reasons'][number];

/**
 * The inbox of ONE workspace (`workspaceId`), shared by SCR-01..05. Entering another workspace
 * resets everything and closes the socket synchronously; every answer or frame tagged with any
 * other workspace id is dropped, so no conversation of one workspace is ever drawn in another.
 */
interface InboxState {
  workspaceId: string | null;
  listStatus: ListStatus;
  conversations: Conversation[];
  /** The status and assignee lenses the list shows (they mirror the page address). */
  lens: InboxLens;
  /** A search is on: the status lens is set aside when a row's place is re-evaluated. */
  searching: boolean;
  hasNext: boolean;
  nextCursor: string | null;
  /**
   * Bumped each time the first list page is (re-)read: pages loaded beyond it belong to the old
   * order, so the list restarts paging from the new `nextCursor`.
   */
  listVersion: number;
  bot: InboxBotStatus | null;
  thread: OpenThread | null;
  /** Reply drafts of this tab, by conversation id. */
  drafts: Record<string, Draft>;
  live: LiveStatus;
  /** A 401/403 any inbox request got: the shared guard (`handleGuardError`) decides what it means. */
  guardError: ApiError | null;
  /** Hands a 401/403 of a call made for `workspaceId` (still the current one) to the guard. */
  reportGuard: (error: unknown, workspaceId: string) => boolean;
  setDraftText: (conversationId: string, text: string) => void;
  keepEditing: (conversationId: string, lastSeenReplyId: string) => void;
  sendReply: (
    workspaceId: string,
    conversationId: string,
    options?: { confirmTeammate?: boolean },
  ) => Promise<SendResult>;
  resendReply: (
    workspaceId: string,
    conversationId: string,
    replyId: string,
    options?: { confirmDuplicateRisk?: boolean },
  ) => Promise<ResendResult>;
  /** Switches the list to other lenses (the address changed); an open thread stays open. */
  setLens: (workspaceId: string, lens: InboxLens) => Promise<void>;
  setSearching: (searching: boolean) => void;
  assign: (
    workspaceId: string,
    conversationId: string,
    assigneeAccountId: string,
  ) => Promise<ChangeResult>;
  unassign: (workspaceId: string, conversationId: string) => Promise<ChangeResult>;
  close: (
    workspaceId: string,
    conversationId: string,
    options?: { confirm?: boolean },
  ) => Promise<ChangeResult>;
  reopen: (workspaceId: string, conversationId: string) => Promise<ChangeResult>;
  enter: (workspaceId: string, lens?: InboxLens) => Promise<void>;
  leave: () => void;
  openThread: (workspaceId: string, conversationId: string) => Promise<void>;
  loadOlder: (workspaceId: string, conversationId: string) => Promise<void>;
  closeThread: () => void;
}

const EMPTY: Omit<
  InboxState,
  | 'enter'
  | 'setLens'
  | 'setSearching'
  | 'assign'
  | 'unassign'
  | 'close'
  | 'reopen'
  | 'leave'
  | 'openThread'
  | 'loadOlder'
  | 'closeThread'
  | 'setDraftText'
  | 'keepEditing'
  | 'sendReply'
  | 'resendReply'
  | 'reportGuard'
> = {
  workspaceId: null,
  listStatus: 'loading',
  conversations: [],
  lens: DEFAULT_LENS,
  searching: false,
  hasNext: false,
  nextCursor: null,
  listVersion: 0,
  bot: null,
  thread: null,
  drafts: {},
  live: 'idle',
  guardError: null,
};

let client: LiveClient | null = null;
/** Conversations with a `sendReply` in flight: a second Enter is ignored. */
const sending = new Set<string>();
/** Conversations with a state change in flight: one at a time. */
const changing = new Set<string>();
/** Bumped by every foreground list load: an answer of an earlier one is stale. */
let listSeq = 0;
const newestReplyId = (items: ThreadItem[] | undefined): string | null =>
  items?.filter((i) => i.type === 'reply').at(-1)?.id ?? null;
const newestSeen = (thread: OpenThread): string | null =>
  thread.newestReplyId !== undefined ? thread.newestReplyId : newestReplyId(thread.items);
const isGuardAnswer = (error: unknown): error is ApiError =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);
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

/**
 * A re-read first page merged into what is shown: page rows win unless the shown row is newer;
 * a shown row sorting below the page's last row is a stale copy (later pages load it afresh).
 */
function mergeConversations(list: Conversation[], page: readonly Conversation[]): Conversation[] {
  const sorted = [...page].sort(byActivity);
  const first = sorted[0];
  const last = sorted.at(-1);
  // A shown row inside the page's span that the page lacks has left the lenses; one newer than
  // the page's first row arrived live after the read.
  const kept =
    first && last
      ? list.filter(
          (c) =>
            byActivity(c, last) <= 0 &&
            (byActivity(c, first) < 0 || page.some((p) => p.id === c.id)),
        )
      : list;
  const byId = new Map(kept.map((c) => [c.id, c]));
  for (const row of page) {
    const shown = byId.get(row.id);
    if (!shown || shown.last_activity_at <= row.last_activity_at) byId.set(row.id, row);
  }
  return [...byId.values()].sort(byActivity);
}

/** A newly placed reply that is the last reply shown becomes the newest one seen. */
function newestAfter(
  thread: OpenThread,
  items: ThreadItem[],
  item: ThreadItem,
): string | null | undefined {
  if (item.type !== 'reply') return thread.newestReplyId;
  return newestReplyId(items) === item.id ? item.id : thread.newestReplyId;
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
    changing.clear();
    set({ ...EMPTY });
  };

  /** Hands a session-ended / access-removed answer to the guard (InboxPage), whatever call got it. */
  const noteGuard = (error: unknown, workspaceId: string, startedAt: number) => {
    if (isGuardAnswer(error) && current(workspaceId, startedAt)) set({ guardError: error });
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
    const lens = get().lens;
    const seq = options.background ? listSeq : ++listSeq;
    try {
      const page = await source.listConversations(
        workspaceId,
        { limit: PAGE_SIZE, status: lens.status, assignee: lens.assignee },
        options.background ? BACKGROUND : {},
      );
      if (
        !current(workspaceId, startedAt) ||
        page.workspace_id !== workspaceId ||
        // a late answer for lenses already left, or a page that is not for the lenses asked
        !sameLens(get().lens, lens) ||
        page.lens.status !== lens.status ||
        page.lens.assignee !== lens.assignee ||
        (!options.background && seq !== listSeq)
      )
        return;
      set((s) => ({
        conversations: options.background
          ? mergeConversations(s.conversations, page.items)
          : [...page.items].sort(byActivity),
        hasNext: page.has_next,
        nextCursor: page.next_cursor,
        listVersion: s.listVersion + 1,
        listStatus: 'ready',
      }));
    } catch (error) {
      noteGuard(error, workspaceId, startedAt);
      if (
        current(workspaceId, startedAt) &&
        !options.background &&
        sameLens(get().lens, lens) &&
        seq === listSeq
      )
        set({ listStatus: 'error' });
    }
  };

  /**
   * Takes a summary read or answered for the current workspace: the open conversation keeps its
   * version and close snapshot (never an older version), and the row is inserted, updated or
   * dropped by the current lenses. An open thread stays open whatever happens to its row.
   */
  const applySummary = (
    workspaceId: string,
    incoming: ConversationSummary,
    options: { rows: boolean } = { rows: true },
  ) => {
    if (incoming.workspace_id !== workspaceId || get().workspaceId !== workspaceId) return;
    const { close_snapshot: snapshot, ...row } = incoming;
    void snapshot;
    set((s) => {
      const open = s.thread;
      const thread =
        open?.conversationId === incoming.id &&
        (!open.summary || incoming.state_version >= open.summary.state_version)
          ? { ...open, summary: incoming, contact: incoming.contact }
          : open;
      const shown = s.conversations.find((c) => c.id === incoming.id);
      let conversations = s.conversations;
      if (options.rows && (!shown || incoming.state_version >= shown.state_version)) {
        const account = useAuthStore.getState().account?.id ?? null;
        conversations = belongsToLens(row, s.lens, account, s.searching)
          ? upsertConversation(s.conversations, row)
          : s.conversations.filter((c) => c.id !== incoming.id);
      }
      return { thread, conversations };
    });
  };

  const loadSummary = async (workspaceId: string, conversationId: string) => {
    const startedAt = epoch;
    try {
      const summary = await source.getConversation(workspaceId, conversationId, BACKGROUND);
      if (current(workspaceId, startedAt)) applySummary(workspaceId, summary);
    } catch (error) {
      noteGuard(error, workspaceId, startedAt);
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
      const fresh = [...page.items].sort(byPosition);
      const freshNewest = fresh.at(-1) ?? null;
      const paged = open.pagedNewest ?? null;
      // A background re-read merges only when it reaches back to what pages already loaded:
      // earlier loaded pages and newer live items stay. Otherwise the items between would be a
      // hole no cursor reaches, so the page replaces them; shown items from its oldest one on
      // stay (live items the read missed, or newer than it).
      const overlaps =
        !page.has_prev || (fresh[0] !== undefined && paged && byPosition(fresh[0], paged) <= 0);
      const merges = options.background && Boolean(overlaps);
      const items = merges
        ? fresh.reduce((all, item) => upsertItem(all, item), open.items)
        : options.background
          ? [
              ...fresh,
              ...open.items.filter(
                (i) =>
                  fresh[0] !== undefined &&
                  byPosition(i, fresh[0]) >= 0 &&
                  !fresh.some((f) => f.id === i.id),
              ),
            ].sort(byPosition)
          : fresh;
      const keepsEarlier =
        merges &&
        open.items[0] !== undefined &&
        (fresh[0] === undefined || byPosition(open.items[0], fresh[0]) < 0);
      const pagedNewest =
        merges && paged && (!freshNewest || byPosition(paged, freshNewest) > 0)
          ? paged
          : freshNewest;
      const pageNewest =
        page.newest_reply_id !== undefined ? page.newest_reply_id : newestReplyId(fresh);
      set({
        thread: {
          ...open,
          conversationId,
          // a failed summary with no contact to show, or a 404, outlives the page
          status:
            open.status === 'not_found' || (open.status === 'error' && !open.contact)
              ? open.status
              : 'ready',
          older: options.background ? open.older : 'idle',
          items,
          hasPrev: keepsEarlier ? open.hasPrev : page.has_prev,
          prevCursor: keepsEarlier ? open.prevCursor : page.prev_cursor,
          readThroughAt: page.read_through_at,
          newestReplyId: newestOfMerge(pageNewest, open, items),
          pagedNewest,
        },
      });
    } catch (error) {
      noteGuard(error, workspaceId, startedAt);
      const open = get().thread;
      if (
        current(workspaceId, startedAt) &&
        open?.conversationId === conversationId &&
        (!options.background || isNotFound(error))
      )
        set({ thread: { ...open, status: isNotFound(error) ? 'not_found' : 'error' } });
    }
  };

  /** The page's newest reply, unless a reply placed live since is shown after it. */
  const newestOfMerge = (
    pageNewest: string | null,
    open: OpenThread,
    items: ThreadItem[],
  ): string | null => {
    const known = open.newestReplyId;
    if (!known || known === pageNewest) return pageNewest;
    const pos = (rid: string | null) => (rid ? items.findIndex((i) => i.id === rid) : -1);
    return pos(known) > pos(pageNewest) && pos(known) >= 0 ? known : pageNewest;
  };

  /** After a (re)connect or `resync`: the three authoritative re-reads. */
  const rereadAll = (workspaceId: string) => {
    void loadList(workspaceId, { background: true });
    const open = get().thread;
    if (open) {
      void loadThread(workspaceId, open.conversationId, { background: true });
      void loadSummary(workspaceId, open.conversationId);
    }
    void loadBot(workspaceId);
  };

  const refetchRow = (workspaceId: string, conversationId: string) =>
    coalesce(`row:${conversationId}`, async () => {
      const startedAt = epoch;
      const row = await source.getConversation(workspaceId, conversationId, BACKGROUND);
      if (!current(workspaceId, startedAt)) return;
      applySummary(workspaceId, row);
    });

  const mergeItem = (workspaceId: string, item: ThreadMessage | ThreadReply | ThreadActivity) => {
    const open = get().thread;
    if (!open || item.workspace_id !== workspaceId || open.conversationId !== item.conversation_id)
      return;
    const first = open.items[0];
    const known = open.items.some((i) => i.id === item.id);
    // Older than everything loaded while earlier pages exist: it shows once its page is loaded.
    if (!known && open.hasPrev && first && byPosition(item, first) < 0) return;
    const items = upsertItem(open.items, item);
    set({
      thread: {
        ...open,
        items,
        newestReplyId: known ? open.newestReplyId : newestAfter(open, items, item),
      },
    });
  };

  const refetchItem = (
    workspaceId: string,
    conversationId: string,
    item: { type: 'message' | 'reply' | 'activity'; id: string },
    markRead: boolean,
  ) =>
    coalesce(`item:${item.id}`, async () => {
      const startedAt = epoch;
      if (item.type === 'activity') {
        // An entry is immutable: one already shown needs no second read.
        if (get().thread?.items.some((i) => i.id === item.id)) return;
        const entry = await source.getThreadActivity(
          workspaceId,
          conversationId,
          item.id,
          BACKGROUND,
        );
        if (current(workspaceId, startedAt)) mergeItem(workspaceId, entry);
        return;
      }
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
          (change === 'created' && (item?.type === 'message' || item?.type === 'activity')) ||
          (change === 'edited' && (!row || row.last_item.id === item?.id)) ||
          change === 'state';
        if (rowChanges) refetchRow(workspaceId, conversationId);
        return;
      }
    }
  };

  /**
   * One state change of the open conversation, built from the summary on screen. Every answer
   * and every refusal that carries a summary replaces it (version + close snapshot).
   */
  const runChange = async (
    workspaceId: string,
    conversationId: string,
    send: (summary: ConversationSummary) => Promise<ConversationStateChange>,
  ): Promise<ChangeResult> => {
    const open = get().thread;
    const summary = open?.conversationId === conversationId ? open.summary : null;
    if (get().workspaceId !== workspaceId || !summary) return { kind: 'failed' };
    if (changing.has(conversationId)) return { kind: 'busy' };
    changing.add(conversationId);
    const startedAt = epoch;
    try {
      const change = await send(summary);
      if (!current(workspaceId, startedAt) || change.workspace_id !== workspaceId)
        return { kind: 'failed' };
      applySummary(workspaceId, change.conversation);
      if (change.activity) mergeItem(workspaceId, change.activity);
      return { kind: change.outcome, change };
    } catch (error) {
      noteGuard(error, workspaceId, startedAt);
      if (!current(workspaceId, startedAt)) return { kind: 'failed' };
      if (!(error instanceof ApiError)) return { kind: 'failed' };
      const envelope = (code: string) => ({ error: { code, message: '', details: error.details } });
      if (error.status === 403) return { kind: 'access_removed' };
      if (error.status === 404) {
        const now = get().thread;
        if (now?.conversationId === conversationId)
          set({ thread: { ...now, status: 'not_found' } });
        return { kind: 'not_found' };
      }
      if (error.code === 'CONVERSATION_STATE_CHANGED') {
        const parsed = ConversationStateChangedError.safeParse(envelope(error.code));
        if (parsed.success) {
          applySummary(workspaceId, parsed.data.error.details.conversation);
          return { kind: 'stale', latestChange: parsed.data.error.details.latest_change };
        }
      } else if (error.code === 'CLOSE_NEEDS_CONFIRMATION') {
        const parsed = CloseNeedsConfirmationError.safeParse(envelope(error.code));
        if (parsed.success) {
          const details = parsed.data.error.details;
          applySummary(workspaceId, details.conversation);
          return {
            kind: 'needs_confirmation',
            reasons: details.reasons,
            staleChange: details.stale_change,
            newestUnreadMessage: details.newest_unread_message,
          };
        }
      } else if (error.code === 'ASSIGNEE_NOT_ACTIVE') {
        if (AssigneeNotActiveError.safeParse(envelope(error.code)).success)
          return { kind: 'assignee_not_active' };
      } else if (error.code === 'CHANGE_LIMIT_REACHED') {
        const parsed = ChangeLimitReachedError.safeParse(envelope(error.code));
        if (parsed.success) return { kind: 'limited', retryAt: parsed.data.error.details.retry_at };
      }
      return { kind: 'failed' };
    } finally {
      changing.delete(conversationId);
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
    reportGuard(error, workspaceId) {
      if (!isGuardAnswer(error) || get().workspaceId !== workspaceId) return false;
      set({ guardError: error });
      return true;
    },
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
            ? newestSeen(thread)
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
      const body = draft.text.trim();
      // The key stands for one body: an edited draft is a new reply, not a retry of the old one.
      const clientKey =
        draft.attemptedBody != null && draft.attemptedBody !== body
          ? crypto.randomUUID()
          : draft.clientKey;
      putDraft(conversationId, { ...draft, clientKey, attemptedBody: body });
      try {
        const sent = await source.sendReply(workspaceId, conversationId, {
          client_key: clientKey,
          body,
          last_seen_reply_id: draft.lastSeenReplyId,
          ...(options.confirmTeammate ? { confirm_teammate_reply: true } : {}),
        });
        if (!current(workspaceId, startedAt) || sent.workspace_id !== workspaceId)
          return { kind: 'failed' };
        const open = get().thread;
        let lastSeen: string | null = sent.id;
        if (open?.conversationId === conversationId) {
          const items = upsertItem(open.items, sent);
          const thread = { ...open, items, newestReplyId: newestAfter(open, items, sent) };
          set({ thread });
          lastSeen = newestSeen(thread) ?? sent.id;
        }
        putDraft(conversationId, {
          text: '',
          clientKey: crypto.randomUUID(),
          lastSeenReplyId: lastSeen,
          attemptedBody: null,
        });
        return { kind: 'sent' };
      } catch (error) {
        noteGuard(error, workspaceId, startedAt);
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
    async resendReply(workspaceId, conversationId, replyId, options = {}) {
      if (get().workspaceId !== workspaceId) return { kind: 'failed' };
      if (sending.has(replyId)) return { kind: 'busy' };
      sending.add(replyId);
      const startedAt = epoch;
      const place = (reply: ThreadReply) => {
        const open = get().thread;
        if (open?.conversationId !== conversationId) return;
        const items = upsertItem(open.items, reply);
        set({ thread: { ...open, items, newestReplyId: newestAfter(open, items, reply) } });
      };
      try {
        const resent = await source.resendReply(
          workspaceId,
          conversationId,
          replyId,
          options.confirmDuplicateRisk ? { confirm_duplicate_risk: true } : {},
          {},
        );
        if (!current(workspaceId, startedAt) || resent.workspace_id !== workspaceId)
          return { kind: 'failed' };
        place(resent);
        return { kind: 'sent' };
      } catch (error) {
        noteGuard(error, workspaceId, startedAt);
        if (!current(workspaceId, startedAt)) return { kind: 'failed' };
        if (error instanceof ApiError) {
          const envelope = (code: string) => ({
            error: { code, message: '', details: error.details },
          });
          if (error.code === 'REPLY_NOT_RESENDABLE') {
            const parsed = ReplyNotResendableError.safeParse(envelope(error.code));
            if (parsed.success && parsed.data.error.details.reply.workspace_id === workspaceId) {
              place(parsed.data.error.details.reply);
              return { kind: 'redrawn' };
            }
          } else if (error.code === 'DUPLICATE_RISK_CONFIRMATION_REQUIRED')
            return { kind: 'confirmation_required' };
          else if (error.code === 'REPLY_LIMIT_REACHED') {
            const parsed = ReplyLimitReachedError.safeParse(envelope(error.code));
            if (parsed.success)
              return { kind: 'limited', retryAt: parsed.data.error.details.retry_at };
          } else if (error.code === 'BOT_CANNOT_REPLY') {
            const parsed = BotCannotReplyError.safeParse(envelope(error.code));
            if (parsed.success && parsed.data.error.details.bot.workspace_id === workspaceId)
              set({ bot: parsed.data.error.details.bot });
            else void loadBot(workspaceId);
            return { kind: 'unavailable' };
          }
        }
        return { kind: 'failed' };
      } finally {
        sending.delete(replyId);
      }
    },
    async setLens(workspaceId, lens) {
      if (get().workspaceId !== workspaceId || sameLens(get().lens, lens)) return;
      set((s) => ({
        lens,
        listStatus: 'loading',
        conversations: [],
        hasNext: false,
        nextCursor: null,
        listVersion: s.listVersion + 1,
      }));
      await loadList(workspaceId, { background: false });
    },
    setSearching(searching) {
      set((s) => {
        if (s.searching === searching) return s;
        const account = useAuthStore.getState().account?.id ?? null;
        return {
          searching,
          conversations: searching
            ? s.conversations
            : s.conversations.filter((c) => belongsToLens(c, s.lens, account, false)),
        };
      });
    },
    assign: (workspaceId, conversationId, assigneeAccountId) =>
      runChange(workspaceId, conversationId, (summary) =>
        source.assignConversation(
          workspaceId,
          conversationId,
          { assignee_account_id: assigneeAccountId, expected_state_version: summary.state_version },
          {},
        ),
      ),
    unassign: (workspaceId, conversationId) =>
      runChange(workspaceId, conversationId, (summary) =>
        source.unassignConversation(
          workspaceId,
          conversationId,
          { expected_state_version: summary.state_version },
          {},
        ),
      ),
    close: (workspaceId, conversationId, options = {}) =>
      runChange(workspaceId, conversationId, (summary) =>
        source.closeConversation(
          workspaceId,
          conversationId,
          {
            expected_state_version: summary.state_version,
            expected_close_snapshot: summary.close_snapshot,
            confirm_close_reasons: options.confirm === true,
          },
          {},
        ),
      ),
    reopen: (workspaceId, conversationId) =>
      runChange(workspaceId, conversationId, (summary) =>
        source.reopenConversation(
          workspaceId,
          conversationId,
          { expected_state_version: summary.state_version },
          {},
        ),
      ),
    async enter(workspaceId, lens = DEFAULT_LENS) {
      if (get().workspaceId === workspaceId) return;
      reset();
      set({ workspaceId, lens });
      client = openLiveSocket(workspaceId, {
        onFrame: (frame) => onFrame(workspaceId, frame),
        onReconnected: () => rereadAll(workspaceId),
        onInvalidFrame: () => {
          if (get().workspaceId === workspaceId)
            coalesce('resync', async () => rereadAll(workspaceId));
        },
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
          summary: null,
          older: 'idle',
          items: [],
          hasPrev: false,
          prevCursor: null,
          readThroughAt: null,
          newestReplyId: undefined,
          pagedNewest: null,
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
          applySummary(workspaceId, summary, { rows: false });
        })
        .catch((error: unknown) => {
          noteGuard(error, workspaceId, startedAt);
          const open = get().thread;
          if (!current(workspaceId, startedAt) || open?.conversationId !== conversationId) return;
          if (isNotFound(error)) set({ thread: { ...open, status: 'not_found' } });
          // No contact to show in the header: SCR-02 error with Retry, not a skeleton forever.
          else if (!open.contact && open.status !== 'not_found')
            set({ thread: { ...open, status: 'error' } });
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
        // A re-read replaced the items meanwhile: this page belongs to the old region.
        if (now.prevCursor !== open.prevCursor) {
          set({ thread: { ...now, older: 'idle' } });
          return;
        }
        const known = new Set(now.items.map((i) => i.id));
        set({
          thread: {
            ...now,
            older: 'idle',
            items: [...page.items.filter((i) => !known.has(i.id)), ...now.items].sort(byPosition),
            hasPrev: page.has_prev,
            prevCursor: page.prev_cursor,
            pagedNewest: now.pagedNewest ?? page.items.at(-1) ?? null,
            newestReplyId:
              page.newest_reply_id !== undefined && now.newestReplyId === undefined
                ? page.newest_reply_id
                : now.newestReplyId,
          },
        });
      } catch (error) {
        noteGuard(error, workspaceId, startedAt);
        const now = get().thread;
        if (current(workspaceId, startedAt) && now?.conversationId === conversationId)
          set({ thread: { ...now, older: now.prevCursor === open.prevCursor ? 'error' : 'idle' } });
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
