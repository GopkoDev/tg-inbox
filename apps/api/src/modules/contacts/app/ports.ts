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
}

export interface UpsertResult {
  contactId: string;
  created: boolean;
}

export interface ContactRepo {
  /**
   * One contact per (workspace, Telegram user). Inserts it, or refreshes its profile only when
   * `seenAt` is strictly newer than the stored one (AC-08); always returns the contact's id.
   */
  upsertFromProfile(
    workspaceId: string,
    profile: ContactProfile,
    seenAt: Date,
    now: Date,
    tx?: Executor,
  ): Promise<UpsertResult>;
  count(workspaceId: string, tx?: Executor): Promise<number>;
}
