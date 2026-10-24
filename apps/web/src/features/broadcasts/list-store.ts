import type { BroadcastListItem, LiveFrame } from '@tg/shared';
import { create } from 'zustand';
import type { GuardFn } from '@/features/workspaces/guard';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { subscribeLive } from '@/shared/api/live-connection';
import { listBroadcasts } from './api';
import { serialRead } from '@/shared/lib/serial-read';

export type Phase = 'idle' | 'loading' | 'ready' | 'error';

interface BroadcastListState {
  workspaceId: string | null;
  status: Phase;
  /** Most recently changed first (the server's order). */
  items: BroadcastListItem[];
  /** The first read of the list (SCR-24); a 401 / 403 goes to the guard. */
  load: (workspaceId: string, guard: GuardFn) => Promise<void>;
  /** Re-reads on every `broadcast.changed` of the workspace, `resync` and reconnects. */
  watch: (workspaceId: string, guard: GuardFn) => () => void;
  /** A background re-read after an own change (a delete from the list); what is shown stays meanwhile. */
  reread: (workspaceId: string, guard: GuardFn) => Promise<void>;
  clear: () => void;
}

const isGuardAnswer = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

export const useBroadcastListStore = create<BroadcastListState>()((set, get) => {
  /** Counts every opening: a late answer for an earlier workspace is dropped. */
  let epoch = 0;
  let reread: { workspaceId: string; run: () => Promise<void> } | null = null;

  const here = (workspaceId: string) => get().workspaceId === workspaceId;

  /** A background re-read: one in flight, one queued; a failure keeps what is shown. */
  const rereadOf = (workspaceId: string, guard: GuardFn) => {
    if (reread?.workspaceId !== workspaceId) {
      reread = {
        workspaceId,
        run: serialRead(async () => {
          const opened = epoch;
          try {
            const list = await listBroadcasts(workspaceId, { background: true });
            if (opened === epoch && here(workspaceId)) set({ status: 'ready', items: list.items });
          } catch (error) {
            if (isGuardAnswer(error)) guard(error, workspaceId);
          }
        }),
      };
    }
    return reread.run;
  };

  const onFrame = (workspaceId: string, guard: GuardFn, frame: LiveFrame) => {
    if (frame.workspace_id !== workspaceId || !here(workspaceId)) return;
    if (frame.type === 'broadcast.changed' || frame.type === 'resync') {
      void rereadOf(workspaceId, guard)();
    }
  };

  return {
    workspaceId: null,
    status: 'idle',
    items: [],
    async load(workspaceId, guard) {
      const opened = ++epoch;
      set({
        workspaceId,
        status: 'loading',
        items: here(workspaceId) ? get().items : [],
      });
      try {
        const list = await listBroadcasts(workspaceId, {});
        if (opened === epoch) set({ status: 'ready', items: list.items });
      } catch (error) {
        if (opened !== epoch) return;
        if (isGuardAnswer(error)) guard(error, workspaceId);
        set({ status: 'error' });
      }
    },
    watch(workspaceId, guard) {
      return subscribeLive(workspaceId, {
        onFrame: (frame) => onFrame(workspaceId, guard, frame),
        onReconnected: () => here(workspaceId) && void rereadOf(workspaceId, guard)(),
        onInvalidFrame: () => here(workspaceId) && void rereadOf(workspaceId, guard)(),
        onClosed: () => undefined, // the shell and the next request decide
      });
    },
    reread(workspaceId, guard) {
      if (!here(workspaceId)) return Promise.resolve();
      return rereadOf(workspaceId, guard)();
    },
    clear() {
      epoch++;
      reread = null;
      set({ workspaceId: null, status: 'idle', items: [] });
    },
  };
});

// Workspace switch, access removed and sign-out all change the current workspace: drop its state.
useWorkspaceStore.subscribe((state, prev) => {
  if (state.current?.id !== prev.current?.id) useBroadcastListStore.getState().clear();
});
