import type { Post, PostCreate, PostSave } from '@tg/shared';
import { broadcastTextLength, BROADCAST_TEXT_MAX, tidyBroadcastText } from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import type { Db } from '../../../platform/db.js';
import {
  ForbiddenError,
  NotFoundError,
  PostDraftChangedError,
  PostNotADraftError,
  PostNotScheduledError,
  PostTextInvalidError,
} from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import { canEdit } from '../domain/post.js';
import type { DestinationRepo } from '../infra/destination-repo.js';
import type { PostRepo } from '../infra/post-repo.js';

export type PostTransaction = <T>(fn: (tx: Db) => Promise<T>) => Promise<T>;

export interface PostSignals {
  postChanged(tx: Db, workspaceId: string, postId: string): Promise<void>;
}

export interface PostViews {
  postView(workspaceId: string, postId: string): Promise<Post>;
}

export interface PostDraftsDeps {
  transaction: PostTransaction;
  posts: Pick<PostRepo, 'insertDraft' | 'find' | 'lock' | 'saveDraft' | 'returnToDraft' | 'remove'>;
  destinations: Pick<DestinationRepo, 'find'>;
  signals: PostSignals;
  views: PostViews;
  clock: Clock;
}

export interface PostActor {
  accountId: string;
  role: 'owner' | 'operator';
}

const NOT_FOUND = 'Post not found';

function validText(raw: string): string {
  const text = tidyBroadcastText(raw);
  if (broadcastTextLength(text) > BROADCAST_TEXT_MAX) throw new PostTextInvalidError();
  return text;
}

export function createPostDrafts(deps: PostDraftsDeps) {
  const { transaction, posts, destinations, signals, views, clock } = deps;

  async function requireDestination(tx: Db, workspaceId: string, id: string): Promise<void> {
    const d = await destinations.find(workspaceId, id, tx);
    if (!d || d.removedAt) throw new NotFoundError('Destination not found');
  }

  return {
    async createPost(workspaceId: string, actorId: string, input: PostCreate): Promise<Post> {
      const text = input.text === undefined ? '' : validText(input.text);
      const id = newId();
      await transaction(async (tx) => {
        if (input.destination_id) await requireDestination(tx, workspaceId, input.destination_id);
        await posts.insertDraft(
          workspaceId,
          {
            id,
            destinationId: input.destination_id ?? null,
            text,
            silent: input.silent ?? false,
            authorAccountId: actorId,
            createdAt: clock.now(),
          },
          tx,
        );
        await signals.postChanged(tx, workspaceId, id);
      });
      return views.postView(workspaceId, id);
    },

    async savePost(
      workspaceId: string,
      actorId: string,
      postId: string,
      input: PostSave,
    ): Promise<Post> {
      const text = input.text === undefined ? undefined : validText(input.text);
      let stale = false;
      await transaction(async (tx) => {
        const row = await posts.lock(workspaceId, postId, tx);
        if (!row) throw new NotFoundError(NOT_FOUND);
        if (!canEdit(row.state)) throw new PostNotADraftError();
        if (input.destination_id) await requireDestination(tx, workspaceId, input.destination_id);
        if (row.version !== input.expected_version) {
          stale = true;
          return;
        }
        const saved = await posts.saveDraft(
          workspaceId,
          postId,
          input.expected_version,
          {
            ...(text !== undefined ? { text } : {}),
            ...(input.silent !== undefined ? { silent: input.silent } : {}),
            ...(input.destination_id !== undefined ? { destinationId: input.destination_id } : {}),
          },
          actorId,
          clock.now(),
          tx,
        );
        if (!saved) {
          stale = true;
          return;
        }
        await signals.postChanged(tx, workspaceId, postId);
      });
      const post = await views.postView(workspaceId, postId);
      if (stale) throw new PostDraftChangedError({ post });
      return post;
    },

    async duplicatePost(workspaceId: string, actorId: string, postId: string): Promise<Post> {
      const id = newId();
      await transaction(async (tx) => {
        const source = await posts.find(workspaceId, postId, tx);
        if (!source) throw new NotFoundError(NOT_FOUND);
        await posts.insertDraft(
          workspaceId,
          {
            id,
            destinationId: source.destinationId,
            text: source.text,
            silent: source.silent,
            authorAccountId: actorId,
            createdAt: clock.now(),
          },
          tx,
        );
        await signals.postChanged(tx, workspaceId, id);
      });
      return views.postView(workspaceId, id);
    },

    async deletePostDraft(
      workspaceId: string,
      actor: PostActor,
      postId: string,
    ): Promise<{ outcome: 'deleted' }> {
      await transaction(async (tx) => {
        const row = await posts.lock(workspaceId, postId, tx);
        if (!row) throw new NotFoundError(NOT_FOUND);
        if (!canEdit(row.state)) throw new PostNotADraftError();
        if (actor.role !== 'owner' && row.authorAccountId !== actor.accountId) {
          throw new ForbiddenError('Only its author or a business owner can delete this draft.');
        }
        if (!(await posts.remove(workspaceId, postId, tx))) throw new PostNotADraftError();
        await signals.postChanged(tx, workspaceId, postId);
      });
      return { outcome: 'deleted' };
    },

    async movePostBackToDraft(
      workspaceId: string,
      actorId: string,
      postId: string,
      expectedVersion: number,
    ): Promise<{ outcome: 'changed' | 'unchanged'; post: Post }> {
      const outcome = await transaction(async (tx) => {
        const row = await posts.lock(workspaceId, postId, tx);
        if (!row) throw new NotFoundError(NOT_FOUND);
        if (row.state === 'draft') return 'unchanged' as const;
        if (row.state !== 'scheduled') throw new PostNotScheduledError();
        if (row.version !== expectedVersion) throw new PostDraftChangedError();
        const moved = await posts.returnToDraft(
          workspaceId,
          postId,
          null,
          actorId,
          clock.now(),
          tx,
        );
        if (!moved) throw new PostNotScheduledError();
        await signals.postChanged(tx, workspaceId, postId);
        return 'changed' as const;
      });
      return { outcome, post: await views.postView(workspaceId, postId) };
    },
  };
}

export type PostDrafts = ReturnType<typeof createPostDrafts>;
