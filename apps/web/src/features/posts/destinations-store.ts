import type { Destination, LiveFrame } from '@tg/shared';
import { create } from 'zustand';
import type { GuardFn } from '@/features/workspaces/guard';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { subscribeLive } from '@/shared/api/live-connection';
import { serialRead } from '@/shared/lib/serial-read';
import { listDestinations } from './api';

export type Phase = 'idle' | 'loading' | 'ready' | 'error';

interface DestinationsState {
  workspaceId: string | null;
  status: Phase;
  timeZone: string | null;
  scheduledTotal: number;
  items: Destination[];
  load: (workspaceId: string, guard: GuardFn) => Promise<void>;
  /** Re-reads on every `destinations.changed` of the workspace, `resync` and reconnects. */
  watch: (workspaceId: string, guard: GuardFn) => () => void;
  clear: () => void;
}

const isGuardAnswer = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

export const useDestinationsStore = create<DestinationsState>()((set, get) => {
  let epoch = 0;
  let reread: { workspaceId: string; run: () => Promise<void> } | null = null;
  const here = (workspaceId: string) => get().workspaceId === workspaceId;

  const apply = (list: Awaited<ReturnType<typeof listDestinations>>) =>
    set({
      status: 'ready',
      items: list.items,
      timeZone: list.time_zone,
      scheduledTotal: list.scheduled_total,
    });

  const rereadOf = (workspaceId: string, guard: GuardFn) => {
    if (reread?.workspaceId !== workspaceId) {
      reread = {
        workspaceId,
        run: serialRead(async () => {
          const opened = epoch;
          try {
            const list = await listDestinations(workspaceId, { background: true });
            if (opened === epoch && here(workspaceId)) apply(list);
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
    if (frame.type === 'destinations.changed' || frame.type === 'resync') {
      void rereadOf(workspaceId, guard)();
    }
  };

  return {
    workspaceId: null,
    status: 'idle',
    timeZone: null,
    scheduledTotal: 0,
    items: [],
    async load(workspaceId, guard) {
      const opened = ++epoch;
      set({ workspaceId, status: 'loading', items: here(workspaceId) ? get().items : [] });
      try {
        const list = await listDestinations(workspaceId);
        if (opened === epoch) apply(list);
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
        onClosed: () => undefined,
      });
    },
    clear() {
      epoch++;
      reread = null;
      set({ workspaceId: null, status: 'idle', timeZone: null, scheduledTotal: 0, items: [] });
    },
  };
});

useWorkspaceStore.subscribe((state, prev) => {
  if (state.current?.id !== prev.current?.id) useDestinationsStore.getState().clear();
});
