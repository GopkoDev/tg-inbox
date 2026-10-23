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
  type DisplayNames,
  type Executor,
  type TagHistoryRepo,
  type TagRepo,
  type UpsertResult,
} from './ports.js';
import { memberRefs } from './member-refs.js';

export interface ContactsDeps {
  repo: ContactRepo;
  clock: Clock;
}

/** The contacts app layer — what `conversations` (capture) and `bots` (settings) call. */
export interface Contacts {
  /** Called inside the capture transaction (`tx`) with the message's time as `seenAt`. */
  upsertFromProfile(
    workspaceId: string,
    profile: ContactProfile,
    seenAt: Date,
    tx?: Executor,
  ): Promise<UpsertResult>;
  countContacts(workspaceId: string): Promise<number>;
  /** Contact ids matching the inbox search text; `null` when the text is empty (no filter). */
  searchContactIds(workspaceId: string, query: string): Promise<string[] | null>;
  contactsByIds(workspaceId: string, ids: readonly string[]): Promise<ContactSummary[]>;
}

export function createContacts({ repo, clock }: ContactsDeps): Contacts {
  return {
    upsertFromProfile: (workspaceId, profile, seenAt, tx) =>
      repo.upsertFromProfile(workspaceId, profile, seenAt, clock.now(), tx),
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
  const { repo, lists, tags, contactTags, tagHistory, workspaces } = deps;

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
      const [page, matching, total] = await Promise.all([
        lists.listPage(workspaceId, { ...filter, ...(after && { after }) }),
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
          // The current bot's blocked mark is read by broadcasts T9; until then nothing is marked.
          blocked_since: null,
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
      const contact = await repo.profile(workspaceId, contactId);
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
        // The current bot's blocked mark is read by broadcasts T9; until then nothing is marked.
        blocked_since: null,
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
