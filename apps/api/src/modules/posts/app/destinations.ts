import type { DestinationCodeCreated, DestinationCodeStatus, DestinationRemoved } from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import type { Db } from '../../../platform/db.js';
import {
  DestinationLimitReachedError,
  NotFoundError,
  OwnerOnlyError,
  PostsNeedWorkingBotError,
} from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import { CODE_TTL_MS, newCode } from '../domain/connect-code.js';
import { DESTINATION_LIMIT } from '../domain/limits.js';
import type { CodeRepo } from '../infra/code-repo.js';
import type { DestinationRepo } from '../infra/destination-repo.js';
import type { PostRepo } from '../infra/post-repo.js';
import type { PostActor, PostTransaction } from './drafts.js';

export interface DestinationSignals {
  destinationsChanged(tx: Db, workspaceId: string): Promise<void>;
  postChanged(tx: Db, workspaceId: string, postId: string): Promise<void>;
}

export interface DestinationsDeps {
  transaction: PostTransaction;
  codes: Pick<CodeRepo, 'insert' | 'find' | 'replacePrevious'>;
  destinations: Pick<DestinationRepo, 'countLive' | 'lock' | 'remove'>;
  posts: Pick<PostRepo, 'list' | 'returnToDraft'>;
  workspaces: {
    lockActiveOwners(tx: Db, workspaceId: string, ids: readonly string[]): Promise<string[]>;
  };
  lockPosts(tx: Db, workspaceId: string): Promise<void>;
  bots: {
    postReadiness(workspaceId: string): Promise<{ state: string } | null>;
    botUsername(workspaceId: string): Promise<string | null>;
  };
  signals: DestinationSignals;
  clock: Clock;
}

/**
 * Owner-only steps hold the membership, then the posts lock (ADR lock order). Returns whether the
 * actor is still an active member; the caller refuses an inactive one with `OwnerOnlyError`.
 */
export async function lockOwner(
  deps: Pick<DestinationsDeps, 'workspaces' | 'lockPosts'>,
  tx: Db,
  workspaceId: string,
  actor: PostActor,
): Promise<boolean> {
  const active = await deps.workspaces.lockActiveOwners(tx, workspaceId, [actor.accountId]);
  await deps.lockPosts(tx, workspaceId);
  return active.includes(actor.accountId);
}

export function requireOwner(actor: PostActor): void {
  if (actor.role !== 'owner') throw new OwnerOnlyError('Only a business owner can do this');
}

export async function lockActiveOwner(
  deps: Pick<DestinationsDeps, 'workspaces' | 'lockPosts'>,
  tx: Db,
  workspaceId: string,
  actor: PostActor,
): Promise<void> {
  if (!(await lockOwner(deps, tx, workspaceId, actor))) {
    throw new OwnerOnlyError('Only a business owner can do this');
  }
}

export function createDestinations(deps: DestinationsDeps) {
  const { transaction, codes, destinations, posts, bots, signals, clock } = deps;

  return {
    async createCode(workspaceId: string, actor: PostActor): Promise<DestinationCodeCreated> {
      requireOwner(actor);
      const ready = await bots.postReadiness(workspaceId);
      const username = await bots.botUsername(workspaceId);
      if (!ready || ready.state !== 'connected' || !username) throw new PostsNeedWorkingBotError();
      const { code, hash } = newCode();
      // The id and the time are taken after the posts:<ws> lock, so the code created by the later
      // lock holder is also the later one and is the one left live (R1, AC-01).
      const { id, expiresAt } = await transaction(async (tx) => {
        await lockActiveOwner(deps, tx, workspaceId, actor);
        if ((await destinations.countLive(workspaceId, tx)) >= DESTINATION_LIMIT) {
          throw new DestinationLimitReachedError();
        }
        const now = clock.now();
        const created = { id: newId(), expiresAt: new Date(now.getTime() + CODE_TTL_MS) };
        await codes.replacePrevious(workspaceId, actor.accountId, now, tx);
        await codes.insert(
          workspaceId,
          {
            id: created.id,
            accountId: actor.accountId,
            codeHash: hash,
            createdAt: now,
            expiresAt: created.expiresAt,
          },
          tx,
        );
        return created;
      });
      return {
        id,
        code,
        group_command: `/connect@${username} ${code}`,
        expires_at: expiresAt.toISOString(),
      };
    },

    async getCode(
      workspaceId: string,
      actor: PostActor,
      codeId: string,
    ): Promise<DestinationCodeStatus> {
      const c = await codes.find(workspaceId, codeId);
      if (!c || c.accountId !== actor.accountId) throw new NotFoundError('Code not found');
      let status: DestinationCodeStatus['status'] = 'waiting';
      if (c.usedAt) status = 'connected';
      else if (c.replacedAt) status = 'replaced';
      else if (c.expiresAt <= clock.now()) status = 'expired';
      else if (c.result === 'no_post_right' || c.result === 'no_send_right') {
        status = 'no_post_right';
      } else if (c.result === 'destination_limit') status = 'destination_limit';
      return {
        id: c.id,
        status,
        expires_at: c.expiresAt.toISOString(),
        needed_right:
          status === 'no_post_right'
            ? c.result === 'no_send_right'
              ? 'send_messages'
              : 'post_messages'
            : null,
        destination_id: c.destinationId,
      };
    },

    async removeDestination(
      workspaceId: string,
      actor: PostActor,
      destinationId: string,
    ): Promise<DestinationRemoved> {
      requireOwner(actor);
      return transaction(async (tx) => {
        const active = await lockOwner(deps, tx, workspaceId, actor);
        const dest = await destinations.lock(workspaceId, destinationId, tx);
        if (!dest) throw new NotFoundError('Destination not found');
        if (!active) throw new OwnerOnlyError('Only a business owner can do this');
        if (dest.removedAt) return { outcome: 'unchanged' as const, returned_to_draft: 0 };
        const now = clock.now();
        await destinations.remove(workspaceId, destinationId, actor.accountId, now, tx);
        const scheduled = (await posts.list(workspaceId, { states: ['scheduled'] }, tx)).filter(
          (p) => p.destinationId === destinationId,
        );
        let returned = 0;
        for (const p of scheduled) {
          const back = await posts.returnToDraft(
            workspaceId,
            p.id,
            'destination_removed',
            actor.accountId,
            now,
            tx,
          );
          if (!back) continue;
          returned++;
          await signals.postChanged(tx, workspaceId, p.id);
        }
        await signals.destinationsChanged(tx, workspaceId);
        return { outcome: 'removed' as const, returned_to_draft: returned };
      });
    },
  };
}

export type Destinations = ReturnType<typeof createDestinations>;
