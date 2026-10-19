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
}

// ───────── tags ─────────
//
// Lock order of every tag write (ADR-0004), the same in every use case that takes more than one:
//   1. `tags:<ws>` advisory lock (`TagRepo.lockWorkspaceTags`) — create / rename / merge / delete only;
//   2. the tag rows `FOR UPDATE` in id order (owner: `lockForUpdate`) or the contact row
//      `FOR NO KEY UPDATE` (member: `ContactRepo.lockContact`);
//   3. the member rate-limit lock `tag-changes:<ws>:<account>` (`TagHistoryRepo.lockMemberChanges`);
//   4. `FOR KEY SHARE` on the tag row (`lockForKeyShare`), before any `contact_tags` write;
//   5. the writes (links, history).
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
