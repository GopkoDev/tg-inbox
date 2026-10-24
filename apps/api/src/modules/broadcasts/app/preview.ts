import { broadcastTextLength, checkBroadcastText, type LaunchConfirmation } from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import {
  BroadcastAudienceTooLargeError,
  BroadcastLaunchLimitReachedError,
  BroadcastNeedsWorkingBotError,
  BroadcastNoReachableContactError,
  BroadcastNotADraftError,
  BroadcastTextInvalidError,
  NotFoundError,
  OwnerOnlyError,
} from '../../../platform/errors.js';
import { audienceFingerprint, checkAudienceSize } from '../domain/audience.js';
import { canLaunch, isEditable, type MemberRole } from '../domain/broadcast.js';
import type {
  AudienceSpec,
  AudienceTagRepo,
  BotsApi,
  BroadcastRecord,
  BroadcastRepo,
  ContactsApi,
  Executor,
  GroupRepo,
  ReachableContact,
} from './ports.js';

export interface LaunchPreviewDeps {
  broadcasts: Pick<BroadcastRepo, 'find' | 'launchesSince' | 'tenthNewestLaunchedAt'>;
  audienceTags: Pick<AudienceTagRepo, 'list'>;
  groups: Pick<GroupRepo, 'ids'>;
  contacts: Pick<ContactsApi, 'launchAudience'>;
  bots: BotsApi;
  clock: Clock;
}

/** What a launch would do now: the confirmation and the reachable set it was computed from. */
export interface LaunchEvaluation {
  confirmation: LaunchConfirmation;
  /** Sorted by contact id: the fingerprint's order and the recipients' positions (ADR-0006). */
  reachable: ReachableContact[];
  telegramBotId: bigint;
}

export interface LaunchPreview {
  /**
   * Every launch check after the role and the draft status, in the contract's order: text, a
   * working bot, the 10-per-24-h cap, at most 10 000, at least one reachable (AC-05, AC-09, AC-10).
   * `tx` lets the launch (T20) re-run it inside its transaction.
   */
  evaluateLaunch(row: BroadcastRecord, tx?: Executor): Promise<LaunchEvaluation>;
  /** The confirmation, which is also the pre-check; writes nothing (AC-06, AC-07). */
  getLaunchConfirmation(
    workspaceId: string,
    actor: { accountId: string; role: MemberRole },
    broadcastId: string,
  ): Promise<LaunchConfirmation>;
}

export const LAUNCH_LIMIT = 10;
const DAY_MS = 24 * 3_600_000;

export function createLaunchPreview(deps: LaunchPreviewDeps): LaunchPreview {
  const { broadcasts, audienceTags, groups, contacts, bots, clock } = deps;

  async function audienceOf(row: BroadcastRecord, tx?: Executor): Promise<AudienceSpec> {
    if (row.audienceKind === 'group') {
      return { kind: 'ids', contactIds: await groups.ids(row.workspaceId, row.id, tx) };
    }
    // Tags deleted or merged away are left out by `contacts` (ADR-0004).
    const stored = await audienceTags.list(row.workspaceId, row.id, tx);
    return {
      kind: 'tags',
      mode: row.tagMode!,
      include: stored.filter((t) => t.kind === 'include').map((t) => t.tagId),
      exclude: stored.filter((t) => t.kind === 'exclude').map((t) => t.tagId),
    };
  }

  async function checkCap(workspaceId: string, tx?: Executor) {
    const now = clock.now();
    const recent = await broadcasts.launchesSince(
      workspaceId,
      new Date(now.getTime() - DAY_MS),
      tx,
    );
    if (recent < LAUNCH_LIMIT) return;
    const tenth = await broadcasts.tenthNewestLaunchedAt(workspaceId, tx);
    const next = new Date((tenth ?? now).getTime() + DAY_MS);
    const retryAfter = Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
    throw new BroadcastLaunchLimitReachedError(next, retryAfter);
  }

  async function evaluateLaunch(row: BroadcastRecord, tx?: Executor): Promise<LaunchEvaluation> {
    const text = checkBroadcastText(row.text);
    if (!text.ok) throw new BroadcastTextInvalidError(broadcastTextLength(row.text));

    const bot = await bots.launchReadiness(row.workspaceId, tx);
    if (bot === null || bot.state === 'disconnected') {
      throw new BroadcastNeedsWorkingBotError('not_connected');
    }
    if (bot.state !== 'connected') throw new BroadcastNeedsWorkingBotError(bot.state);

    await checkCap(row.workspaceId, tx);

    const audience = await audienceOf(row, tx);
    // One statement: the count shown and the set fingerprinted always agree (AC-06).
    const counted = await contacts.launchAudience(row.workspaceId, audience, bot.telegramBotId, tx);
    if (!checkAudienceSize(counted.audienceSize).ok || counted.reach === null) {
      throw new BroadcastAudienceTooLargeError(counted.audienceSize);
    }
    const reachable = counted.reachable;
    const breakdown = {
      audience_size: counted.audienceSize,
      blocked_count: counted.reach.blocked,
      never_wrote_count: counted.reach.neverWrote,
      recipient_count: reachable.length,
    };
    if (breakdown.recipient_count === 0) throw new BroadcastNoReachableContactError(breakdown);

    return {
      confirmation: {
        broadcast_id: row.id,
        version: row.version,
        name: row.name,
        text: text.text,
        breakdown,
        fingerprint: audienceFingerprint(reachable.map((c) => c.id)),
      },
      reachable,
      telegramBotId: bot.telegramBotId,
    };
  }

  return {
    evaluateLaunch,

    async getLaunchConfirmation(workspaceId, actor, broadcastId) {
      if (!canLaunch(actor.role)) throw new OwnerOnlyError('Only a business owner can launch.');
      const row = await broadcasts.find(workspaceId, broadcastId);
      if (row === null) throw new NotFoundError('Broadcast not found.');
      if (!isEditable(row.status)) {
        throw new BroadcastNotADraftError(
          broadcastId,
          row.status as 'sending' | 'sent' | 'stopped',
        );
      }
      return (await evaluateLaunch(row)).confirmation;
    },
  };
}
