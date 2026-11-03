import type { Clock } from '../../../platform/clock.js';
import type { Db } from '../../../platform/db.js';
import type { PostRepo } from '../infra/post-repo.js';
import type { PostSignals } from './drafts.js';

export interface PostDeactivationDeps {
  posts: Pick<PostRepo, 'scheduledByAccount' | 'returnToDraft'>;
  signals: PostSignals;
  clock: Clock;
}

export function createPostDeactivation({ posts, signals, clock }: PostDeactivationDeps) {
  return {
    /** Runs inside the deactivation transaction: every post the account scheduled goes back to a draft. */
    async returnScheduledOfDeactivated(
      tx: Db,
      input: { workspaceId: string; accountId: string },
    ): Promise<void> {
      const { workspaceId, accountId } = input;
      const scheduled = await posts.scheduledByAccount(workspaceId, accountId, tx);
      for (const post of scheduled) {
        const moved = await posts.returnToDraft(
          workspaceId,
          post.id,
          'owner_deactivated',
          accountId,
          clock.now(),
          tx,
        );
        if (moved) await signals.postChanged(tx, workspaceId, post.id);
      }
    },
  };
}

export type PostDeactivation = ReturnType<typeof createPostDeactivation>;
