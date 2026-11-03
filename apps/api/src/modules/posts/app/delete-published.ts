import type { Post } from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import type { Db } from '../../../platform/db.js';
import {
  AccessRemovedError,
  NotFoundError,
  PostDeleteRefusedError,
  PostDeleteWindowPassedError,
  PostNotPublishedError,
} from '../../../platform/errors.js';
import type { DeletePost } from '../../bots/app/delete-post.js';
import type { DestinationRepo } from '../infra/destination-repo.js';
import type { PostRepo } from '../infra/post-repo.js';
import type { PostActor, PostSignals, PostTransaction, PostViews } from './drafts.js';

/** Telegram lets a bot delete its own message for 48 hours. */
export const DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface PostDeletionDeps {
  transaction: PostTransaction;
  posts: Pick<PostRepo, 'find' | 'lock' | 'markDeleted'>;
  destinations: Pick<DestinationRepo, 'find'>;
  workspaces: {
    lockActiveOwners(tx: Db, workspaceId: string, accountIds: string[]): Promise<string[]>;
  };
  bots: Pick<DeletePost, 'deletePost'>;
  signals: PostSignals;
  views: PostViews;
  clock: Clock;
}

export function createPostDeletion(deps: PostDeletionDeps) {
  const { transaction, posts, destinations, workspaces, bots, signals, views, clock } = deps;

  return {
    async deletePostFromTelegram(
      workspaceId: string,
      actor: PostActor,
      postId: string,
    ): Promise<Post> {
      // A plain read (no lock) so an unknown post is a 404 whatever the caller's membership.
      if (!(await posts.find(workspaceId, postId))) throw new NotFoundError('Post not found');
      await transaction(async (tx) => {
        const active = await workspaces.lockActiveOwners(tx, workspaceId, [actor.accountId]);
        if (!active.includes(actor.accountId)) {
          throw new AccessRemovedError('Your access to this workspace was removed');
        }
        const row = await posts.lock(workspaceId, postId, tx);
        if (!row) throw new NotFoundError('Post not found');
        if (row.state === 'deleted') return;
        if (row.state !== 'published' || !row.publishedAt || row.telegramMessageId === null) {
          throw new PostNotPublishedError();
        }
        const now = clock.now();
        if (now.getTime() - row.publishedAt.getTime() >= DELETE_WINDOW_MS) {
          throw new PostDeleteWindowPassedError();
        }
        const destination = row.destinationId
          ? await destinations.find(workspaceId, row.destinationId, tx)
          : null;
        if (!destination) throw new PostDeleteRefusedError();
        const result = await bots.deletePost({
          workspaceId,
          telegramBotId: destination.telegramBotId,
          chatId: destination.chatId.toString(),
          messageId: row.telegramMessageId,
        });
        if (result.outcome !== 'deleted') throw new PostDeleteRefusedError();
        const marked = await posts.markDeleted(workspaceId, postId, actor.accountId, now, tx);
        if (!marked) throw new PostNotPublishedError();
        await signals.postChanged(tx, workspaceId, postId);
      });
      return views.postView(workspaceId, postId);
    },
  };
}

export type PostDeletion = ReturnType<typeof createPostDeletion>;
