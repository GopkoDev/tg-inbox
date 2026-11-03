import type {
  ContactPage,
  ContactProfile as ContactProfileDto,
  ListContactsQuery,
  TagHistoryPage,
} from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import { NotFoundError, ValidationError } from '../../../platform/errors.js';
import {
  contactFilterKey,
  decodeContactCursor,
  decodeHistoryCursor,
  encodeContactCursor,
  encodeHistoryCursor,
} from '../domain/cursor.js';
import {
  normalizeSearchQuery,
  type ContactListQuery,
  type ContactProfile,
  type ContactRepo,
  type ContactSummary,
  type ContactTagRepo,
  type CurrentBot,
  type DisplayNames,
  type Executor,
  type ReachRepo,
  type ReachSignals,
  type TagHistoryRepo,
  type TagRepo,
  type UpsertResult,
} from './ports.js';
import { memberRefs } from './member-refs.js';
import { recordWrote } from './reach.js';

export interface ContactsDeps {
  repo: ContactRepo;
  /** The "wrote" mark per Telegram bot (ADR-0002) and its `contact.changed reach` signal. */
  reach: Pick<ReachRepo, 'upsertWrote'>;
  signals: ReachSignals;
  clock: Clock;
}

/** The contacts app layer — what `conversations` (capture) and `bots` (settings) call. */
export interface Contacts {
  /**
   * Called inside the capture transaction (`tx`) with the message's time as `seenAt` and the
   * Telegram id of the bot that received it: the contact, then its "wrote" mark for that bot
   * (clearing an older block, ADR-0002).
   */
  upsertFromProfile(
    workspaceId: string,
    profile: ContactProfile,
    seenAt: Date,
    telegramBotId: bigint,
    tx: Executor,
  ): Promise<UpsertResult>;
  countContacts(workspaceId: string): Promise<number>;
  /** Contact ids matching the inbox search text; `null` when the text is empty (no filter). */
  searchContactIds(workspaceId: string, query: string): Promise<string[] | null>;
  contactsByIds(workspaceId: string, ids: readonly string[]): Promise<ContactSummary[]>;
}

export function createContacts({ repo, reach, signals, clock }: ContactsDeps): Contacts {
  return {
    async upsertFromProfile(workspaceId, profile, seenAt, telegramBotId, tx) {
      const result = await repo.upsertFromProfile(workspaceId, profile, seenAt, clock.now(), tx);
      // Lock order (sad.md §8): the contact row, then only its reach row.
      await recordWrote(
        { reach, signals },
        tx,
        workspaceId,
        result.contactId,
        telegramBotId,
        seenAt,
      );
      return result;
    },
    countContacts: (workspaceId) => repo.count(workspaceId),
    searchContactIds: (workspaceId, query) => repo.searchContactIds(workspaceId, query),
    contactsByIds: (workspaceId, ids) => repo.contactsByIds(workspaceId, ids),
  };
}

// ───────── reads: the Contacts list, the profile and its tag history ─────────

export interface ContactReadsDeps {
  repo: Pick<ContactRepo, 'profile'>;
  lists: ContactListQuery;
  tags: Pick<TagRepo, 'resolveIds'>;
  contactTags: Pick<ContactTagRepo, 'tagsOf'>;
  tagHistory: Pick<TagHistoryRepo, 'page'>;
  /** The `contacts → workspaces` edge (app layer): adders' and actors' names. */
  workspaces: DisplayNames;
  /** The workspace's current Telegram bot (late-bound `bots` port): whose blocked marks are shown. */
  currentBot: CurrentBot;
}

/** The query of `listContacts` as the use case takes it: `tagIds` and `after` optional, `q` raw. */
export interface ListContactsInput {
  q?: string | undefined;
  mode: ListContactsQuery['mode'];
  tagIds?: readonly string[] | undefined;
  after?: string | undefined;
}

export interface ContactReads {
  listContacts(workspaceId: string, input: ListContactsInput): Promise<ContactPage>;
  getContact(workspaceId: string, contactId: string): Promise<ContactProfileDto>;
  listTagHistory(
    workspaceId: string,
    contactId: string,
    after?: string | undefined,
  ): Promise<TagHistoryPage>;
}

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d === null ? null : iso(d));

export function createContactReads(deps: ContactReadsDeps): ContactReads {
  const { repo, lists, tags, contactTags, tagHistory, workspaces, currentBot } = deps;
  /** Marks are per Telegram bot (ADR-0002): only the current bot's apply; no bot, no marks. */
  const botIdOf = async (workspaceId: string) =>
    (await currentBot.currentBot(workspaceId))?.telegramBotId ?? null;

  const refs = (workspaceId: string, accountIds: readonly string[]) =>
    memberRefs(workspaces, workspaceId, accountIds);

  return {
    async listContacts(workspaceId, input) {
      const q = normalizeSearchQuery(input.q ?? '');
      const requested = [...new Set(input.tagIds ?? [])];
      if (input.mode === 'none' && requested.length > 0) {
        throw new ValidationError('"No tags" takes no chosen tags.', { field: 'tag' });
      }
      // Ids that are not (or no longer) tags of this workspace are left out of the filter and reported.
      const found = new Set(await tags.resolveIds(workspaceId, requested));
      const tagIds = requested.filter((id) => found.has(id));
      const missing = requested.filter((id) => !found.has(id));
      const filter = { q, mode: input.mode, tagIds } as const;
      const key = contactFilterKey(filter);
      let after = null;
      if (input.after !== undefined) {
        after = decodeContactCursor(input.after, key);
        if (after === null) throw new ValidationError('The cursor is not valid.');
      }
      const botId = await botIdOf(workspaceId);
      const [page, matching, total] = await Promise.all([
        lists.listPage(workspaceId, { ...filter, ...(after && { after }) }, botId),
        lists.matchingCount(workspaceId, filter),
        lists.totalCount(workspaceId),
      ]);
      const last = page.rows.at(-1);
      return {
        workspace_id: workspaceId,
        filter: { q, mode: input.mode, tag_ids: tagIds },
        items: page.rows.map((r) => ({
          id: r.id,
          workspace_id: workspaceId,
          first_name: r.firstName,
          last_name: r.lastName,
          username: r.username,
          language_code: r.languageCode,
          first_wrote_at: isoOrNull(r.firstWroteAt),
          last_wrote_at: isoOrNull(r.lastWroteAt),
          tags: r.tags,
          blocked_since: isoOrNull(r.blockedSince),
        })),
        has_prev: after !== null,
        has_next: page.hasNext,
        next_cursor:
          page.hasNext && last
            ? encodeContactCursor({ lastWroteAt: last.lastWroteAt, id: last.id }, key)
            : null,
        matching_count: matching,
        total_count: total,
        missing_tag_ids: missing,
      };
    },

    async getContact(workspaceId, contactId) {
      const contact = await repo.profile(workspaceId, contactId, await botIdOf(workspaceId));
      if (contact === null) throw new NotFoundError('Contact not found.');
      const carried = await contactTags.tagsOf(workspaceId, contactId);
      const ref = await refs(
        workspaceId,
        carried.map((t) => t.addedByAccountId),
      );
      return {
        id: contact.id,
        workspace_id: workspaceId,
        first_name: contact.firstName,
        last_name: contact.lastName,
        username: contact.username,
        language_code: contact.languageCode,
        first_wrote_at: isoOrNull(contact.firstWroteAt),
        last_wrote_at: isoOrNull(contact.lastWroteAt),
        tags: carried.map((t) => ({
          id: t.tagId,
          name: t.name,
          added_by: ref(t.addedByAccountId),
          added_at: iso(t.addedAt),
        })),
        blocked_since: isoOrNull(contact.blockedSince),
      };
    },

    async listTagHistory(workspaceId, contactId, afterCursor) {
      const contact = await repo.profile(workspaceId, contactId);
      if (contact === null) throw new NotFoundError('Contact not found.');
      let after;
      if (afterCursor !== undefined) {
        after = decodeHistoryCursor(afterCursor) ?? undefined;
        if (after === undefined) throw new ValidationError('The cursor is not valid.');
      }
      const page = await tagHistory.page(workspaceId, contactId, after);
      const ref = await refs(
        workspaceId,
        page.entries.map((e) => e.actorAccountId),
      );
      const last = page.entries.at(-1);
      return {
        workspace_id: workspaceId,
        contact_id: contactId,
        items: page.entries.map((e) => ({
          id: e.id,
          kind: e.kind,
          tag_id: e.tagId,
          tag_name: e.tagName,
          merged_into_tag_id: e.mergedInto?.tagId ?? null,
          merged_into_name: e.mergedInto?.name ?? null,
          actor: ref(e.actorAccountId),
          source: e.source,
          created_at: iso(e.createdAt),
        })),
        has_prev: after !== undefined,
        has_next: page.hasNext,
        next_cursor:
          page.hasNext && last
            ? encodeHistoryCursor({ createdAt: last.createdAt, id: last.id })
            : null,
      };
    },
  };
}
