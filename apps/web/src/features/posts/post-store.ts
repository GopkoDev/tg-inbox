import type { Post } from '@tg/shared';
import { create } from 'zustand';
import { ApiError } from '@/shared/api/client';
import { subscribeLive } from '@/shared/api/live-connection';
import type { GuardFn } from '@/features/workspaces/guard';
import { getPost } from './api';

type Status = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

interface PostState {
  workspaceId: string | null;
  postId: string | null;
  post: Post | null;
  status: Status;
  /** Starts reading one post (a foreground read: the status shows `loading`). */
  open: (workspaceId: string, postId: string, guard: GuardFn) => Promise<void>;
  /** Re-reads the open post without a loading state (live change, back to draft, not a draft). */
  reload: (guard: GuardFn) => Promise<void>;
  /** Re-reads on `post.changed` for this id, on a resync and after a reconnect; returns the stop. */
  watch: (workspaceId: string, postId: string, guard: GuardFn) => () => void;
  close: () => void;
}

const idle = { workspaceId: null, postId: null, post: null, status: 'idle' as Status };

/**
 * The post behind the `/posts/:postId…` address, held outside the page so that moving between
 * `new`, the post, `publish` and `schedule` keeps what is shown (F14-F17).
 */
export const usePostStore = create<PostState>()((set, get) => {
  let generation = 0;

  const read = async (
    workspaceId: string,
    postId: string,
    guard: GuardFn,
    background: boolean,
  ): Promise<void> => {
    const mine = ++generation;
    try {
      const post = await getPost(workspaceId, postId, { background });
      if (mine === generation) set({ post, status: 'ready' });
    } catch (error) {
      if (mine !== generation) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403))
        void guard(error, workspaceId).catch(() => undefined);
      if (background) return;
      set({
        post: null,
        status: error instanceof ApiError && error.status === 404 ? 'missing' : 'error',
      });
    }
  };

  return {
    ...idle,
    open: (workspaceId, postId, guard) => {
      const same = get().workspaceId === workspaceId && get().postId === postId;
      set(
        same
          ? { status: get().post ? 'ready' : 'loading' }
          : { workspaceId, postId, post: null, status: 'loading' },
      );
      return read(workspaceId, postId, guard, same && get().post !== null);
    },
    reload: (guard) => {
      const { workspaceId, postId } = get();
      return workspaceId && postId ? read(workspaceId, postId, guard, true) : Promise.resolve();
    },
    watch: (workspaceId, postId, guard) =>
      subscribeLive(workspaceId, {
        onFrame: (frame) => {
          if (
            frame.type === 'resync' ||
            (frame.type === 'post.changed' && frame.post_id === postId)
          )
            void get().reload(guard);
        },
        onReconnected: () => void get().reload(guard),
        onInvalidFrame: () => void get().reload(guard),
        onClosed: () => undefined,
      }),
    close: () => {
      generation += 1;
      set(idle);
    },
  };
});
