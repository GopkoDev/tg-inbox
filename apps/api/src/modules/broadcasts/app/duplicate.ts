import type { BroadcastDraft, BroadcastDuplicate } from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import {
  BroadcastNotEndedError,
  NotFoundError,
  ValidationError,
} from '../../../platform/errors.js';
import { newId } from '../../../platform/ids.js';
import { checkDuplicateChoice, duplicateName } from '../domain/duplicate.js';
import type {
  AudienceTagRepo,
  BroadcastRecord,
  BroadcastRepo,
  BroadcastSignals,
  DraftView,
  Executor,
  GroupRepo,
  RecipientRepo,
  Transaction,
} from './ports.js';

export interface DuplicateDeps {
  transaction: Transaction;
  broadcasts: Pick<BroadcastRepo, 'find' | 'insertDraft'>;
  audienceTags: Pick<AudienceTagRepo, 'copy'>;
  groups: Pick<GroupRepo, 'ids' | 'addMany'>;
  recipients: Pick<RecipientRepo, 'allContactIds' | 'notReachedContactIds'>;
  signals: BroadcastSignals;
  views: DraftView;
  clock: Clock;
}

export interface Duplicate {
  /**
   * Any member copies any broadcast into a new draft "Copy of …" they author; the source does not
   * change (sad.md §6 flow 15; AC-07, AC-13). Needs no bot.
   */
  duplicateBroadcast(
    workspaceId: string,
    actorAccountId: string,
    sourceId: string,
    input: { audience: BroadcastDuplicate['audience']; include_not_confirmed?: boolean },
  ): Promise<BroadcastDraft>;
}

export function createDuplicate(deps: DuplicateDeps): Duplicate {
  const { transaction, broadcasts, audienceTags, groups, recipients, signals, views, clock } = deps;

  /** The contacts the copy's group gets, or null when the copy keeps the source's tag rows. */
  async function groupContacts(
    tx: Executor,
    source: BroadcastRecord,
    input: { audience: BroadcastDuplicate['audience']; include_not_confirmed?: boolean },
  ): Promise<string[] | null> {
    const { workspaceId, id } = source;
    switch (input.audience) {
      case 'same':
        return source.audienceKind === 'group' ? groups.ids(workspaceId, id, tx) : null;
      case 'same_tags':
        return null;
      case 'all_recipients':
        return recipients.allContactIds(workspaceId, id, tx);
      case 'not_reached':
        return recipients.notReachedContactIds(
          workspaceId,
          id,
          input.include_not_confirmed ?? false,
          tx,
        );
    }
  }

  return {
    async duplicateBroadcast(workspaceId, actorAccountId, sourceId, input) {
      const source = await broadcasts.find(workspaceId, sourceId);
      if (source === null) throw new NotFoundError('Broadcast not found.');
      const fit = checkDuplicateChoice({
        status: source.status,
        audienceKind: source.audienceKind,
        choice: input.audience,
      });
      if (!fit.ok) {
        if (fit.error === 'not_ended') throw new BroadcastNotEndedError(sourceId);
        throw new ValidationError('This audience choice does not fit the broadcast.', {
          field: 'audience',
        });
      }

      const id = newId();
      const now = clock.now();
      await transaction(async (tx) => {
        const contactIds = await groupContacts(tx, source, input);
        await broadcasts.insertDraft(
          workspaceId,
          {
            id,
            name: duplicateName(source.name),
            text: source.text,
            audienceKind: contactIds === null ? 'tags' : 'group',
            tagMode: contactIds === null ? source.tagMode : null,
            authorAccountId: actorAccountId,
            createdAt: now,
          },
          tx,
        );
        if (contactIds === null) {
          await audienceTags.copy(workspaceId, sourceId, id, tx);
        } else if (contactIds.length > 0) {
          // The composite foreign key re-checks every copied contact against the workspace (AC-08).
          await groups.addMany(workspaceId, id, contactIds, actorAccountId, now, tx);
        }
        await signals.broadcastChanged(tx, workspaceId, id, 'draft');
      });
      return views.draftView(workspaceId, id);
    },
  };
}
