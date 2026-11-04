import type { LiveFrame } from '@tg/shared';
import { create } from 'zustand';
import { ApiError } from '@/shared/api/client';
import { reviveLiveConnection, subscribeLive } from '@/shared/api/live-connection';
import { getPostAttention } from './api';

/** One refetch per burst of frames. */
const DEBOUNCE_MS = 300;

/** Hands a refusal of a call made for `workspaceId` to the shell's guard (401 / 403 / 404). */
export type PostAttentionGuard = (error: unknown, workspaceId: string) => Promise<unknown>;

interface PostAttentionState {
  workspaceId: string | null;
  /** `null` until the first answer, and after access is gone: no badge. */
  count: number | null;
  start: (workspaceId: string, guard: PostAttentionGuard) => void;
  stop: () => void;
}

let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
/** Bumped by every start/stop: an answer of an earlier one is stale. */
let epoch = 0;
let issued = 0;
let landed = 0;

const changesCount = (frame: LiveFrame) => frame.type === 'post.changed' || frame.type === 'resync';

/**
 * The count of posts needing attention in the workspace (SCR-15, AC-12, AC-13). Signal, then
 * refetch: the number is whatever the server last said. A failed read keeps the last count.
 */
export const usePostAttentionStore = create<PostAttentionState>()((set, get) => {
  const read = async (workspaceId: string, guard: PostAttentionGuard, startedAt: number) => {
    const mine = ++issued;
    const current = () => epoch === startedAt && mine > landed;
    try {
      const answer = await getPostAttention(workspaceId);
      if (!current()) return;
      landed = mine;
      set({ count: answer.count });
      reviveLiveConnection(workspaceId);
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        landed = mine;
        set({ count: null });
        await guard(error, workspaceId).catch(() => undefined);
      }
    }
  };

  const reset = () => {
    epoch++;
    clearTimeout(timer);
    timer = undefined;
    unsubscribe?.();
    unsubscribe = null;
    set({ workspaceId: null, count: null });
  };

  return {
    workspaceId: null,
    count: null,
    start(workspaceId, guard) {
      if (get().workspaceId === workspaceId && unsubscribe) return;
      reset();
      const startedAt = epoch;
      set({ workspaceId });
      const refetch = () => {
        clearTimeout(timer);
        timer = setTimeout(() => void read(workspaceId, guard, startedAt), DEBOUNCE_MS);
      };
      unsubscribe = subscribeLive(workspaceId, {
        onFrame: (frame) => {
          if (frame.workspace_id === workspaceId && changesCount(frame)) refetch();
        },
        onReconnected: refetch,
        onInvalidFrame: refetch,
        onClosed: (code) => {
          if (code === 4403) set({ count: null });
          refetch();
        },
      });
      void read(workspaceId, guard, startedAt);
    },
    stop: reset,
  };
});
