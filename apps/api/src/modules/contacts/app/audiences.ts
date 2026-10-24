import {
  normalizeSearchQuery,
  type AudienceBreakdown,
  type AudienceQuery,
  type AudienceSpec,
  type ContactCard,
  type Executor,
  type LaunchAudience,
  type ReachableContact,
  type TagFilterMode,
  type TagRepo,
} from './ports.js';

/** 10 000 + 1: the extra row proves "over the limit" to the caller (AC-05). */
export const REACHABLE_LIMIT = 10_001;

export interface ContactAudiencesDeps {
  audiences: AudienceQuery;
  tags: Pick<TagRepo, 'resolveIds' | 'namesOf'>;
}

/**
 * What `broadcasts` asks `contacts` about an audience (sad.md §5, ADR-0004): every answer is for
 * one workspace and, where reach matters, one Telegram bot id.
 */
export interface ContactAudiences {
  audienceBreakdown(
    workspaceId: string,
    audience: AudienceSpec,
    telegramBotId: bigint | null,
  ): Promise<AudienceBreakdown>;
  /** Sorted by contact id (the fingerprint's and the positions' order), at most `limit`. */
  reachableContacts(
    workspaceId: string,
    audience: AudienceSpec,
    telegramBotId: bigint,
    limit?: number,
  ): Promise<ReachableContact[]>;
  /**
   * The breakdown and the reachable contacts from one statement, so the count and the set always
   * agree (AC-06); joins the caller's transaction when given one.
   */
  launchAudience(
    workspaceId: string,
    audience: AudienceSpec,
    telegramBotId: bigint,
    tx?: Executor,
  ): Promise<LaunchAudience>;
  /** The ids that are (still) tags of the workspace. */
  existingTags(workspaceId: string, tagIds: readonly string[], tx?: Executor): Promise<string[]>;
  /** The given ids that are tags of the workspace, with their current names. */
  tagNames(
    workspaceId: string,
    tagIds: readonly string[],
    tx?: Executor,
  ): Promise<{ id: string; name: string }[]>;
  /** The Contacts list's matching set for a search and a tag filter, sorted by id. */
  matchingContactIds(
    workspaceId: string,
    filter: { q?: string | null; mode: TagFilterMode; tagIds: readonly string[] },
    tx?: Executor,
  ): Promise<string[]>;
  contactCards(
    workspaceId: string,
    contactIds: readonly string[],
    telegramBotId: bigint | null,
  ): Promise<ContactCard[]>;
  isBlocked(workspaceId: string, contactId: string, telegramBotId: bigint): Promise<boolean>;
}

const EMPTY_REACH = { blocked: 0, neverWrote: 0, reachable: 0 };

export function createContactAudiences({
  audiences,
  tags,
}: ContactAudiencesDeps): ContactAudiences {
  const existing = async (workspaceId: string, ids: readonly string[], tx?: Executor) => {
    const requested = [...new Set(ids)];
    if (requested.length === 0) return [];
    const found = new Set(await tags.resolveIds(workspaceId, requested, tx));
    return requested.filter((id) => found.has(id));
  };

  /** Tags that are gone are left out of the evaluation; a group's ids are deduplicated. */
  const resolved = async (
    workspaceId: string,
    audience: AudienceSpec,
    tx?: Executor,
  ): Promise<AudienceSpec> =>
    audience.kind === 'ids'
      ? { kind: 'ids', contactIds: [...new Set(audience.contactIds)] }
      : {
          kind: 'tags',
          mode: audience.mode,
          include:
            audience.mode === 'none' ? [] : await existing(workspaceId, audience.include, tx),
          exclude:
            audience.mode === 'none' ? [] : await existing(workspaceId, audience.exclude, tx),
        };

  const isEmptyGroup = (audience: AudienceSpec) =>
    audience.kind === 'ids' && audience.contactIds.length === 0;

  return {
    async audienceBreakdown(workspaceId, audience, telegramBotId) {
      if (isEmptyGroup(audience)) {
        return { audienceSize: 0, reach: telegramBotId === null ? null : { ...EMPTY_REACH } };
      }
      return audiences.breakdown(workspaceId, await resolved(workspaceId, audience), telegramBotId);
    },

    async reachableContacts(workspaceId, audience, telegramBotId, limit = REACHABLE_LIMIT) {
      if (isEmptyGroup(audience)) return [];
      return audiences.reachable(
        workspaceId,
        await resolved(workspaceId, audience),
        telegramBotId,
        limit,
      );
    },

    async launchAudience(workspaceId, audience, telegramBotId, tx) {
      if (isEmptyGroup(audience))
        return { audienceSize: 0, reach: { ...EMPTY_REACH }, reachable: [] };
      const set = await audiences.launchSet(
        workspaceId,
        await resolved(workspaceId, audience, tx),
        telegramBotId,
        REACHABLE_LIMIT,
        tx,
      );
      if (set.total > set.rows.length)
        return { audienceSize: set.total, reach: null, reachable: [] };
      const reach = { ...EMPTY_REACH };
      for (const r of set.rows) reach[r.reach] += 1;
      return {
        audienceSize: set.total,
        reach,
        reachable: set.rows
          .filter((r) => r.reach === 'reachable')
          .map((r) => ({ id: r.id, telegramUserId: r.telegramUserId })),
      };
    },

    existingTags: existing,

    async tagNames(workspaceId, tagIds, tx) {
      const requested = [...new Set(tagIds)];
      if (requested.length === 0) return [];
      const names = new Map(
        (await tags.namesOf(workspaceId, requested, tx)).map((t) => [t.id, t.name]),
      );
      return requested.flatMap((id) => (names.has(id) ? [{ id, name: names.get(id)! }] : []));
    },

    async matchingContactIds(workspaceId, filter, tx) {
      const tagIds = filter.mode === 'none' ? [] : await existing(workspaceId, filter.tagIds, tx);
      return audiences.matchingIds(
        workspaceId,
        {
          q: normalizeSearchQuery(filter.q ?? ''),
          mode: filter.mode,
          tagIds,
        },
        tx,
      );
    },

    async contactCards(workspaceId, contactIds, telegramBotId) {
      if (contactIds.length === 0) return [];
      return audiences.cards(workspaceId, contactIds, telegramBotId);
    },

    isBlocked: (workspaceId, contactId, telegramBotId) =>
      audiences.isBlocked(workspaceId, contactId, telegramBotId),
  };
}
