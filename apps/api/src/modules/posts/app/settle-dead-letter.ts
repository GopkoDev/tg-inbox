import type { PostSendDeps, PostSendJob } from './send-post.js';
import { SEND_WINDOW_MS } from './send-post.js';

export type DeadLetterDeps = Pick<
  PostSendDeps,
  'transaction' | 'clock' | 'posts' | 'lockPosts' | 'jobs' | 'signals'
>;

/** Settles what a dead-lettered `posts.send` job left: a claim without outcome, or a due post. */
export function createDeadLetterSettler(deps: DeadLetterDeps) {
  const { transaction, clock, posts, jobs, signals } = deps;
  return {
    async settle(job: PostSendJob): Promise<void> {
      const { postId, workspaceId } = job;
      await transaction(async (tx) => {
        await deps.lockPosts(tx, workspaceId);
        const post = await posts.lock(workspaceId, postId, tx);
        if (!post) return;
        const now = clock.now();
        if (post.state === 'sending') {
          const row = await posts.markNotConfirmed(workspaceId, postId, now, tx);
          if (row) await signals.postChanged(tx, workspaceId, postId);
          return;
        }
        if (post.state !== 'scheduled' || post.scheduledFor?.toISOString() !== job.moment) return;
        if (now.getTime() > post.scheduledFor.getTime() + SEND_WINDOW_MS) {
          const row = await posts.markMissed(workspaceId, postId, 'service_down', now, tx);
          if (row) await signals.postChanged(tx, workspaceId, postId);
          return;
        }
        await jobs.enqueueSend(tx, job, now);
      });
    },
  };
}
