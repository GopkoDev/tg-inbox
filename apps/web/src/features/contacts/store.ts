import type {
  ContactProfile,
  ContactRow,
  ConversationSummary,
  LiveFrame,
  TagFilterMode,
  TagHistoryEntry,
  ThreadItem,
  ThreadPage,
} from '@tg/shared';
import { create } from 'zustand';
import type { GuardFn } from '@/features/workspaces/guard';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { subscribeLive } from '@/shared/api/live-connection';
import { byPosition, upsertItem } from '@/features/inbox/store';
import { listThreadItems } from '@/features/inbox/api-source';
import { getContact, getContactConversation, listContactTagHistory, listContacts } from './api';

// The profile's conversation uses the inbox *reads* only: summary + thread pages. This store never
// imports or calls the mark-read route (ADR-0006, AC-05); store.test.ts pins it.

const BACKGROUND = { background: true } as const;
const PAGE_SIZE = 30;

export type Phase = 'loading' | 'ready' | 'error';
export type MoreStatus = 'idle' | 'loading' | 'error';

/** What the list shows: the search text, the tag filter mode and the chosen tag ids. */
export interface ListQuery {
  q: string;
  mode: TagFilterMode;
  tagIds: string[];
}

export interface ListState {
  /** The query this state answers (a late answer of another query is dropped). */
  key: string;
  status: Phase;
  items: ContactRow[];
  hasNext: boolean;
  nextCursor: string | null;
  matchingCount: number;
  totalCount: number;
  /** Tag ids of the request the workspace no longer has (the page says so and drops them). */
  missingTagIds: string[];
  more: MoreStatus;
}

export interface ContactState {
  contactId: string;
  status: Phase | 'not_found';
  contact: ContactProfile | null;
}

export interface HistoryState {
  contactId: string;
  status: Phase;
  items: TagHistoryEntry[];
  hasNext: boolean;
  nextCursor: string | null;
  more: MoreStatus;
}

export interface ConversationState {
  contactId: string;
  /** The summary read: `none` = the contact has no conversation (404), `error` = it failed. */
  status: Phase | 'none';
  summary: ConversationSummary | null;
  /** The thread pages: read after the summary. */
  items: ThreadItem[];
  thread: Phase;
  hasPrev: boolean;
  prevCursor: string | null;
  older: MoreStatus;
}

export const queryKey = (q: ListQuery) => JSON.stringify([q.q, q.mode, [...q.tagIds]]);

interface ContactsState {
  workspaceId: string | null;
  list: ListState | null;
  /** The open profile (SCR-19): facts + tags, tag history and the conversation. */
  profile: ContactState | null;
  history: HistoryState | null;
  conversation: ConversationState | null;
  /** The contact whose tags the inbox conversation header shows (SCR-02). */
  header: ContactState | null;
  loadList: (
    workspaceId: string,
    query: ListQuery,
    guard: GuardFn,
    options?: { background?: boolean },
  ) => Promise<void>;
  loadMore: (workspaceId: string, guard: GuardFn) => Promise<void>;
  clearList: () => void;
  openProfile: (workspaceId: string, contactId: string, guard: GuardFn) => Promise<void>;
  closeProfile: () => void;
  retryContact: (workspaceId: string, guard: GuardFn) => Promise<void>;
  retryHistory: (workspaceId: string, guard: GuardFn) => Promise<void>;
  loadMoreHistory: (workspaceId: string, guard: GuardFn) => Promise<void>;
  retryConversation: (workspaceId: string, guard: GuardFn) => Promise<void>;
  loadOlder: (workspaceId: string, guard: GuardFn) => Promise<void>;
  openHeader: (workspaceId: string, contactId: string, guard: GuardFn) => Promise<void>;
  closeHeader: () => void;
  /** Re-reads a shown contact (profile and header) in the background, e.g. after `TAG_NOT_FOUND`. */
  rereadContact: (workspaceId: string, contactId: string, guard: GuardFn) => Promise<void>;
  /** Replaces the shown tags with an answer a tag change already carries (SCR-20). */
  applyTags: (contactId: string, tags: ContactProfile['tags']) => void;
  /**
   * Follows the workspace's live frames for whatever is open: `contact.changed`, `tags.changed`,
   * `conversation.changed` of the profile's conversation, `resync` and reconnects. Never marks read.
   */
  watch: (workspaceId: string, guard: GuardFn) => () => void;
  clear: () => void;
}

const isGuardAnswer = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);
const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;

/**
 * The order of one slice's reads: the latest wins, but a superseded success is not lost. An older
 * answer that arrives while a newer read is in flight is held; it shows only when the newest read
 * then fails (or has already failed) and nothing newer was applied. `apply` re-checks that the
 * slice still shows what it read and reports whether it applied.
 */
type Apply = () => boolean | Promise<boolean>;
const readOrder = () => {
  let issued = 0;
  let applied = 0;
  let newestFailed = false;
  let held: { seq: number; apply: Apply } | null = null;
  return {
    begin() {
      newestFailed = false;
      return ++issued;
    },
    /** A success: applied now when it is the newest read (or the newest failed), held otherwise. */
    async succeeded(seq: number, apply: Apply) {
      if (seq <= applied) return;
      if (seq !== issued && !newestFailed) {
        if (!held || seq > held.seq) held = { seq, apply };
        return;
      }
      applied = seq;
      held = null;
      await apply();
    },
    /** A failure: `stale` when a newer read was started, else the held success to show (or null). */
    failed(seq: number): 'stale' | Apply | null {
      if (seq !== issued) return 'stale';
      newestFailed = true;
      const fallback = held && held.seq > applied ? held : null;
      held = null;
      if (!fallback) return null;
      applied = fallback.seq;
      return fallback.apply;
    },
  };
};

export const useContactsStore = create<ContactsState>()((set, get) => {
  /** Counts every list read: a late answer of an earlier read is dropped. */
  let listEpoch = 0;
  /** Counts every profile / header open: late answers of a closed one are dropped. */
  let profileEpoch = 0;
  let headerEpoch = 0;
  /**
   * Order every read of one slice (latest wins): two overlapping background re-reads may answer in
   * reverse order, and the older snapshot must not replace the newer one; a superseded success
   * still shows when the newer read fails.
   */
  const contactOrder = { profile: readOrder(), header: readOrder() };
  const historyOrder = readOrder();
  let historyMoreSeq = 0;
  const summaryOrder = readOrder();
  const itemsOrder = readOrder();

  const here = (workspaceId: string) => get().workspaceId === workspaceId;
  const enter = (workspaceId: string) => {
    if (get().workspaceId === workspaceId) return;
    listEpoch++;
    profileEpoch++;
    headerEpoch++;
    set({
      workspaceId,
      list: null,
      profile: null,
      history: null,
      conversation: null,
      header: null,
    });
  };

  /** A 401 / ACCESS_REMOVED (the guard takes over); true when it was one. */
  const guarded = async (error: unknown, workspaceId: string, guard: GuardFn) => {
    if (!isGuardAnswer(error)) return false;
    try {
      await guard(error, workspaceId);
    } catch {
      // the guard could not resolve; the screen keeps its state
    }
    return true;
  };

  // ───────── the list ─────────

  const readList = async (
    workspaceId: string,
    query: ListQuery,
    guard: GuardFn,
    options: { background?: boolean; after?: string },
  ) => {
    const epoch = ++listEpoch;
    const key = queryKey(query);
    try {
      const page = await listContacts(
        workspaceId,
        {
          q: query.q,
          mode: query.mode,
          tag: query.tagIds,
          ...(options.after ? { after: options.after } : {}),
        },
        options.background ? BACKGROUND : {},
      );
      if (!here(workspaceId) || epoch !== listEpoch || page.workspace_id !== workspaceId) return;
      const open = get().list;
      const known = options.after && open?.key === key ? open.items : [];
      const shown = new Set(known.map((c) => c.id));
      set({
        list: {
          key,
          status: 'ready',
          items: [...known, ...page.items.filter((c) => !shown.has(c.id))],
          hasNext: page.has_next,
          nextCursor: page.next_cursor,
          matchingCount: page.matching_count,
          totalCount: page.total_count,
          missingTagIds: page.missing_tag_ids,
          more: 'idle',
        },
      });
    } catch (error) {
      if (!here(workspaceId) || epoch !== listEpoch) return;
      if (await guarded(error, workspaceId, guard)) return;
      const open = get().list;
      if (options.after && open?.key === key) set({ list: { ...open, more: 'error' } });
      else if (!options.background || open?.key !== key)
        set({
          list: {
            key,
            status: 'error',
            items: [],
            hasNext: false,
            nextCursor: null,
            matchingCount: 0,
            totalCount: 0,
            missingTagIds: [],
            more: 'idle',
          },
        });
      // a failed background re-read keeps the rows shown
    }
  };

  // ───────── one contact (profile and header) ─────────

  const readContact = async (
    workspaceId: string,
    contactId: string,
    guard: GuardFn,
    slice: 'profile' | 'header',
    background: boolean,
  ) => {
    const epoch = slice === 'profile' ? profileEpoch : headerEpoch;
    const order = contactOrder[slice];
    const seq = order.begin();
    const stale = () =>
      !here(workspaceId) ||
      epoch !== (slice === 'profile' ? profileEpoch : headerEpoch) ||
      get()[slice]?.contactId !== contactId;
    try {
      const contact = await getContact(workspaceId, contactId, background ? BACKGROUND : {});
      if (stale() || contact.workspace_id !== workspaceId) return;
      await order.succeeded(seq, () => {
        if (stale()) return false;
        set({ [slice]: { contactId, status: 'ready', contact } });
        return true;
      });
    } catch (error) {
      if (stale()) return;
      const fallback = order.failed(seq);
      if (fallback === 'stale') return;
      if (await guarded(error, workspaceId, guard)) return;
      const open = get()[slice]!;
      if (isNotFound(error)) set({ [slice]: { contactId, status: 'not_found', contact: null } });
      else if (fallback && (await fallback())) return;
      else if (!background || !open.contact)
        set({ [slice]: { ...open, status: open.contact && background ? 'ready' : 'error' } });
      // a failed background re-read keeps what is shown
    }
  };

  const readHistory = async (
    workspaceId: string,
    contactId: string,
    guard: GuardFn,
    options: { background?: boolean; after?: string },
  ) => {
    const epoch = profileEpoch;
    const after = options.after;
    // A first page: the latest read wins. A next page: dropped when a first-page re-read moved the
    // cursor meanwhile (appending it would skip or repeat entries).
    const seq = after ? 0 : historyOrder.begin();
    const more = after ? ++historyMoreSeq : 0;
    const stale = () =>
      !here(workspaceId) || epoch !== profileEpoch || get().history?.contactId !== contactId;
    const moved = () => {
      const open = get().history!;
      if (!after || open.nextCursor === after) return false;
      if (more === historyMoreSeq && open.more === 'loading')
        set({ history: { ...open, more: 'idle' } });
      return true;
    };
    try {
      const page = await listContactTagHistory(
        workspaceId,
        contactId,
        options.after ? { after: options.after } : {},
        options.background ? BACKGROUND : {},
      );
      if (stale() || page.workspace_id !== workspaceId || moved()) return;
      const apply = () => {
        if (stale()) return false;
        const open = get().history!;
        const known = after ? open.items : [];
        const shown = new Set(known.map((e) => e.id));
        set({
          history: {
            contactId,
            status: 'ready',
            items: [...known, ...page.items.filter((e) => !shown.has(e.id))],
            hasNext: page.has_next,
            nextCursor: page.next_cursor,
            // a next page still in flight settles `more` itself
            more: !after && open.more === 'loading' ? 'loading' : 'idle',
          },
        });
        return true;
      };
      if (after) apply();
      else await historyOrder.succeeded(seq, apply);
    } catch (error) {
      if (stale() || moved()) return;
      const fallback = after ? null : historyOrder.failed(seq);
      if (fallback === 'stale') return;
      if (await guarded(error, workspaceId, guard)) return;
      if (fallback && (await fallback())) return;
      const open = get().history!;
      if (after) set({ history: { ...open, more: 'error' } });
      else if (!(options.background && open.status === 'ready'))
        set({ history: { ...open, status: 'error' } });
      // a failed background re-read keeps the entries shown
    }
  };

  // ───────── the profile's conversation (reads only) ─────────

  const readItems = async (
    workspaceId: string,
    contactId: string,
    conversationId: string,
    guard: GuardFn,
    background: boolean,
  ) => {
    const epoch = profileEpoch;
    const seq = itemsOrder.begin();
    const stale = () =>
      !here(workspaceId) ||
      epoch !== profileEpoch ||
      get().conversation?.contactId !== contactId ||
      get().conversation?.summary?.id !== conversationId;
    try {
      const page = await listThreadItems(
        workspaceId,
        conversationId,
        { limit: PAGE_SIZE },
        background ? BACKGROUND : {},
      );
      if (stale() || page.workspace_id !== workspaceId) return;
      await itemsOrder.succeeded(seq, () => {
        if (stale()) return false;
        showItems(page, background);
        return true;
      });
    } catch (error) {
      if (stale()) return;
      const fallback = itemsOrder.failed(seq);
      if (fallback === 'stale') return;
      if (await guarded(error, workspaceId, guard)) return;
      if (fallback && (await fallback())) return;
      const open = get().conversation!;
      if (!(background && open.thread === 'ready'))
        set({ conversation: { ...open, thread: 'error' } });
      // a failed background re-read keeps the items shown
    }
  };

  /** Puts a thread page into the open conversation (merged or replacing, see below). */
  const showItems = (page: ThreadPage, background: boolean) => {
    const open = get().conversation!;
    const fresh = [...page.items].sort(byPosition);
    // A background read merges only when it reaches back to what is shown; otherwise the items
    // between would be a hole no cursor reaches, so the page replaces them.
    const shownNewest = open.items.at(-1);
    const reaches =
      !page.has_prev ||
      open.items.length === 0 ||
      (fresh[0] !== undefined &&
        shownNewest !== undefined &&
        byPosition(fresh[0], shownNewest) <= 0);
    if (background && reaches && open.items.length > 0) {
      const items = fresh.reduce((all, item) => upsertItem(all, item), open.items);
      const keepsEarlier =
        open.items[0] !== undefined &&
        (fresh[0] === undefined || byPosition(open.items[0], fresh[0]) < 0);
      set({
        conversation: {
          ...open,
          thread: 'ready',
          items,
          hasPrev: keepsEarlier ? open.hasPrev : page.has_prev,
          prevCursor: keepsEarlier ? open.prevCursor : page.prev_cursor,
        },
      });
    } else {
      set({
        conversation: {
          ...open,
          thread: 'ready',
          items: fresh,
          hasPrev: page.has_prev,
          prevCursor: page.prev_cursor,
          older: 'idle',
        },
      });
    }
  };

  const readConversation = async (
    workspaceId: string,
    contactId: string,
    guard: GuardFn,
    background: boolean,
  ) => {
    const epoch = profileEpoch;
    const seq = summaryOrder.begin();
    const stale = () =>
      !here(workspaceId) || epoch !== profileEpoch || get().conversation?.contactId !== contactId;
    try {
      const summary = await getContactConversation(
        workspaceId,
        contactId,
        background ? BACKGROUND : {},
      );
      if (stale() || summary.workspace_id !== workspaceId) return;
      await summaryOrder.succeeded(seq, async () => {
        if (stale()) return false;
        const open = get().conversation!;
        const sameConversation = open.summary?.id === summary.id;
        set({
          conversation: {
            ...open,
            status: 'ready',
            summary,
            ...(sameConversation
              ? {}
              : { items: [], thread: 'loading', hasPrev: false, prevCursor: null, older: 'idle' }),
          },
        });
        await readItems(workspaceId, contactId, summary.id, guard, background && sameConversation);
        return true;
      });
    } catch (error) {
      if (stale()) return;
      const fallback = summaryOrder.failed(seq);
      if (fallback === 'stale') return;
      if (await guarded(error, workspaceId, guard)) return;
      const open = get().conversation!;
      if (!isNotFound(error) && fallback && (await fallback())) return;
      if (isNotFound(error)) {
        // 404 for a contact the profile found: «No conversation to show» (contract F-3)
        set({
          conversation: { ...open, status: 'none', summary: null, items: [], thread: 'ready' },
        });
      } else if (!background || !open.summary)
        set({
          conversation: { ...open, status: open.summary && background ? 'ready' : 'error' },
        });
    }
  };

  const blankConversation = (contactId: string): ConversationState => ({
    contactId,
    status: 'loading',
    summary: null,
    items: [],
    thread: 'loading',
    hasPrev: false,
    prevCursor: null,
    older: 'idle',
  });

  /** The re-reads of everything open after a frame the open contact is part of. */
  const rereadContactAndHistory = (workspaceId: string, guard: GuardFn, contactId?: string) => {
    const { profile, header } = get();
    if (profile && (!contactId || profile.contactId === contactId)) {
      void readContact(workspaceId, profile.contactId, guard, 'profile', true);
      if (get().history?.contactId === profile.contactId)
        void readHistory(workspaceId, profile.contactId, guard, { background: true });
    }
    if (header && (!contactId || header.contactId === contactId))
      void readContact(workspaceId, header.contactId, guard, 'header', true);
  };
  const rereadConversation = (workspaceId: string, guard: GuardFn) => {
    const open = get().conversation;
    if (open) void readConversation(workspaceId, open.contactId, guard, true);
  };

  const onFrame = (workspaceId: string, guard: GuardFn, frame: LiveFrame) => {
    if (frame.workspace_id !== workspaceId || !here(workspaceId)) return;
    switch (frame.type) {
      case 'contact.changed':
        rereadContactAndHistory(workspaceId, guard, frame.contact_id);
        return;
      case 'tags.changed':
        rereadContactAndHistory(workspaceId, guard);
        return;
      case 'conversation.changed': {
        const open = get().conversation;
        if (open?.summary?.id === frame.conversation_id) {
          rereadConversation(workspaceId, guard);
          // a captured new Telegram name shows in the header card
          const profile = get().profile;
          if (profile) void readContact(workspaceId, profile.contactId, guard, 'profile', true);
        }
        return;
      }
      case 'resync':
        rereadAll(workspaceId, guard);
        return;
      default:
        return;
    }
  };

  const rereadAll = (workspaceId: string, guard: GuardFn) => {
    rereadContactAndHistory(workspaceId, guard);
    rereadConversation(workspaceId, guard);
  };

  return {
    workspaceId: null,
    list: null,
    profile: null,
    history: null,
    conversation: null,
    header: null,
    async loadList(workspaceId, query, guard, options = {}) {
      enter(workspaceId);
      const key = queryKey(query);
      if (!options.background || get().list?.key !== key) {
        set({
          list: {
            key,
            status: 'loading',
            items: [],
            hasNext: false,
            nextCursor: null,
            matchingCount: 0,
            totalCount: get().list?.totalCount ?? 0,
            missingTagIds: [],
            more: 'idle',
          },
        });
      }
      await readList(workspaceId, query, guard, options);
    },
    async loadMore(workspaceId, guard) {
      const open = get().list;
      if (
        !here(workspaceId) ||
        !open ||
        open.status !== 'ready' ||
        !open.hasNext ||
        !open.nextCursor
      )
        return;
      if (open.more === 'loading') return;
      const query = JSON.parse(open.key) as [string, TagFilterMode, string[]];
      set({ list: { ...open, more: 'loading' } });
      await readList(workspaceId, { q: query[0], mode: query[1], tagIds: query[2] }, guard, {
        after: open.nextCursor,
      });
    },
    clearList() {
      listEpoch++;
      set({ list: null });
    },
    async openProfile(workspaceId, contactId, guard) {
      enter(workspaceId);
      profileEpoch++;
      set({
        profile: { contactId, status: 'loading', contact: null },
        history: {
          contactId,
          status: 'loading',
          items: [],
          hasNext: false,
          nextCursor: null,
          more: 'idle',
        },
        conversation: blankConversation(contactId),
      });
      await Promise.all([
        readContact(workspaceId, contactId, guard, 'profile', false),
        readHistory(workspaceId, contactId, guard, {}),
        readConversation(workspaceId, contactId, guard, false),
      ]);
    },
    closeProfile() {
      profileEpoch++;
      set({ profile: null, history: null, conversation: null });
    },
    async retryContact(workspaceId, guard) {
      const open = get().profile;
      if (!open || !here(workspaceId)) return;
      set({ profile: { ...open, status: 'loading' } });
      await readContact(workspaceId, open.contactId, guard, 'profile', false);
    },
    async retryHistory(workspaceId, guard) {
      const open = get().history;
      if (!open || !here(workspaceId)) return;
      set({ history: { ...open, status: 'loading', items: [] } });
      await readHistory(workspaceId, open.contactId, guard, {});
    },
    async loadMoreHistory(workspaceId, guard) {
      const open = get().history;
      if (!open || !here(workspaceId) || !open.hasNext || !open.nextCursor) return;
      if (open.status !== 'ready' || open.more === 'loading') return;
      set({ history: { ...open, more: 'loading' } });
      await readHistory(workspaceId, open.contactId, guard, { after: open.nextCursor });
    },
    async retryConversation(workspaceId, guard) {
      const open = get().conversation;
      if (!open || !here(workspaceId)) return;
      set({ conversation: blankConversation(open.contactId) });
      await readConversation(workspaceId, open.contactId, guard, false);
    },
    async loadOlder(workspaceId, guard) {
      const open = get().conversation;
      const conversationId = open?.summary?.id;
      if (
        !open ||
        !conversationId ||
        !here(workspaceId) ||
        open.thread !== 'ready' ||
        !open.hasPrev ||
        !open.prevCursor ||
        open.older === 'loading'
      )
        return;
      const epoch = profileEpoch;
      set({ conversation: { ...open, older: 'loading' } });
      try {
        const page = await listThreadItems(workspaceId, conversationId, {
          before: open.prevCursor,
          limit: PAGE_SIZE,
        });
        const now = get().conversation;
        if (
          !here(workspaceId) ||
          epoch !== profileEpoch ||
          !now ||
          now.summary?.id !== conversationId ||
          page.workspace_id !== workspaceId
        )
          return;
        // A re-read replaced the items meanwhile: this page belongs to the old region.
        if (now.prevCursor !== open.prevCursor) {
          set({ conversation: { ...now, older: 'idle' } });
          return;
        }
        const known = new Set(now.items.map((i) => i.id));
        set({
          conversation: {
            ...now,
            older: 'idle',
            items: [...page.items.filter((i) => !known.has(i.id)), ...now.items].sort(byPosition),
            hasPrev: page.has_prev,
            prevCursor: page.prev_cursor,
          },
        });
      } catch (error) {
        const now = get().conversation;
        if (!here(workspaceId) || epoch !== profileEpoch || !now) return;
        if (await guarded(error, workspaceId, guard)) return;
        set({
          conversation: { ...now, older: now.prevCursor === open.prevCursor ? 'error' : 'idle' },
        });
      }
    },
    async openHeader(workspaceId, contactId, guard) {
      enter(workspaceId);
      headerEpoch++;
      set({ header: { contactId, status: 'loading', contact: null } });
      await readContact(workspaceId, contactId, guard, 'header', false);
    },
    closeHeader() {
      headerEpoch++;
      set({ header: null });
    },
    async rereadContact(workspaceId, contactId, guard) {
      if (!here(workspaceId)) return;
      const reads: Promise<void>[] = [];
      for (const slice of ['profile', 'header'] as const)
        if (get()[slice]?.contactId === contactId)
          reads.push(readContact(workspaceId, contactId, guard, slice, true));
      await Promise.all(reads);
    },
    applyTags(contactId, tags) {
      for (const slice of ['profile', 'header'] as const) {
        const open = get()[slice];
        if (open?.contactId === contactId && open.contact)
          set({ [slice]: { ...open, contact: { ...open.contact, tags } } });
      }
    },
    watch(workspaceId, guard) {
      return subscribeLive(workspaceId, {
        onFrame: (frame) => onFrame(workspaceId, guard, frame),
        onReconnected: () => here(workspaceId) && rereadAll(workspaceId, guard),
        onInvalidFrame: () => here(workspaceId) && rereadAll(workspaceId, guard),
        onClosed: () => undefined, // the shell and the next request decide
      });
    },
    clear() {
      listEpoch++;
      profileEpoch++;
      headerEpoch++;
      set({
        workspaceId: null,
        list: null,
        profile: null,
        history: null,
        conversation: null,
        header: null,
      });
    },
  };
});

// Workspace switch, access removed and sign-out all change the current workspace: drop its state.
useWorkspaceStore.subscribe((state, prev) => {
  if (state.current?.id !== prev.current?.id) useContactsStore.getState().clear();
});
