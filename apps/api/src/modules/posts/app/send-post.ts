import type { Clock } from '../../../platform/clock.js';
import type { Db } from '../../../platform/db.js';
import { dailyLimitReached } from '../domain/limits.js';
import type { DestinationRecord, DestinationRepo } from '../infra/destination-repo.js';
import type { PostRecord, PostRepo } from '../infra/post-repo.js';
import type { PostSignals, PostTransaction } from './drafts.js';
import type { PostSendJobs } from './publish.js';

export const SEND_WINDOW_MS = 15 * 60_000;
export const CHAT_PACE_MS = 3_000;
const DEFAULT_RATE_LIMIT_MS = 30_000;
const DAY_MS = 24 * 3_600_000;
const WORKING_BOT_STATES = ['connected', 'taken_over'];

export interface PostSendJob {
  postId: string;
  workspaceId: string;
  moment: string;
}

export type PostSendOutcome =
  | { outcome: 'sent'; messageId: bigint; at: Date }
  | { outcome: 'paused'; until: Date }
  | { outcome: 'bot_unavailable' }
  | { outcome: 'bot_changed' }
  | { outcome: 'rate_limited'; retryAfterMs?: number }
  | { outcome: 'no_post_right' }
  | { outcome: 'chat_gone' }
  | { outcome: 'text_refused' }
  | { outcome: 'telegram_error' }
  | { outcome: 'no_answer' };

export interface PostSendSignals extends PostSignals {
  destinationsChanged(tx: Db, workspaceId: string): Promise<void>;
}

export interface PostSendDeps {
  transaction: PostTransaction;
  clock: Clock;
  posts: Pick<
    PostRepo,
    | 'find'
    | 'lock'
    | 'claim'
    | 'markPublished'
    | 'markMissed'
    | 'markFailed'
    | 'markNotConfirmed'
    | 'returnToScheduled'
    | 'returnToDraft'
    | 'earlierDueInChat'
    | 'sentTimesSince'
  >;
  destinations: Pick<
    DestinationRepo,
    'lock' | 'setPausedUntil' | 'setNextSendAt' | 'setAvailability'
  >;
  workspaces: {
    /** Share-locks the memberships and returns the active business owners among `ids`. */
    lockActiveOwners(tx: Db, workspaceId: string, ids: string[]): Promise<string[]>;
  };
  lockPosts(tx: Db, workspaceId: string): Promise<void>;
  bots: {
    postReadiness(workspaceId: string): Promise<{
      state: string;
      telegramBotId: bigint;
      sendPausedUntil: Date | null;
    } | null>;
    sendPost(req: {
      workspaceId: string;
      telegramBotId: bigint;
      chatId: string;
      text: string;
      silent: boolean;
    }): Promise<PostSendOutcome>;
  };
  jobs: PostSendJobs;
  signals: PostSendSignals;
}

type Pre = { kind: 'done' } | { kind: 'claimed'; post: PostRecord; dest: DestinationRecord };

export function createPostSender(deps: PostSendDeps) {
  const { transaction, clock, posts, destinations, workspaces, bots, jobs, signals } = deps;

  const later = (d: Date | null, now: Date): d is Date => d !== null && d.getTime() > now.getTime();

  /** Everything before the send, ending with the claim committed. */
  async function prepare(job: PostSendJob): Promise<Pre> {
    const { postId, workspaceId } = job;
    return transaction(async (tx): Promise<Pre> => {
      const seen = await posts.find(workspaceId, postId, tx);
      if (!seen) return { kind: 'done' };
      if (seen.state === 'sending') {
        // A claim without an outcome: never sent again.
        await settleNotConfirmed(tx, workspaceId, postId);
        return { kind: 'done' };
      }
      if (seen.state !== 'scheduled' || seen.scheduledFor?.toISOString() !== job.moment) {
        return { kind: 'done' };
      }
      if (seen.scheduledByAccountId) {
        const owners = await workspaces.lockActiveOwners(tx, workspaceId, [
          seen.scheduledByAccountId,
        ]);
        if (!owners.includes(seen.scheduledByAccountId)) {
          await deps.lockPosts(tx, workspaceId);
          const back = await posts.returnToDraft(
            workspaceId,
            postId,
            'owner_role_changed',
            seen.scheduledByAccountId,
            clock.now(),
            tx,
          );
          if (back) await signals.postChanged(tx, workspaceId, postId);
          return { kind: 'done' };
        }
      }
      await deps.lockPosts(tx, workspaceId);
      const post = await posts.lock(workspaceId, postId, tx);
      if (!post || post.state !== 'scheduled' || post.scheduledFor?.toISOString() !== job.moment) {
        return { kind: 'done' };
      }
      const moment = post.scheduledFor;
      const now = clock.now();
      const dest = post.destinationId
        ? await destinations.lock(workspaceId, post.destinationId, tx)
        : null;
      const bot = await bots.postReadiness(workspaceId);
      const botPause = bot && later(bot.sendPausedUntil, now) ? bot.sendPausedUntil : null;
      const chatPause = dest && later(dest.pausedUntil, now) ? dest.pausedUntil : null;

      const end = async (mark: 'missed' | 'failed', reason: string): Promise<Pre> => {
        const row =
          mark === 'missed'
            ? await posts.markMissed(workspaceId, postId, reason, now, tx)
            : await posts.markFailed(workspaceId, postId, reason, now, tx);
        if (row) await signals.postChanged(tx, workspaceId, postId);
        return { kind: 'done' };
      };

      if (now.getTime() > moment.getTime() + SEND_WINDOW_MS) {
        return end(
          'missed',
          botPause ? 'bot_paused' : chatPause ? 'chat_rate_limited' : 'service_down',
        );
      }
      const sentTimes = await posts.sentTimesSince(
        workspaceId,
        new Date(now.getTime() - DAY_MS),
        tx,
      );
      if (dailyLimitReached(sentTimes, now)) return end('failed', 'daily_limit');
      if (!bot || !WORKING_BOT_STATES.includes(bot.state)) return end('failed', 'bot_not_working');
      if (!dest || dest.removedAt || dest.availability === 'unavailable') {
        return end('failed', 'destination_unavailable');
      }
      if (dest.telegramBotId !== bot.telegramBotId) return end('failed', 'not_current_bot');

      const earlier = await posts.earlierDueInChat(workspaceId, dest.id, moment, postId, tx);
      const waits: Date[] = [];
      if (earlier.length > 0) waits.push(new Date(now.getTime() + CHAT_PACE_MS));
      if (chatPause) waits.push(chatPause);
      if (botPause) waits.push(botPause);
      if (later(dest.nextSendAt, now)) waits.push(dest.nextSendAt);
      if (waits.length > 0) {
        const startAfter = new Date(Math.max(...waits.map((w) => w.getTime())));
        await jobs.enqueueSend(tx, job, startAfter);
        return { kind: 'done' };
      }

      const claimed = await posts.claim(workspaceId, postId, now, tx);
      if (!claimed) return { kind: 'done' };
      await signals.postChanged(tx, workspaceId, postId);
      return { kind: 'claimed', post: claimed, dest };
    });
  }

  async function settleNotConfirmed(tx: Db, workspaceId: string, postId: string) {
    const row = await posts.markNotConfirmed(workspaceId, postId, clock.now(), tx);
    if (row) await signals.postChanged(tx, workspaceId, postId);
  }

  async function record(job: PostSendJob, dest: DestinationRecord, sent: PostSendOutcome) {
    const { postId, workspaceId } = job;
    await transaction(async (tx) => {
      await deps.lockPosts(tx, workspaceId);
      const now = clock.now();
      const fail = async (reason: string) => {
        const row = await posts.markFailed(workspaceId, postId, reason, now, tx);
        if (row) await signals.postChanged(tx, workspaceId, postId);
      };
      const again = async (until: Date) => {
        const row = await posts.returnToScheduled(workspaceId, postId, now, tx);
        if (!row) return;
        await signals.postChanged(tx, workspaceId, postId);
        await jobs.enqueueSend(tx, job, until);
      };
      const unavailable = async (problem: 'no_post_right' | 'chat_gone') => {
        await fail(problem);
        await destinations.setAvailability(
          workspaceId,
          dest.id,
          { availability: 'unavailable', problem, membershipChangedAt: now },
          tx,
        );
        await signals.destinationsChanged(tx, workspaceId);
      };
      switch (sent.outcome) {
        case 'sent': {
          const row = await posts.markPublished(
            workspaceId,
            postId,
            { telegramMessageId: sent.messageId },
            sent.at,
            tx,
          );
          await destinations.setNextSendAt(
            workspaceId,
            dest.id,
            new Date(sent.at.getTime() + CHAT_PACE_MS),
            tx,
          );
          if (row) await signals.postChanged(tx, workspaceId, postId);
          return;
        }
        case 'paused':
          return again(sent.until);
        case 'rate_limited': {
          const until = new Date(now.getTime() + (sent.retryAfterMs ?? DEFAULT_RATE_LIMIT_MS));
          await destinations.setPausedUntil(workspaceId, dest.id, until, tx);
          await signals.destinationsChanged(tx, workspaceId);
          return again(until);
        }
        case 'bot_unavailable':
          return fail('bot_not_working');
        case 'bot_changed':
          return fail('not_current_bot');
        case 'no_post_right':
        case 'chat_gone':
          return unavailable(sent.outcome);
        case 'text_refused':
        case 'telegram_error':
          return fail(sent.outcome);
        case 'no_answer':
          return settleNotConfirmed(tx, workspaceId, postId);
      }
    });
  }

  return {
    async sendPost(job: PostSendJob): Promise<void> {
      const pre = await prepare(job);
      if (pre.kind === 'done') return;
      const { post, dest } = pre;
      const sent = await bots.sendPost({
        workspaceId: job.workspaceId,
        telegramBotId: dest.telegramBotId,
        chatId: dest.chatId.toString(),
        text: post.text,
        silent: post.silent,
      });
      await record(job, dest, sent);
    },
  };
}

export type PostSender = ReturnType<typeof createPostSender>;
