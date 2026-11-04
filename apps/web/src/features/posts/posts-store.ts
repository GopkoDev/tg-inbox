import type { LiveFrame, PostSummary } from '@tg/shared';
import { create } from 'zustand';
import type { GuardFn } from '@/features/workspaces/guard';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { subscribeLive } from '@/shared/api/live-connection';
import { serialRead } from '@/shared/lib/serial-read';
import { listPosts, type PostFilter } from './api';

export type Phase = 'idle' | 'loading' | 'ready' | 'error';

interface PostsState {
  workspaceId: string | null;
  filter: PostFilter;
  status: Phase;
  /** The workspace zone the times are shown in; `null` until one is set. */
  timeZone: string | null;
  truncated: boolean;
  items: PostSummary[];
  load: (workspaceId: string, filter: PostFilter, guard: GuardFn) => Promise<void>;
  /** Re-reads on every `post.changed` of the workspace, `resync` and reconnects. */
  watch: (workspaceId: string, guard: GuardFn) => () => void;
  clear: () => void;
}

const isGuardAnswer = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

export const usePostsStore = create<PostsState>()((set, get) => {
  let epoch = 0;
  let reread: { workspaceId: string; run: () => Promise<void> } | null = null;
  const here = (workspaceId: string) => get().workspaceId === workspaceId;

  const rereadOf = (workspaceId: string, guard: GuardFn) => {
    if (reread?.workspaceId !== workspaceId) {
      reread = {
        workspaceId,
        run: serialRead(async () => {
          const opened = epoch;
          try {
            const list = await listPosts(workspaceId, get().filter, { background: true });
            if (opened === epoch && here(workspaceId)) {
              set({
                status: 'ready',
                items: list.items,
                timeZone: list.time_zone,
                truncated: list.truncated,
              });
            }
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
    if (frame.type === 'post.changed' || frame.type === 'resync')
      void rereadOf(workspaceId, guard)();
  };

  return {
    workspaceId: null,
    filter: 'all',
    status: 'idle',
    timeZone: null,
    truncated: false,
    items: [],
    async load(workspaceId, filter, guard) {
      const opened = ++epoch;
      const same = here(workspaceId);
      set({ workspaceId, filter, status: 'loading', items: same ? get().items : [] });
      try {
        const list = await listPosts(workspaceId, filter, {});
        if (opened === epoch) {
          set({
            status: 'ready',
            items: list.items,
            timeZone: list.time_zone,
            truncated: list.truncated,
          });
        }
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
      set({ workspaceId: null, filter: 'all', status: 'idle', timeZone: null, items: [] });
    },
  };
});

useWorkspaceStore.subscribe((state, prev) => {
  if (state.current?.id !== prev.current?.id) usePostsStore.getState().clear();
});
