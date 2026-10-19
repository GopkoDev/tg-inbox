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
