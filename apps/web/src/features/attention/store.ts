import type { LiveFrame } from '@tg/shared';
import { create } from 'zustand';
import { ApiError } from '@/shared/api/client';
import { reviveLiveConnection, subscribeLive } from '@/shared/api/live-connection';
import { getAttentionCount } from './api';

/** One refetch per burst of frames (ADR-0008). */
const DEBOUNCE_MS = 300;

/** Hands a refusal of a call made for `workspaceId` to the shell's guard (401 / 403 / 404). */
export type AttentionGuard = (error: unknown, workspaceId: string) => Promise<unknown>;

interface AttentionState {
  workspaceId: string | null;
  /** `null` until the first answer, and after access is gone: no title prefix, no badge. */
  count: number | null;
  /** Reads the count now and keeps it current from the workspace's live frames. */
  start: (workspaceId: string, guard: AttentionGuard) => void;
  /** Leaves the workspace: unsubscribes, cancels a pending read, clears the count. */
  stop: () => void;
}

let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
/** Bumped by every start/stop: an answer of an earlier one is stale. */
let epoch = 0;
/** Numbers every read; `landed` is the newest one that answered: an older answer is stale. */
let issued = 0;
let landed = 0;

/**
 * Frames that can change the count: an arrival, an assignment or state change, a read. A broadcast
 * item never does (ADR-0010).
 */
function changesCount(frame: LiveFrame): boolean {
  if (frame.type === 'resync') return true;
  if (frame.type !== 'conversation.changed') return false;
  if (frame.item?.type === 'broadcast') return false;
  return frame.change !== 'edited';
}

/**
 * The attention count of the workspace the frame has entered (SCR-15, AC-01). Signal, then
 * refetch: the number is whatever the server last said, never computed from frames.
 */
export const useAttentionStore = create<AttentionState>()((set, get) => {
  const read = async (workspaceId: string, guard: AttentionGuard, startedAt: number) => {
    const mine = ++issued;
    const current = () => epoch === startedAt && mine > landed;
    try {
      const answer = await getAttentionCount(workspaceId);
      if (!current() || answer.workspace_id !== workspaceId) return;
      landed = mine;
      set({ count: answer.count });
      // The member may still read this workspace: a live session the server ended comes back.
      reviveLiveConnection(workspaceId);
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        landed = mine;
        set({ count: null });
        await guard(error, workspaceId).catch(() => undefined);
      }
      // any other failure keeps the last count; the next frame or resync asks again
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
          // 4403 = membership.deactivated: nothing to show; the read lets the guard decide.
          if (code === 4403) set({ count: null });
          refetch();
        },
      });
      void read(workspaceId, guard, startedAt);
    },
    stop: reset,
  };
});
