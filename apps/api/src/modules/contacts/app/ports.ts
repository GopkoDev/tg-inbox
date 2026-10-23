import type { Db } from '../../../platform/db.js';

/** A Kysely handle or a transaction; the capture transaction of `conversations` is passed in. */
export type Executor = Db;

/** An end customer's Telegram profile as the message that is being captured carries it. */
export interface ContactProfile {
  telegramUserId: bigint;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
}

export interface ContactRecord extends ContactProfile {
  id: string;
  workspaceId: string;
  profileSeenAt: Date;
  createdAt: Date;
  /** Send times of the oldest / newest own message; null only for a contact with none. */
  firstWroteAt: Date | null;
  lastWroteAt: Date | null;
}

/** What list rows and thread headers show of a contact. */
export interface ContactSummary {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
}

/**
 * The search text as matched: trimmed, one leading "@" dropped, trimmed again; `null` when nothing
 * is left (no filter).
 */
export function normalizeSearchQuery(query: string): string | null {
  const q = query.trim().replace(/^@/, '').trim();
  return q === '' ? null : q;
}

export interface UpsertResult {
  contactId: string;
  created: boolean;
}

export interface ContactRepo {
  /**
   * One contact per (workspace, Telegram user). Inserts it, or refreshes its profile only when
   * `seenAt` (the message's send time) is strictly newer than the stored one (AC-08); first and
   * last wrote widen on every call (LEAST / GREATEST). Always returns the contact's id.
   */
  upsertFromProfile(
    workspaceId: string,
    profile: ContactProfile,
    seenAt: Date,
    now: Date,
    tx?: Executor,
  ): Promise<UpsertResult>;
  count(workspaceId: string, tx?: Executor): Promise<number>;
  /**
   * Ids of the workspace's contacts whose "first last" name or username contains the query,
   * ignoring case in any alphabet and `%`/`_` as wildcards. `null` = empty query, no filter.
   */
  searchContactIds(workspaceId: string, query: string): Promise<string[] | null>;
  contactsByIds(workspaceId: string, ids: readonly string[]): Promise<ContactSummary[]>;
  /**
   * ADR-0004 step 2 (member): the contact row `FOR NO KEY UPDATE` by (workspace, id), held until
   * `tx` ends; false when it is not a contact of the workspace.
   */
  lockContact(workspaceId: string, contactId: string, tx: Executor): Promise<boolean>;
  /** The contact's facts by (workspace, id), first and last wrote included; null for an unknown or foreign id. */
  profile(workspaceId: string, contactId: string): Promise<ContactRecord | null>;
}

// ───────── tags ─────────
//
// Lock order of every tag write (ADR-0004), the same in every use case that takes more than one:
//   1. `tags:<ws>` advisory lock (`TagRepo.lockWorkspaceTags`) — create / rename / merge / delete only;
//   2. the tag rows `FOR UPDATE` in id order (owner: `lockForUpdate`) or the contact row
//      `FOR NO KEY UPDATE` (member: `ContactRepo.lockContact`);
//   3. the member rate-limit lock `tag-changes:<ws>:<account>` (`TagHistoryRepo.lockMemberChanges`);
//   4. `FOR KEY SHARE` on the tag row (`lockForKeyShare`), before any `contact_tags` write;
//   5. the writes (links, history); an owner merge first locks the links of both tags `FOR UPDATE`
//      (`ContactTagRepo.mergeInto`), so a member removal in flight is waited for, never undone.
// A member add therefore waits at step 4 on an owner's step 2 before it has written an index entry
// the owner's re-point could wait on, so merge and add never deadlock.

export interface TagRecord {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  createdByAccountId: string;
  createdAt: Date;
}

export interface NewTag {
  id: string;
  name: string;
  key: string;
  createdBy: string;
  createdAt: Date;
}

export interface TagWithCount {
  id: string;
  name: string;
  contactCount: number;
}

export interface TagRepo {
  /** Step 1: `pg_advisory_xact_lock` on `tags:<ws>`; held until `tx` ends. */
  lockWorkspaceTags(workspaceId: string, tx: Executor): Promise<void>;
  findByKey(workspaceId: string, key: string, tx?: Executor): Promise<TagRecord | null>;
  count(workspaceId: string, tx?: Executor): Promise<number>;
  insert(workspaceId: string, tag: NewTag, tx?: Executor): Promise<TagRecord>;
  /** Every tag of the workspace with its contact count, zero counts included, in tag-list order. */
  listWithCounts(workspaceId: string, tx?: Executor): Promise<TagWithCount[]>;
  countFor(workspaceId: string, tagId: string, tx?: Executor): Promise<number>;
  /** The ids that are tags of the workspace; the others are dropped. */
  resolveIds(workspaceId: string, ids: readonly string[], tx?: Executor): Promise<string[]>;
  /** Step 4: the tag row `FOR KEY SHARE`, or null when it is not (or no longer) a tag of the workspace. */
  lockForKeyShare(workspaceId: string, tagId: string, tx: Executor): Promise<TagRecord | null>;
  /** Step 2 (owner): the rows `FOR UPDATE` in id order; ids that are not tags of the workspace are dropped. */
  lockForUpdate(workspaceId: string, ids: readonly string[], tx: Executor): Promise<TagRecord[]>;
  /** Whether a row of the workspace was renamed. The id stays. */
  rename(
    workspaceId: string,
    id: string,
    name: string,
    key: string,
    tx?: Executor,
  ): Promise<boolean>;
  /** Whether a row was deleted; refused by the FK while links remain. */
  delete(workspaceId: string, id: string, tx?: Executor): Promise<boolean>;
}

/** A contact's tag with who added it and when. */
export interface ContactTagRow {
  tagId: string;
  name: string;
  addedByAccountId: string;
  addedAt: Date;
}

export interface NewContactTag {
  workspaceId: string;
  contactId: string;
  tagId: string;
  addedByAccountId: string;
  addedAt: Date;
}

export interface ContactTagRepo {
  /** The contact's tags in tag-list order. */
  tagsOf(workspaceId: string, contactId: string, tx?: Executor): Promise<ContactTagRow[]>;
  /** Tags of a page of contacts in tag-list order; a contact with none has no entry. */
  tagsOfMany(
    workspaceId: string,
    contactIds: readonly string[],
    tx?: Executor,
  ): Promise<Map<string, { id: string; name: string }[]>>;
  carries(workspaceId: string, contactId: string, tagId: string, tx?: Executor): Promise<boolean>;
  countFor(workspaceId: string, contactId: string, tx?: Executor): Promise<number>;
  insert(link: NewContactTag, tx?: Executor): Promise<void>;
  /** Whether a link was removed. */
  delete(workspaceId: string, contactId: string, tagId: string, tx?: Executor): Promise<boolean>;
  /**
   * Owner merge, set-based, in the caller's transaction with both tag rows locked `FOR UPDATE`:
   * where a contact carries both tags the target link takes the earlier (added_at, adder) of the
   * two (the target's on a tie), those duplicate `from` links are deleted and the rest are
   * re-pointed to `to`, keeping adder and time. The links of both tags are locked first, so a
   * concurrent member removal is waited for. Returns the ids of the contacts whose `from` link was
   * actually merged (deleted or re-pointed; for `appendMerged`, written by the caller after this
   * call). Does not delete the tag.
   */
  mergeInto(
    workspaceId: string,
    fromTagId: string,
    toTagId: string,
    tx: Executor,
  ): Promise<string[]>;
  /** Owner delete: removes every link of the tag, returning the contact ids (the count the owner confirmed is checked against it). */
  deleteLinksReturning(workspaceId: string, tagId: string, tx: Executor): Promise<string[]>;
}

export type MemberTagSource = 'inbox' | 'profile';

export interface MemberHistoryEntry {
  workspaceId: string;
  contactId: string;
  tagId: string;
  tagName: string;
  kind: 'added' | 'removed';
  actorAccountId: string;
  source: MemberTagSource;
  createdAt: Date;
}

export interface TagHistoryRow {
  id: string;
  tagId: string;
  tagName: string;
  kind: 'added' | 'removed' | 'merged' | 'deleted';
  mergedInto: { tagId: string; name: string } | null;
  actorAccountId: string;
  source: 'inbox' | 'profile' | 'settings';
  createdAt: Date;
}

/** Position after which the next history page starts: the last entry shown. */
export interface HistoryPosition {
  createdAt: Date;
  id: string;
}

export interface TagHistoryRepo {
  /** Appends one member entry; returns its id. */
  append(entry: MemberHistoryEntry, tx?: Executor): Promise<string>;
  /** Up to 50 entries of the contact, newest first (created_at, id descending), after `after`. */
  page(
    workspaceId: string,
    contactId: string,
    after?: HistoryPosition,
    tx?: Executor,
  ): Promise<{ entries: TagHistoryRow[]; hasNext: boolean }>;
  /** The member's `added` / `removed` entries since `since` (owner kinds never count) and the oldest. */
  memberChangesSince(
    workspaceId: string,
    accountId: string,
    since: Date,
    tx?: Executor,
  ): Promise<{ count: number; oldestAt: Date | null }>;
  /** One `merged` entry per contact id, in one statement (names of both tags at that moment, source `settings`). */
  appendMerged(
    workspaceId: string,
    contactIds: readonly string[],
    from: { id: string; name: string },
    to: { id: string; name: string },
    actorAccountId: string,
    now: Date,
    tx: Executor,
  ): Promise<void>;
  /** One `deleted` entry per contact id, in one statement. */
  appendDeleted(
    workspaceId: string,
    contactIds: readonly string[],
    tag: { id: string; name: string },
    actorAccountId: string,
    now: Date,
    tx: Executor,
  ): Promise<void>;
  /** ADR-0004 step 3: `pg_advisory_xact_lock` on `tag-changes:<ws>:<account>`. */
  lockMemberChanges(workspaceId: string, accountId: string, tx: Executor): Promise<void>;
}

// ───────── contacts list ─────────

export type TagFilterMode = 'any' | 'all' | 'none';

/** What the list is filtered by: the normalised search and the (already resolved) tag ids. */
export interface ContactListFilter {
  /** Normalised by `normalizeSearchQuery`; null = no search. */
  q: string | null;
  mode: TagFilterMode;
  /** Tag ids of the workspace; empty with `any` / `all` = no tag filter, always empty with `none`. */
  tagIds: readonly string[];
}

/** The last contact shown: where the next page continues (a null `lastWroteAt` is the NULL tail). */
export interface ContactListPosition {
  lastWroteAt: Date | null;
  id: string;
}

export interface ContactListRow {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  firstWroteAt: Date | null;
  lastWroteAt: Date | null;
  /** In tag-list order. */
  tags: { id: string; name: string }[];
}

export interface ContactListQuery {
  /** Up to 50 rows by last wrote newest first (NULL tail last, id descending), after `after`. */
  listPage(
    workspaceId: string,
    filter: ContactListFilter & { after?: ContactListPosition },
  ): Promise<{ rows: ContactListRow[]; hasNext: boolean }>;
  /** Contacts matching the search and the tag filter. */
  matchingCount(workspaceId: string, filter: ContactListFilter): Promise<number>;
  /** All contacts of the workspace. */
  totalCount(workspaceId: string): Promise<number>;
}

/** What `contacts` uses of `workspaces` (sad.md §5): names of adders and actors, deactivated members included. */
export interface DisplayNames {
  displayNames(workspaceId: string, accountIds: readonly string[]): Promise<Map<string, string>>;
}

/** The realtime signals of the tag writes (ADR-0007), published in the writing transaction. */
export interface TagSignals {
  contactChanged(tx: Executor, workspaceId: string, contactId: string): Promise<void>;
  tagsChanged(tx: Executor, workspaceId: string): Promise<void>;
}
