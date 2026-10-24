import type {
  BroadcastGroupAddMatching,
  BroadcastGroupChange,
  BroadcastGroupMatching,
  BroadcastGroupMatchingAdded,
  BroadcastGroupMembership,
  BroadcastGroupPage,
  MemberRef,
} from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import {
  BroadcastAudienceTooLargeError,
  BroadcastDraftChangedError,
  BroadcastNotADraftError,
  NotFoundError,
  ValidationError,
} from '../../../platform/errors.js';
import { checkAudienceSize, fitsAudience, type TagMode } from '../domain/audience.js';
import { isEditable } from '../domain/broadcast.js';
import { decodeGroupCursor, encodeGroupCursor } from '../domain/cursor.js';
import type {
  BotsApi,
  BroadcastRecord,
  BroadcastRepo,
  BroadcastSignals,
  ContactsApi,
  DraftView,
  Executor,
  GroupRepo,
  Transaction,
  WorkspacesApi,
} from './ports.js';

export interface BroadcastGroupDeps {
  transaction: Transaction;
  broadcasts: Pick<BroadcastRepo, 'find' | 'lockForUpdate' | 'touch'>;
  groups: GroupRepo;
  contacts: Pick<ContactsApi, 'resolveTags' | 'matchingContactIds' | 'contactCards'>;
  bots: BotsApi;
  workspaces: Pick<WorkspacesApi, 'displayNames'>;
  signals: BroadcastSignals;
  views: DraftView;
  clock: Clock;
}

export interface MatchingFilter {
  q?: string | null;
  mode: TagMode;
  tagIds: readonly string[];
}

/**
 * The draft's broadcast group (sad.md §6 flow 8, ADR-0005): set writes under the broadcast row
 * lock that never raise the version, so two members' adds and removes both stand (AC-03).
 */
export interface BroadcastGroup {
  addContact(
    workspaceId: string,
    actorAccountId: string,
    broadcastId: string,
    contactId: string,
  ): Promise<BroadcastGroupChange>;
  removeContact(
    workspaceId: string,
    actorAccountId: string,
    broadcastId: string,
    contactId: string,
  ): Promise<BroadcastGroupChange>;
  /** "Add all matching", first step: the counts; writes nothing (AC-04, AC-05). */
  countMatching(
    workspaceId: string,
    broadcastId: string,
    filter: MatchingFilter,
  ): Promise<BroadcastGroupMatching>;
  /** "Add all matching", confirmed: the current matches as a whole or not at all (AC-04, AC-05). */
  addMatching(
    workspaceId: string,
    actorAccountId: string,
    broadcastId: string,
    input: BroadcastGroupAddMatching,
  ): Promise<BroadcastGroupMatchingAdded>;
  /** 50 rows, newest added first, with cards for the current bot (AC-04, AC-14). */
  groupPage(workspaceId: string, broadcastId: string, after?: string): Promise<BroadcastGroupPage>;
  /** Which of one picker page's contact ids are in the group. */
  membership(
    workspaceId: string,
    broadcastId: string,
    contactIds: readonly string[],
  ): Promise<BroadcastGroupMembership>;
}

export const GROUP_PAGE_SIZE = 50;
const NOT_FOUND = 'Broadcast not found.';
const NO_TAGS_WITH_TAGS = '"No tags" cannot be combined with chosen tags.';

/** A refusal decided under the lock that needs the committed draft (read after the transaction). */
class SwitchedToTags {}

export function createBroadcastGroup(deps: BroadcastGroupDeps): BroadcastGroup {
  const { transaction, broadcasts, groups, contacts, bots, workspaces, signals, views, clock } =
    deps;

  async function found(workspaceId: string, id: string): Promise<BroadcastRecord> {
    const row = await broadcasts.find(workspaceId, id);
    if (row === null) throw new NotFoundError(NOT_FOUND);
    return row;
  }

  /** The broadcast row `FOR NO KEY UPDATE` (§8): unknown → 404, launched → not a draft. */
  async function lockDraft(tx: Executor, workspaceId: string, id: string) {
    const row = await broadcasts.lockForUpdate(workspaceId, id, tx);
    if (row === null) throw new NotFoundError(NOT_FOUND);
    if (!isEditable(row.status)) {
      throw new BroadcastNotADraftError(id, row.status as 'sending' | 'sent' | 'stopped');
    }
    return row;
  }

  /** An add under the lock; a draft whose audience became a tag audience is refused as changed. */
  async function groupWrite<T>(
    workspaceId: string,
    broadcastId: string,
    write: (tx: Executor) => Promise<T>,
  ): Promise<T> {
    try {
      return await transaction(async (tx) => {
        const row = await lockDraft(tx, workspaceId, broadcastId);
        if (row.audienceKind !== 'group') throw new SwitchedToTags();
        return write(tx);
      });
    } catch (e) {
      if (e instanceof SwitchedToTags) {
        throw new BroadcastDraftChangedError(await views.draftView(workspaceId, broadcastId));
      }
      throw e;
    }
  }

  /** The last change by the caller (version kept) and one `group` signal. */
  async function written(tx: Executor, workspaceId: string, id: string, actor: string) {
    await broadcasts.touch(workspaceId, id, actor, clock.now(), tx);
    await signals.broadcastChanged(tx, workspaceId, id, 'group');
  }

  function checkFilter(mode: TagMode, tagIds: readonly string[], field: string) {
    if (mode === 'none' && tagIds.length > 0)
      throw new ValidationError(NO_TAGS_WITH_TAGS, { field });
  }

  const matching = (workspaceId: string, f: MatchingFilter, tx?: Executor) =>
    contacts.matchingContactIds(
      workspaceId,
      {
        q: f.q ?? null,
        mode: f.mode,
        tagIds: f.mode === 'none' ? [] : f.tagIds,
      },
      tx,
    );

  async function refs(workspaceId: string, accountIds: readonly string[]) {
    const unique = [...new Set(accountIds)];
    const names = unique.length
      ? await workspaces.displayNames(workspaceId, unique)
      : new Map<string, string>();
    return (accountId: string): MemberRef => ({
      account_id: accountId,
      display_name: names.get(accountId) ?? '?',
    });
  }

  return {
    async addContact(workspaceId, actorAccountId, broadcastId, contactId) {
      await found(workspaceId, broadcastId);
      // A contact of another workspace is unstorable (composite FK) and answers 404 (AC-08).
      const [card] = await contacts.contactCards(workspaceId, [contactId], null);
      if (card === undefined) throw new NotFoundError('Not found.');
      return groupWrite(workspaceId, broadcastId, async (tx) => {
        const size = await groups.count(workspaceId, broadcastId, tx);
        const there = await groups.membership(workspaceId, broadcastId, [contactId], tx);
        if (there.length > 0) {
          return { broadcast_id: broadcastId, outcome: 'unchanged' as const, group_size: size };
        }
        if (!fitsAudience(size, 1)) throw new BroadcastAudienceTooLargeError(size);
        await groups.add(workspaceId, broadcastId, contactId, actorAccountId, clock.now(), tx);
        await written(tx, workspaceId, broadcastId, actorAccountId);
        return { broadcast_id: broadcastId, outcome: 'added' as const, group_size: size + 1 };
      });
    },

    async removeContact(workspaceId, actorAccountId, broadcastId, contactId) {
      return transaction(async (tx) => {
        await lockDraft(tx, workspaceId, broadcastId);
        const removed = await groups.remove(workspaceId, broadcastId, contactId, tx);
        if (removed) await written(tx, workspaceId, broadcastId, actorAccountId);
        return {
          broadcast_id: broadcastId,
          outcome: removed ? ('removed' as const) : ('unchanged' as const),
          group_size: await groups.count(workspaceId, broadcastId, tx),
        };
      });
    },

    async countMatching(workspaceId, broadcastId, filter) {
      checkFilter(filter.mode, filter.tagIds, 'tag');
      await found(workspaceId, broadcastId);
      const requested = [...new Set(filter.tagIds)];
      const existing = new Set(
        (await contacts.resolveTags(workspaceId, requested)).map((t) => t.id),
      );
      const [ids, inGroup] = await Promise.all([
        matching(workspaceId, filter),
        groups.ids(workspaceId, broadcastId),
      ]);
      const group = new Set(inGroup);
      const already = ids.filter((id) => group.has(id)).length;
      return {
        broadcast_id: broadcastId,
        matching_count: ids.length,
        already_in_group_count: already,
        to_add_count: ids.length - already,
        can_add: checkAudienceSize(inGroup.length).canAdd,
        missing_tag_ids: requested.filter((id) => !existing.has(id)),
      };
    },

    async addMatching(workspaceId, actorAccountId, broadcastId, input) {
      checkFilter(input.mode, input.tag_ids, 'tag_ids');
      return groupWrite(workspaceId, broadcastId, async (tx) => {
        // The matches now, under the row lock, minus the group rows (AC-04).
        const group = new Set(await groups.ids(workspaceId, broadcastId, tx));
        const ids = await matching(
          workspaceId,
          {
            q: input.q ?? null,
            mode: input.mode,
            tagIds: input.tag_ids,
          },
          tx,
        );
        const toAdd = ids.filter((id) => !group.has(id));
        if (!fitsAudience(group.size, toAdd.length)) {
          throw new BroadcastAudienceTooLargeError(group.size);
        }
        const added =
          toAdd.length === 0
            ? 0
            : await groups.addMany(
                workspaceId,
                broadcastId,
                toAdd,
                actorAccountId,
                clock.now(),
                tx,
              );
        if (added > 0) await written(tx, workspaceId, broadcastId, actorAccountId);
        return {
          broadcast_id: broadcastId,
          expected_count: input.expected_count,
          added_count: added,
          group_size: group.size + added,
        };
      });
    },

    async groupPage(workspaceId, broadcastId, afterCursor) {
      let after;
      if (afterCursor !== undefined) {
        after = decodeGroupCursor(afterCursor) ?? undefined;
        if (after === undefined) throw new ValidationError('The cursor is not valid.');
      }
      const row = await found(workspaceId, broadcastId);
      const base = {
        workspace_id: workspaceId,
        broadcast_id: broadcastId,
        has_prev: after !== undefined,
      };
      if (row.audienceKind !== 'group') {
        return { ...base, size: 0, items: [], has_next: false, next_cursor: null };
      }
      const [page, size, bot] = await Promise.all([
        groups.page(workspaceId, broadcastId, after, GROUP_PAGE_SIZE),
        groups.count(workspaceId, broadcastId),
        bots.launchReadiness(workspaceId),
      ]);
      const [cards, ref] = await Promise.all([
        contacts.contactCards(
          workspaceId,
          page.rows.map((r) => r.contactId),
          bot?.telegramBotId ?? null,
        ),
        refs(
          workspaceId,
          page.rows.map((r) => r.addedByAccountId),
        ),
      ]);
      const byId = new Map(cards.map((c) => [c.id, c]));
      const last = page.rows.at(-1);
      return {
        ...base,
        size,
        items: page.rows.flatMap((r) => {
          const c = byId.get(r.contactId);
          if (c === undefined) return [];
          return [
            {
              contact: {
                id: c.id,
                first_name: c.firstName,
                last_name: c.lastName,
                username: c.username,
                tags: c.tags,
                blocked_since: c.blockedSince === null ? null : c.blockedSince.toISOString(),
              },
              added_by: ref(r.addedByAccountId),
              added_at: r.addedAt.toISOString(),
            },
          ];
        }),
        has_next: page.hasNext,
        next_cursor:
          page.hasNext && last
            ? encodeGroupCursor({ addedAt: last.addedAt, contactId: last.contactId })
            : null,
      };
    },

    async membership(workspaceId, broadcastId, contactIds) {
      await found(workspaceId, broadcastId);
      return {
        broadcast_id: broadcastId,
        contact_ids: await groups.membership(workspaceId, broadcastId, contactIds),
      };
    },
  };
}
