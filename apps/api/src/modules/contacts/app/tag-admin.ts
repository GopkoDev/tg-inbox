import type {
  TagDeleted,
  TagList,
  TagRenameResult,
  TagWithCount as TagWithCountDto,
} from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import {
  TagCountChangedError,
  TagMergeTargetChangedError,
  TagNameInvalidError,
  TagNameTakenError,
  TagNotFoundError,
  ValidationError,
} from '../../../platform/errors.js';
import { checkTagName } from '../domain/tag-name.js';
import type {
  ContactTagRepo,
  Executor,
  TagHistoryRepo,
  TagRepo,
  TagSignals,
  TagWithCount,
} from './ports.js';

export interface TagAdminDeps {
  /** Runs `fn` in one database transaction; a throw rolls everything back. */
  transaction: <T>(fn: (tx: Executor) => Promise<T>) => Promise<T>;
  tags: Pick<
    TagRepo,
    | 'lockWorkspaceTags'
    | 'lockForUpdate'
    | 'findByKey'
    | 'countFor'
    | 'listWithCounts'
    | 'rename'
    | 'delete'
  >;
  contactTags: Pick<ContactTagRepo, 'mergeInto' | 'deleteLinksReturning'>;
  tagHistory: Pick<TagHistoryRepo, 'appendMerged' | 'appendDeleted'>;
  signals: Pick<TagSignals, 'tagsChanged'>;
  clock: Clock;
  /** Ids only; `tag.merged` feeds the look-alike KPI (sad.md §7). */
  logger?: { info(obj: object, msg: string): void };
}

export interface RenameInput {
  name: string;
  /** The tag the owner confirmed merging into (the one that held the name). */
  mergeIntoTagId?: string | undefined;
}

/** The owner's tag management: the list with counts, rename / merge and delete (flows 2, 3). */
export interface TagAdmin {
  listTags(workspaceId: string): Promise<TagList>;
  renameTag(
    workspaceId: string,
    ownerAccountId: string,
    tagId: string,
    input: RenameInput,
  ): Promise<TagRenameResult>;
  deleteTag(
    workspaceId: string,
    ownerAccountId: string,
    tagId: string,
    expectedCount: number,
  ): Promise<TagDeleted>;
}

const dto = (t: TagWithCount): TagWithCountDto => ({
  id: t.id,
  name: t.name,
  contact_count: t.contactCount,
});

/**
 * Owner paths take `tags:<ws>` first, then the tag rows `FOR UPDATE` in id order (ADR-0004), and
 * never touch the member rate limit: an owner's merged / deleted entries are not counted (AC-15).
 * A refusal throws inside the transaction, so nothing is written and nothing is published.
 */
export function createTagAdmin(deps: TagAdminDeps): TagAdmin {
  const { transaction, tags, contactTags, tagHistory, signals, clock } = deps;

  return {
    async listTags(workspaceId) {
      const rows = await tags.listWithCounts(workspaceId);
      return { workspace_id: workspaceId, items: rows.map(dto) };
    },

    async renameTag(workspaceId, ownerAccountId, tagId, input) {
      const checked = checkTagName(input.name);
      if (!checked.ok) throw new TagNameInvalidError();
      const { mergeIntoTagId } = input;
      if (mergeIntoTagId === tagId) {
        throw new ValidationError('A tag cannot be merged into itself', {
          field: 'merge_into_tag_id',
        });
      }

      const result = await transaction(async (tx): Promise<TagRenameResult> => {
        await tags.lockWorkspaceTags(workspaceId, tx);
        const locked = await tags.lockForUpdate(
          workspaceId,
          mergeIntoTagId ? [tagId, mergeIntoTagId] : [tagId],
          tx,
        );
        const tag = locked.find((t) => t.id === tagId);
        if (!tag) throw new TagNotFoundError(tagId);

        const holder = await tags.findByKey(workspaceId, checked.key, tx);
        const holderWithCount = async (): Promise<TagWithCount | null> =>
          holder && holder.id !== tag.id
            ? {
                id: holder.id,
                name: holder.name,
                contactCount: await tags.countFor(workspaceId, holder.id, tx),
              }
            : null;

        if (mergeIntoTagId === undefined) {
          if (checked.name === tag.name) {
            return {
              workspace_id: workspaceId,
              outcome: 'unchanged',
              tag: dto({
                id: tag.id,
                name: tag.name,
                contactCount: await tags.countFor(workspaceId, tag.id, tx),
              }),
              merged_tag_id: null,
            };
          }
          const taken = await holderWithCount();
          if (taken) throw new TagNameTakenError(dto(taken));
          await tags.rename(workspaceId, tag.id, checked.name, checked.key, tx);
          await signals.tagsChanged(tx, workspaceId);
          return {
            workspace_id: workspaceId,
            outcome: 'renamed',
            tag: dto({
              id: tag.id,
              name: checked.name,
              contactCount: await tags.countFor(workspaceId, tag.id, tx),
            }),
            merged_tag_id: null,
          };
        }

        // The merge: the target must still exist and still hold the name the owner confirmed.
        const target = locked.find((t) => t.id === mergeIntoTagId);
        if (!target || target.key !== checked.key) {
          const current = await holderWithCount();
          throw new TagMergeTargetChangedError(current && dto(current));
        }
        const carriers = await contactTags.mergeInto(workspaceId, tag.id, target.id, tx);
        await tagHistory.appendMerged(
          workspaceId,
          carriers,
          { id: tag.id, name: tag.name },
          { id: target.id, name: target.name },
          ownerAccountId,
          clock.now(),
          tx,
        );
        await tags.delete(workspaceId, tag.id, tx);
        await signals.tagsChanged(tx, workspaceId);
        return {
          workspace_id: workspaceId,
          outcome: 'merged',
          tag: dto({
            id: target.id,
            name: target.name,
            contactCount: await tags.countFor(workspaceId, target.id, tx),
          }),
          merged_tag_id: tag.id,
        };
      });

      if (result.outcome === 'merged') {
        // The contract's log event (events.md "Log event: tag.merged"): ids only.
        deps.logger?.info(
          {
            event: 'tag.merged',
            workspace_id: workspaceId,
            merged_tag_id: result.merged_tag_id,
            target_tag_id: result.tag.id,
            actor_account_id: ownerAccountId,
          },
          'tag.merged',
        );
      }
      return result;
    },

    async deleteTag(workspaceId, ownerAccountId, tagId, expectedCount) {
      return transaction(async (tx) => {
        await tags.lockWorkspaceTags(workspaceId, tx);
        const [tag] = await tags.lockForUpdate(workspaceId, [tagId], tx);
        if (!tag) throw new TagNotFoundError(tagId);
        const contactIds = await contactTags.deleteLinksReturning(workspaceId, tag.id, tx);
        if (contactIds.length !== expectedCount) {
          // Rolls the link delete back; the owner is asked again with the number as it is now.
          throw new TagCountChangedError(
            dto({ id: tag.id, name: tag.name, contactCount: contactIds.length }),
          );
        }
        await tagHistory.appendDeleted(
          workspaceId,
          contactIds,
          { id: tag.id, name: tag.name },
          ownerAccountId,
          clock.now(),
          tx,
        );
        await tags.delete(workspaceId, tag.id, tx);
        await signals.tagsChanged(tx, workspaceId);
        return { workspace_id: workspaceId, tag_id: tag.id, removed_from_count: contactIds.length };
      });
    },
  };
}
