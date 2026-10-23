import type { TagWithCount } from '@tg/shared';
import { create } from 'zustand';
import type { GuardFn } from '@/features/workspaces/guard';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { subscribeLive } from '@/shared/api/live-connection';
import { listTags } from './api';

export type TagsStatus = 'loading' | 'ready' | 'error' | 'not_found';

/**
 * The workspace's tag list with counts (picker, filter, Settings → Tags). Read once per workspace,
 * re-read on `tags.changed`, `resync` and a reconnect, dropped on a workspace switch.
 */
interface TagsState {
  workspaceId: string | null;
  items: TagWithCount[];
  status: TagsStatus;
  load: (workspaceId: string, guard: GuardFn, options?: { background?: boolean }) => Promise<void>;
  /** Re-reads on `tags.changed`, `resync` and reconnects; returns the stop. */
  watch: (workspaceId: string, guard: GuardFn) => () => void;
  /** Replaces the list with an answer an owner action already carries. */
  replace: (workspaceId: string, items: TagWithCount[]) => void;
  clear: () => void;
}

const GUARD_STATUSES = new Set([401, 403, 404]);
const isGuardAnswer = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  GUARD_STATUSES.has((error as { status: number }).status);

export const useTagsStore = create<TagsState>()((set, get) => {
  let reading: { again: boolean } | null = null;
  const stillHere = (workspaceId: string) => get().workspaceId === workspaceId;

  const load: TagsState['load'] = async (workspaceId, guard, options) => {
    if (get().workspaceId !== workspaceId) set({ workspaceId, items: [], status: 'loading' });
    else if (!options?.background) set({ status: 'loading' });
    if (options?.background && reading) {
      reading.again = true;
      return;
    }
    const mine = { again: false };
    reading = mine;
    try {
      const list = await listTags(workspaceId, options);
      if (stillHere(workspaceId)) set({ items: list.items, status: 'ready' });
    } catch (error) {
      if (stillHere(workspaceId)) {
        if (isGuardAnswer(error)) {
          try {
            const outcome = await guard(error, workspaceId);
            if (outcome === 'not-found' && stillHere(workspaceId)) set({ status: 'not_found' });
          } catch {
            // the guard could not resolve; the picker keeps its state
          }
        } else if (!options?.background) set({ status: 'error' });
        // a failed background re-read keeps the list shown
      }
    } finally {
      if (reading === mine) reading = null;
    }
    if (mine.again && stillHere(workspaceId)) await load(workspaceId, guard, { background: true });
  };

  return {
    workspaceId: null,
    items: [],
    status: 'loading',
    load,
    replace(workspaceId, items) {
      if (stillHere(workspaceId)) set({ items, status: 'ready' });
    },
    watch(workspaceId, guard) {
      const reread = () => void load(workspaceId, guard, { background: true });
      return subscribeLive(workspaceId, {
        onFrame: (frame) => {
          if (frame.workspace_id !== workspaceId) return;
          if (frame.type === 'tags.changed' || frame.type === 'resync') reread();
        },
        onReconnected: reread,
        onInvalidFrame: reread,
        onClosed: () => undefined,
      });
    },
    clear: () => {
      reading = null;
      set({ workspaceId: null, items: [], status: 'loading' });
    },
  };
});

// Workspace switch, access removed and sign-out all change the current workspace: drop its tags.
useWorkspaceStore.subscribe((state, prev) => {
  if (state.current?.id !== prev.current?.id) useTagsStore.getState().clear();
});
