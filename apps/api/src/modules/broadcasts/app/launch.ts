import type { BroadcastLaunch, BroadcastLaunched, LaunchConfirmation } from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import {
  AccessRemovedError,
  BroadcastAudienceChangedError,
  BroadcastDraftChangedError,
  NotFoundError,
  OwnerOnlyError,
} from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import { canLaunch, isEditable, isStaleVersion, type MemberRole } from '../domain/broadcast.js';
import type {
  AudienceTagRepo,
  BroadcastJobs,
  BroadcastLogger,
  BroadcastRecord,
  BroadcastRepo,
  BroadcastSignals,
  BroadcastView,
  ContactsApi,
  DraftView,
  Executor,
  RecipientRepo,
  Transaction,
  WorkspacesApi,
} from './ports.js';
import type { LaunchPreview } from './preview.js';

export interface LaunchBroadcastDeps {
  transaction: Transaction;
  broadcasts: Pick<BroadcastRepo, 'lockLaunches' | 'lockForUpdate' | 'markLaunched'>;
  audienceTags: Pick<AudienceTagRepo, 'list' | 'replace'>;
  recipients: Pick<RecipientRepo, 'insertAll'>;
  contacts: Pick<ContactsApi, 'resolveTags'>;
  workspaces: Pick<WorkspacesApi, 'lockActiveMembers'>;
  preview: Pick<LaunchPreview, 'evaluateLaunch'>;
  signals: BroadcastSignals;
  jobs: Pick<BroadcastJobs, 'enqueueSendLink'>;
  views: BroadcastView;
  drafts: DraftView;
  clock: Clock;
  logger?: BroadcastLogger;
}

export interface LaunchBroadcast {
  /**
   * The owner's confirmed launch (ADR-0006): re-checks everything under the membership share lock,
   * the per-workspace launch lock and the broadcast row lock, then freezes the recipients and starts
   * sending. A second launch of the same broadcast answers `already_launched` (AC-06, AC-08, AC-09).
   */
  launchBroadcast(
    workspaceId: string,
    actor: { accountId: string; role: MemberRole },
    broadcastId: string,
    input: BroadcastLaunch,
  ): Promise<BroadcastLaunched>;
}

/** What the transaction decided; a refusal that needs a committed read is answered after it. */
type Outcome =
  | { kind: 'launched'; row: BroadcastRecord; breakdown: LaunchConfirmation['breakdown'] }
  | { kind: 'already_launched' }
  | { kind: 'draft_changed' }
  | { kind: 'audience_changed'; confirmation: LaunchConfirmation };

export function createLaunchBroadcast(deps: LaunchBroadcastDeps): LaunchBroadcast {
  const { transaction, broadcasts, audienceTags, recipients, contacts, workspaces } = deps;
  const { preview, signals, jobs, views, drafts, clock, logger } = deps;

  /** The tag rows take the names at launch; rows of tags gone since are deleted (data-model §8). */
  async function freezeTagNames(tx: Executor, row: BroadcastRecord) {
    if (row.audienceKind !== 'tags') return;
    const stored = await audienceTags.list(row.workspaceId, row.id, tx);
    const current = new Map(
      (
        await contacts.resolveTags(
          row.workspaceId,
          stored.map((t) => t.tagId),
          tx,
        )
      ).map((t) => [t.id, t.name]),
    );
    await audienceTags.replace(
      row.workspaceId,
      row.id,
      stored.flatMap((t) => (current.has(t.tagId) ? [{ ...t, name: current.get(t.tagId)! }] : [])),
      tx,
    );
  }

  return {
    async launchBroadcast(workspaceId, actor, broadcastId, input) {
      if (!canLaunch(actor.role)) throw new OwnerOnlyError('Only a business owner can launch.');

      const outcome = await transaction(async (tx): Promise<Outcome> => {
        // Lock order (sad.md §8): membership FOR SHARE → launch lock → broadcast row.
        const active = await workspaces.lockActiveMembers(tx, workspaceId, [actor.accountId]);
        if (!active.includes(actor.accountId)) {
          throw new AccessRemovedError('Your access to this workspace was removed');
        }
        await broadcasts.lockLaunches(workspaceId, tx);
        const row = await broadcasts.lockForUpdate(workspaceId, broadcastId, tx);
        if (row === null) throw new NotFoundError('Broadcast not found.');
        if (!isEditable(row.status)) return { kind: 'already_launched' };
        if (isStaleVersion({ expected: input.expected_version, current: row.version })) {
          return { kind: 'draft_changed' };
        }

        const { confirmation, reachable, telegramBotId } = await preview.evaluateLaunch(row, tx);
        if (confirmation.fingerprint !== input.fingerprint) {
          return { kind: 'audience_changed', confirmation };
        }

        const at = clock.now();
        const { breakdown } = confirmation;
        // `reachable` is sorted by contact id: the fingerprint's order is the positions' order.
        await recipients.insertAll(
          workspaceId,
          broadcastId,
          reachable.map((c, i) => ({
            id: newId(),
            contactId: c.id,
            position: i + 1,
            telegramUserId: c.telegramUserId,
          })),
          tx,
        );
        await freezeTagNames(tx, row);
        await broadcasts.markLaunched(
          workspaceId,
          broadcastId,
          {
            text: confirmation.text,
            launchedByAccountId: actor.accountId,
            launchedAt: at,
            telegramBotId,
            audienceSize: breakdown.audience_size,
            blockedCount: breakdown.blocked_count,
            neverWroteCount: breakdown.never_wrote_count,
            recipientCount: breakdown.recipient_count,
          },
          tx,
        );
        await jobs.enqueueSendLink(tx, workspaceId);
        await signals.broadcastChanged(tx, workspaceId, broadcastId, 'status');
        return { kind: 'launched', row, breakdown };
      });

      switch (outcome.kind) {
        case 'draft_changed':
          throw new BroadcastDraftChangedError(await drafts.draftView(workspaceId, broadcastId));
        case 'audience_changed':
          throw new BroadcastAudienceChangedError(outcome.confirmation);
        case 'launched':
          logger?.info(
            {
              workspace_id: workspaceId,
              broadcast_id: broadcastId,
              recipient_count: outcome.breakdown.recipient_count,
              blocked_count: outcome.breakdown.blocked_count,
              never_wrote_count: outcome.breakdown.never_wrote_count,
            },
            'broadcast.launched',
          );
          break;
        case 'already_launched':
          break;
      }
      const broadcast = await views.broadcastView(workspaceId, broadcastId);
      // A launched broadcast never returns to draft and cannot be deleted.
      if (broadcast.status === 'draft') throw new Error('launched broadcast read as a draft');
      return { outcome: outcome.kind, broadcast };
    },
  };
}
