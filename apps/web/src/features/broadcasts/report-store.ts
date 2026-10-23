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
import { serialRead } from './serial-read';

export type Phase = 'idle' | 'loading' | 'ready' | 'error' | 'not_found';
export type MoreStatus = 'idle' | 'loading' | 'error';

export interface RecipientsState {
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
  /** Re-reads on `report` / `status` of the open broadcast, `resync` and reconnects. */
  watch: (workspaceId: string, guard: GuardFn) => () => void;
  close: () => void;
}

const EMPTY: RecipientsState = { items: [], hasNext: false, nextCursor: null, more: 'idle' };

const isGuardAnswer = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);
const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;

const recipientsOf = (page: BroadcastRecipientPage): RecipientsState => ({
  items: page.items,
  hasNext: page.has_next,
  nextCursor: page.next_cursor,
  more: 'idle',
});

export const useBroadcastReportStore = create<ReportState>()((set, get) => {
  /** Counts every opening and filter change: late answers of an earlier one are dropped. */
  let epoch = 0;
  let reread: { key: string; run: () => Promise<void> } | null = null;

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
          const { filter, recipients } = get();
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
            set({
              status: 'ready',
              broadcast,
              recipients: { ...recipientsOf(page), items },
            });
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
    try {
      const page = await listBroadcastRecipients(workspaceId, broadcastId, filterOf(filter), {});
      if (opened === epoch) set({ recipients: recipientsOf(page) });
    } catch (error) {
      if (opened !== epoch) return;
      if (isGuardAnswer(error)) guard(error, workspaceId);
      set({ status: 'error' });
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
        if (opened === epoch) set({ status: 'ready', broadcast, recipients: recipientsOf(page) });
      } catch (error) {
        if (opened !== epoch) return;
        if (isGuardAnswer(error)) guard(error, workspaceId);
        set({ status: isNotFound(error) ? 'not_found' : 'error' });
      }
    },
    async setFilter(filter, guard) {
      const { workspaceId, broadcastId } = get();
      if (!workspaceId || !broadcastId) return;
      set({ filter, recipients: EMPTY });
      await readPage(workspaceId, broadcastId, filter, guard);
    },
    async showMore(guard) {
      const { workspaceId, broadcastId, filter, recipients } = get();
      if (!workspaceId || !broadcastId || !recipients.nextCursor || recipients.more === 'loading')
        return;
      const opened = epoch;
      set({ recipients: { ...recipients, more: 'loading' } });
      try {
        const page = await listBroadcastRecipients(
          workspaceId,
          broadcastId,
          { ...filterOf(filter), after: recipients.nextCursor },
          {},
        );
        if (opened !== epoch) return;
        set({
          recipients: { ...recipientsOf(page), items: [...get().recipients.items, ...page.items] },
        });
      } catch (error) {
        if (opened !== epoch) return;
        if (isGuardAnswer(error)) guard(error, workspaceId);
        set({ recipients: { ...get().recipients, more: 'error' } });
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
