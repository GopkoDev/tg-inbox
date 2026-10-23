import {
  normalizeSearchQuery,
  type AudienceBreakdown,
  type AudienceQuery,
  type AudienceSpec,
  type ContactCard,
  type ReachableContact,
  type TagFilterMode,
  type TagRepo,
} from './ports.js';

/** 10 000 + 1: the extra row proves "over the limit" to the caller (AC-05). */
export const REACHABLE_LIMIT = 10_001;

export interface ContactAudiencesDeps {
  audiences: AudienceQuery;
  tags: Pick<TagRepo, 'resolveIds'>;
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
  /** The ids that are (still) tags of the workspace. */
  existingTags(workspaceId: string, tagIds: readonly string[]): Promise<string[]>;
  /** The Contacts list's matching set for a search and a tag filter, sorted by id. */
  matchingContactIds(
    workspaceId: string,
    filter: { q?: string | null; mode: TagFilterMode; tagIds: readonly string[] },
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
  const existing = async (workspaceId: string, ids: readonly string[]) => {
    const requested = [...new Set(ids)];
    if (requested.length === 0) return [];
    const found = new Set(await tags.resolveIds(workspaceId, requested));
    return requested.filter((id) => found.has(id));
  };

  /** Tags that are gone are left out of the evaluation; a group's ids are deduplicated. */
  const resolved = async (workspaceId: string, audience: AudienceSpec): Promise<AudienceSpec> =>
    audience.kind === 'ids'
      ? { kind: 'ids', contactIds: [...new Set(audience.contactIds)] }
      : {
          kind: 'tags',
          mode: audience.mode,
          include: audience.mode === 'none' ? [] : await existing(workspaceId, audience.include),
          exclude: audience.mode === 'none' ? [] : await existing(workspaceId, audience.exclude),
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

    existingTags: existing,

    async matchingContactIds(workspaceId, filter) {
      const tagIds = filter.mode === 'none' ? [] : await existing(workspaceId, filter.tagIds);
      return audiences.matchingIds(workspaceId, {
        q: normalizeSearchQuery(filter.q ?? ''),
        mode: filter.mode,
        tagIds,
      });
    },

    async contactCards(workspaceId, contactIds, telegramBotId) {
      if (contactIds.length === 0) return [];
      return audiences.cards(workspaceId, contactIds, telegramBotId);
    },

    isBlocked: (workspaceId, contactId, telegramBotId) =>
      audiences.isBlocked(workspaceId, contactId, telegramBotId),
  };
}
