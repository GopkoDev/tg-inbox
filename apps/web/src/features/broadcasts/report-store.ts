import type {
  Broadcast,
  BroadcastRecipient,
  BroadcastRecipientPage,
  LiveFrame,
  RecipientState,
} from '@tg/shared';
import { create } from 'zustand';
import type { GuardFn } from '@/features/workspaces/guard';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { subscribeLive } from '@/shared/api/live-connection';
import { getBroadcast, listBroadcastRecipients } from './api';
import { serialRead } from '@/shared/lib/serial-read';

export type Phase = 'idle' | 'loading' | 'ready' | 'error' | 'not_found';
export type MoreStatus = 'idle' | 'loading' | 'error';

export interface RecipientsState {
  /** The current filter's first page: loading (skeleton rows), shown, or failed (Retry in the report). */
  status: 'loading' | 'ready' | 'error';
  items: BroadcastRecipient[];
  hasNext: boolean;
  nextCursor: string | null;
  more: MoreStatus;
}

interface ReportState {
  workspaceId: string | null;
  broadcastId: string | null;
  status: Phase;
  /** The broadcast with its totals (SCR-28); a draft answer is shown by the editor instead. */
  broadcast: Broadcast | null;
  /** The outcome filter; null = all recipients. */
  filter: RecipientState | null;
  recipients: RecipientsState;
  open: (workspaceId: string, broadcastId: string, guard: GuardFn) => Promise<void>;
  setFilter: (filter: RecipientState | null, guard: GuardFn) => Promise<void>;
  /** The next 50 recipients of the current filter (Show more). */
  showMore: (guard: GuardFn) => Promise<void>;
  /** Reads the current filter's first page again (the report's Retry). */
  retryRecipients: (guard: GuardFn) => Promise<void>;
  /** Re-reads on `report` / `status` of the open broadcast, `resync` and reconnects. */
  watch: (workspaceId: string, guard: GuardFn) => () => void;
  close: () => void;
}

const EMPTY: RecipientsState = {
  status: 'loading',
  items: [],
  hasNext: false,
  nextCursor: null,
  more: 'idle',
};

const isGuardAnswer = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);
const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;

const recipientsOf = (page: BroadcastRecipientPage): RecipientsState => ({
  status: 'ready',
  items: page.items,
  hasNext: page.has_next,
  nextCursor: page.next_cursor,
  more: 'idle',
});

export const useBroadcastReportStore = create<ReportState>()((set, get) => {
  /** Counts every opening and filter change: late answers of an earlier one are dropped. */
  let epoch = 0;
  let reread: { key: string; run: () => Promise<void> } | null = null;
  /** Counts every replacement of the recipients: a Show more answer for an older list is dropped. */
  let listSeq = 0;
  /** A re-read asked for while Show more was in flight runs after it. */
  let rereadWaits = false;

  /** Sets the recipients as a new list (not an appended page). */
  const replaceRecipients = (recipients: RecipientsState, more: Partial<ReportState> = {}) => {
    listSeq++;
    set({ ...more, recipients });
  };

  const shows = (workspaceId: string, broadcastId?: string) =>
    get().workspaceId === workspaceId && (!broadcastId || get().broadcastId === broadcastId);
  const filterOf = (filter: RecipientState | null) => (filter ? { state: filter } : {});

  /**
   * The broadcast and the recipients shown so far (as many pages as are open), re-read in the
   * background one fetch at a time; a failure keeps what is shown.
   */
  const rereadOf = (workspaceId: string, broadcastId: string, guard: GuardFn) => {
    const key = `${workspaceId}:${broadcastId}`;
    if (reread?.key !== key) {
      reread = {
        key,
        run: serialRead(async () => {
          const opened = epoch;
          const seq = listSeq;
          const { filter, recipients } = get();
          if (recipients.more === 'loading') {
            rereadWaits = true;
            return;
          }
          const pages = Math.max(1, Math.ceil(recipients.items.length / 50));
          try {
            const broadcast = await getBroadcast(workspaceId, broadcastId, { background: true });
            const items: BroadcastRecipient[] = [];
            let page: BroadcastRecipientPage | null = null;
            for (let i = 0; i < pages && (i === 0 || page?.next_cursor); i++) {
              page = await listBroadcastRecipients(
                workspaceId,
                broadcastId,
                { ...filterOf(filter), ...(page?.next_cursor && { after: page.next_cursor }) },
                { background: true },
              );
              items.push(...page.items);
            }
            if (opened !== epoch || !shows(workspaceId, broadcastId) || !page) return;
            if (seq !== listSeq) {
              // A Show more started meanwhile wins: this answer is dropped and read again after it.
              if (get().recipients.more === 'loading') rereadWaits = true;
              else void reread?.run(); // Show more has already landed: queue one more read now
              return;
            }
            replaceRecipients({ ...recipientsOf(page), items }, { status: 'ready', broadcast });
          } catch (error) {
            if (isGuardAnswer(error)) guard(error, workspaceId);
          }
        }),
      };
    }
    return reread.run;
  };

  const onFrame = (workspaceId: string, guard: GuardFn, frame: LiveFrame) => {
    const broadcastId = get().broadcastId;
    if (frame.workspace_id !== workspaceId || !broadcastId || !shows(workspaceId)) return;
    if (
      (frame.type === 'broadcast.changed' &&
        frame.broadcast_id === broadcastId &&
        (frame.change === 'report' || frame.change === 'status')) ||
      frame.type === 'resync'
    ) {
      void rereadOf(workspaceId, broadcastId, guard)();
    }
  };

  const readPage = async (
    workspaceId: string,
    broadcastId: string,
    filter: RecipientState | null,
    guard: GuardFn,
  ) => {
    const opened = ++epoch;
    replaceRecipients(EMPTY);
    try {
      const page = await listBroadcastRecipients(workspaceId, broadcastId, filterOf(filter), {});
      if (opened === epoch) replaceRecipients(recipientsOf(page));
    } catch (error) {
      if (opened !== epoch) return;
      if (isGuardAnswer(error)) guard(error, workspaceId);
      // The page stays; the report says it and offers Retry for this filter.
      replaceRecipients({ ...EMPTY, status: 'error' });
    }
  };

  return {
    workspaceId: null,
    broadcastId: null,
    status: 'idle',
    broadcast: null,
    filter: null,
    recipients: EMPTY,
    async open(workspaceId, broadcastId, guard) {
      const opened = ++epoch;
      reread = null;
      rereadWaits = false;
      listSeq++;
      set({
        workspaceId,
        broadcastId,
        status: 'loading',
        broadcast: null,
        filter: null,
        recipients: EMPTY,
      });
      try {
        const [broadcast, page] = await Promise.all([
          getBroadcast(workspaceId, broadcastId, {}),
          listBroadcastRecipients(workspaceId, broadcastId, {}, {}),
        ]);
        if (opened === epoch) replaceRecipients(recipientsOf(page), { status: 'ready', broadcast });
      } catch (error) {
        if (opened !== epoch) return;
        if (isGuardAnswer(error)) guard(error, workspaceId);
        set({ status: isNotFound(error) ? 'not_found' : 'error' });
      }
    },
    async setFilter(filter, guard) {
      const { workspaceId, broadcastId } = get();
      if (!workspaceId || !broadcastId) return;
      set({ filter });
      await readPage(workspaceId, broadcastId, filter, guard);
    },
    async retryRecipients(guard) {
      const { workspaceId, broadcastId, filter } = get();
      if (!workspaceId || !broadcastId) return;
      await readPage(workspaceId, broadcastId, filter, guard);
    },
    async showMore(guard) {
      const { workspaceId, broadcastId, filter, recipients } = get();
      if (!workspaceId || !broadcastId || !recipients.nextCursor || recipients.more === 'loading')
        return;
      const opened = epoch;
      // Show more wins over a background re-read in flight: its answer is dropped (it runs again).
      const seq = ++listSeq;
      set({ recipients: { ...recipients, more: 'loading' } });
      try {
        const page = await listBroadcastRecipients(
          workspaceId,
          broadcastId,
          { ...filterOf(filter), after: recipients.nextCursor },
          {},
        );
        if (opened !== epoch || seq !== listSeq) return;
        const items = get().recipients.items;
        const shown = new Set(items.map((r) => r.id));
        set({
          recipients: {
            ...recipientsOf(page),
            items: [...items, ...page.items.filter((r) => !shown.has(r.id))],
          },
        });
      } catch (error) {
        if (opened !== epoch || seq !== listSeq) return;
        if (isGuardAnswer(error)) guard(error, workspaceId);
        set({ recipients: { ...get().recipients, more: 'error' } });
      } finally {
        if (opened === epoch && rereadWaits && shows(workspaceId, broadcastId)) {
          rereadWaits = false;
          void rereadOf(workspaceId, broadcastId, guard)();
        }
      }
    },
    watch(workspaceId, guard) {
      const again = () => {
        const broadcastId = get().broadcastId;
        if (broadcastId && shows(workspaceId)) void rereadOf(workspaceId, broadcastId, guard)();
      };
      return subscribeLive(workspaceId, {
        onFrame: (frame) => onFrame(workspaceId, guard, frame),
        onReconnected: again,
        onInvalidFrame: again,
        onClosed: () => undefined, // the shell and the next request decide
      });
    },
    close() {
      epoch++;
      reread = null;
      rereadWaits = false;
      set({
        workspaceId: null,
        broadcastId: null,
        status: 'idle',
        broadcast: null,
        filter: null,
        recipients: EMPTY,
      });
    },
  };
});

useWorkspaceStore.subscribe((state, prev) => {
  if (state.current?.id !== prev.current?.id) useBroadcastReportStore.getState().close();
});
