import type { TimeZoneSaved } from '@tg/shared';
import type { Db } from '../../../platform/db.js';
import type { PostRepo } from '../infra/post-repo.js';
import type { PostActor, PostTransaction } from './drafts.js';
import { lockActiveOwner, requireOwner, type DestinationSignals } from './destinations.js';

export interface PostingTimeZoneDeps {
  transaction: PostTransaction;
  posts: Pick<PostRepo, 'list'>;
  workspaces: {
    lockActiveOwners(tx: Db, workspaceId: string, ids: readonly string[]): Promise<string[]>;
  };
  lockPosts(tx: Db, workspaceId: string): Promise<void>;
  workspaceSettings: {
    timeZone(workspaceId: string): Promise<string | null>;
    setTimeZone(tx: Db, workspaceId: string, zone: string): Promise<void>;
  };
  signals: Pick<DestinationSignals, 'destinationsChanged'>;
}

export function createPostingTimeZone(deps: PostingTimeZoneDeps) {
  const { transaction, posts, workspaceSettings, signals } = deps;
  return {
    async setTimeZone(workspaceId: string, actor: PostActor, zone: string): Promise<TimeZoneSaved> {
      requireOwner(actor);
      return transaction(async (tx) => {
        await lockActiveOwner(deps, tx, workspaceId, actor);
        if ((await workspaceSettings.timeZone(workspaceId)) === zone) {
          return { outcome: 'unchanged' as const, time_zone: zone, relabelled_scheduled: 0 };
        }
        await workspaceSettings.setTimeZone(tx, workspaceId, zone);
        const scheduled = await posts.list(workspaceId, { states: ['scheduled'] }, tx);
        await signals.destinationsChanged(tx, workspaceId);
        return {
          outcome: 'saved' as const,
          time_zone: zone,
          relabelled_scheduled: scheduled.length,
        };
      });
    },
  };
}

export type PostingTimeZone = ReturnType<typeof createPostingTimeZone>;
