import type { PostSchedule, PostScheduled, PublishBlocker, PublishConfirmation } from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import type { Db } from '../../../platform/db.js';
import {
  NotFoundError,
  OwnerOnlyError,
  PostDailyLimitReachedError,
  PostDraftChangedError,
  PostNotADraftError,
  PostScheduledLimitReachedError,
  PostScheduleOutOfRangeError,
  PostsNeedWorkingBotError,
  PostTextInvalidError,
  PostTimeDoesNotExistError,
  TimeZoneChangedError,
  TimeZoneRequiredError,
  DestinationUnavailableError,
} from '../../../platform/errors.js';
import { DAILY_SENT_LIMIT, freesAt, scheduledLimitReached } from '../domain/limits.js';
import { checkRange, localTimeToInstant } from '../domain/schedule.js';
import type { DestinationRecord, DestinationRepo } from '../infra/destination-repo.js';
import type { PostRecord, PostRepo } from '../infra/post-repo.js';
import type { PostActor, PostSignals, PostTransaction, PostViews } from './drafts.js';

const DAY_MS = 24 * 3_600_000;

export interface PostSendJobs {
  enqueueSend(
    tx: Db,
    payload: { postId: string; workspaceId: string; moment: string },
    startAfter: Date,
  ): Promise<void>;
}

export interface PostPublishingDeps {
  transaction: PostTransaction;
  posts: Pick<PostRepo, 'find' | 'lock' | 'schedule' | 'countScheduled' | 'sentTimesSince'>;
  destinations: Pick<DestinationRepo, 'find'>;
  workspaces: {
    lockActiveMembers(tx: Db, workspaceId: string, ids: string[]): Promise<string[]>;
  };
  lockPosts(tx: Db, workspaceId: string): Promise<void>;
  workspaceSettings: { timeZone(workspaceId: string): Promise<string | null> };
  bots: {
    postReadiness(workspaceId: string): Promise<{ state: string; telegramBotId: bigint } | null>;
  };
  jobs: PostSendJobs;
  signals: PostSignals;
  views: PostViews;
  clock: Clock;
}

type Readiness = { state: string; telegramBotId: bigint } | null;

function requireOwnerRole(actor: PostActor): void {
  if (actor.role !== 'owner') throw new OwnerOnlyError('Only a business owner can do this');
}

/** Destination as the post sees it: one of a replaced bot reads unavailable. */
function destinationState(d: DestinationRecord | null, bot: Readiness) {
  if (!d || d.removedAt) return null;
  const foreign = bot !== null && d.telegramBotId !== bot.telegramBotId;
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    username: d.username,
    availability: foreign ? ('unavailable' as const) : d.availability,
    problem: foreign ? ('not_current_bot' as const) : d.problem,
  };
}

export function createPostPublishing(deps: PostPublishingDeps) {
  const { transaction, posts, destinations, workspaces, workspaceSettings, jobs, signals } = deps;
  const { bots, views, clock } = deps;

  // Same-process gate per workspace; the database locks decide across processes.
  const gates = new Map<string, Promise<unknown>>();
  async function gated<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const prev = gates.get(workspaceId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    gates.set(workspaceId, tail);
    try {
      return await run;
    } finally {
      if (gates.get(workspaceId) === tail) gates.delete(workspaceId);
    }
  }

  async function lockOwner(tx: Db, workspaceId: string, actor: PostActor): Promise<void> {
    const active = await workspaces.lockActiveMembers(tx, workspaceId, [actor.accountId]);
    await deps.lockPosts(tx, workspaceId);
    if (!active.includes(actor.accountId)) {
      throw new OwnerOnlyError('Only a business owner can do this');
    }
  }

  /** Text, bot, destination: the checks publish and schedule share. */
  async function requireReady(tx: Db, workspaceId: string, row: PostRecord): Promise<void> {
    if (row.text.trim() === '') throw new PostTextInvalidError();
    const bot = await bots.postReadiness(workspaceId);
    if (!bot || bot.state !== 'connected') throw new PostsNeedWorkingBotError();
    const dest = row.destinationId
      ? await destinations.find(workspaceId, row.destinationId, tx)
      : null;
    const state = destinationState(dest, bot);
    if (!state || state.availability !== 'available') {
      throw new DestinationUnavailableError(state ? { problem: state.problem } : undefined);
    }
  }

  async function sentWindow(workspaceId: string, tx: Db | undefined) {
    const now = clock.now();
    const times = await posts.sentTimesSince(workspaceId, new Date(now.getTime() - DAY_MS), tx);
    return { times, count: times.length, frees: freesAt(times, now) };
  }

  async function queue(
    tx: Db,
    workspaceId: string,
    actor: PostActor,
    row: PostRecord,
    expectedVersion: number,
    moment: Date,
    kind: 'now' | 'time',
  ): Promise<void> {
    const saved = await posts.schedule(
      workspaceId,
      row.id,
      expectedVersion,
      { scheduledFor: moment, scheduledByAccountId: actor.accountId, scheduleKind: kind },
      clock.now(),
      tx,
    );
    if (!saved) throw new PostDraftChangedError();
    await jobs.enqueueSend(
      tx,
      { postId: row.id, workspaceId, moment: moment.toISOString() },
      moment,
    );
    await signals.postChanged(tx, workspaceId, row.id);
  }

  return {
    async getPublishConfirmation(
      workspaceId: string,
      actor: PostActor,
      postId: string,
    ): Promise<PublishConfirmation> {
      requireOwnerRole(actor);
      const row = await posts.find(workspaceId, postId);
      if (!row) throw new NotFoundError('Post not found');
      const bot = await bots.postReadiness(workspaceId);
      const dest = row.destinationId
        ? await destinations.find(workspaceId, row.destinationId)
        : null;
      const destination = destinationState(dest, bot);
      const sent = await sentWindow(workspaceId, undefined);
      const blockers: PublishBlocker[] = [];
      if (row.state !== 'draft') blockers.push('not_a_draft');
      if (row.text.trim() === '') blockers.push('text_empty');
      if (!destination) blockers.push('no_destination');
      else if (destination.availability !== 'available') blockers.push('destination_unavailable');
      if (!bot || bot.state !== 'connected') blockers.push('bot_not_working');
      if (sent.count >= DAILY_SENT_LIMIT) blockers.push('daily_limit');
      return {
        post_id: row.id,
        version: row.version,
        text: row.text,
        silent: row.silent,
        destination,
        time_zone: await workspaceSettings.timeZone(workspaceId),
        sent_last_24h: sent.count,
        daily_limit: DAILY_SENT_LIMIT,
        frees_at: sent.frees ? sent.frees.toISOString() : null,
        scheduled_waiting: await posts.countScheduled(workspaceId),
        scheduled_limit: 100,
        blockers,
      } as PublishConfirmation;
    },

    async publishPost(
      workspaceId: string,
      actor: PostActor,
      postId: string,
      input: { expected_version: number },
    ): Promise<PostScheduled> {
      requireOwnerRole(actor);
      return gated(workspaceId, async () => {
        if (!(await posts.find(workspaceId, postId))) throw new NotFoundError('Post not found');
        const outcome = await transaction(async (tx) => {
          await lockOwner(tx, workspaceId, actor);
          const row = await posts.lock(workspaceId, postId, tx);
          if (!row) throw new NotFoundError('Post not found');
          if (row.state !== 'draft') return 'already_scheduled' as const;
          if (row.version !== input.expected_version) throw new PostDraftChangedError();
          await requireReady(tx, workspaceId, row);
          const now = clock.now();
          const sent = await sentWindow(workspaceId, tx);
          if (sent.frees) {
            throw new PostDailyLimitReachedError({
              limit: DAILY_SENT_LIMIT,
              frees_at: sent.frees.toISOString(),
            });
          }
          await queue(tx, workspaceId, actor, row, input.expected_version, now, 'now');
          return 'queued' as const;
        });
        return { outcome, post: await views.postView(workspaceId, postId) };
      });
    },

    async schedulePost(
      workspaceId: string,
      actor: PostActor,
      postId: string,
      input: PostSchedule,
    ): Promise<PostScheduled> {
      requireOwnerRole(actor);
      return gated(workspaceId, async () => {
        if (!(await posts.find(workspaceId, postId))) throw new NotFoundError('Post not found');
        await transaction(async (tx) => {
          await lockOwner(tx, workspaceId, actor);
          const row = await posts.lock(workspaceId, postId, tx);
          if (!row) throw new NotFoundError('Post not found');
          const zone = await workspaceSettings.timeZone(workspaceId);
          if (!zone) throw new TimeZoneRequiredError();
          if (zone !== input.time_zone) throw new TimeZoneChangedError({ time_zone: zone });
          const local = localTimeToInstant(input.local_time, zone);
          if (!local.ok) {
            if (local.reason === 'does_not_exist') throw new PostTimeDoesNotExistError();
            throw new PostScheduleOutOfRangeError();
          }
          const range = checkRange(local.instant, clock.now());
          if (!range.ok) throw new PostScheduleOutOfRangeError({ reason: range.reason });
          if (row.state !== 'draft' && row.state !== 'scheduled') throw new PostNotADraftError();
          if (row.version !== input.expected_version) throw new PostDraftChangedError();
          await requireReady(tx, workspaceId, row);
          if (
            row.state === 'draft' &&
            scheduledLimitReached(await posts.countScheduled(workspaceId, tx))
          ) {
            throw new PostScheduledLimitReachedError();
          }
          await queue(tx, workspaceId, actor, row, input.expected_version, local.instant, 'time');
        });
        return { outcome: 'scheduled', post: await views.postView(workspaceId, postId) };
      });
    },
  };
}

export type PostPublishing = ReturnType<typeof createPostPublishing>;
