import type { BroadcastDraft } from '@tg/shared';
import type { Db } from '../../../platform/db.js';
import type { AudienceTagKind, StoredAudienceTag, TagMode } from '../domain/audience.js';
import type { BroadcastStatus } from '../domain/broadcast.js';
import type {
  AbortReason,
  FailureReason,
  RecipientState,
  RecordedOutcome,
} from '../domain/recipient.js';

/** A Kysely handle or a transaction. */
export type Executor = Db;

export type AudienceKind = 'tags' | 'group';
export type EndReason = 'completed' | 'text_refused' | 'bot_stopped' | 'stopped';

/** A `broadcasts` row. */
export interface BroadcastRecord {
  id: string;
  workspaceId: string;
  name: string;
  text: string;
  status: BroadcastStatus;
  version: number;
  audienceKind: AudienceKind;
  /** Set exactly when `audienceKind` is `tags`. */
  tagMode: TagMode | null;
  authorAccountId: string;
  lastChangedByAccountId: string;
  lastChangedAt: Date;
  createdAt: Date;
  launchedAt: Date | null;
  launchedByAccountId: string | null;
  launchTelegramBotId: bigint | null;
  audienceSize: number | null;
  blockedCount: number | null;
  neverWroteCount: number | null;
  recipientCount: number | null;
  stoppedAt: Date | null;
  stoppedByAccountId: string | null;
  endedAt: Date | null;
  endReason: EndReason | null;
}

export interface NewDraft {
  id: string;
  name: string;
  text: string;
  audienceKind: AudienceKind;
  tagMode: TagMode | null;
  authorAccountId: string;
  createdAt: Date;
}

/** The versioned fields of a draft a save may change (ADR-0005). */
export interface DraftFields {
  name?: string;
  text?: string;
  audienceKind?: AudienceKind;
  tagMode?: TagMode | null;
}

export interface BroadcastRepo {
  /** A new draft at version 1, last changed by its author at creation. */
  insertDraft(workspaceId: string, draft: NewDraft, tx?: Executor): Promise<BroadcastRecord>;
  find(workspaceId: string, id: string, tx?: Executor): Promise<BroadcastRecord | null>;
  /**
   * The row `FOR NO KEY UPDATE` by (workspace, id), held until `tx` ends: the one point that
   * serialises draft, group, delete, launch, stop, abort and finish writes (sad.md §8).
   */
  lockForUpdate(workspaceId: string, id: string, tx: Executor): Promise<BroadcastRecord | null>;
  /**
   * Writes the fields only while the broadcast is a draft at `expectedVersion`, raising the version
   * by one and the last change; null (nothing written) otherwise (AC-03).
   */
  saveFields(
    workspaceId: string,
    id: string,
    expectedVersion: number,
    fields: DraftFields,
    actorAccountId: string,
    at: Date,
    tx?: Executor,
  ): Promise<BroadcastRecord | null>;
  /** The last change only, version kept (a group add or remove). Whether a row was written. */
  touch(
    workspaceId: string,
    id: string,
    actorAccountId: string,
    at: Date,
    tx?: Executor,
  ): Promise<boolean>;
  /** Every broadcast of the workspace, most recently changed first, then id descending. */
  list(workspaceId: string): Promise<BroadcastRecord[]>;
  /** Launches with `launched_at >= since`, whatever their status now (the 10-per-24-h cap). */
  launchesSince(workspaceId: string, since: Date, tx?: Executor): Promise<number>;
  /** The 10th newest `launched_at` of the workspace; null with fewer than 10 launches. */
  tenthNewestLaunchedAt(workspaceId: string, tx?: Executor): Promise<Date | null>;
  /** The workspace's sending broadcasts, oldest launch first. */
  sendingBroadcasts(workspaceId: string, tx?: Executor): Promise<BroadcastRecord[]>;
  /** Deletes a draft with its tag and group rows; false for a launched or unknown one. */
  deleteDraft(workspaceId: string, id: string, tx: Executor): Promise<boolean>;
}

export interface AudienceTagRow extends StoredAudienceTag {
  kind: AudienceTagKind;
}

export interface AudienceTagRepo {
  /** The stored tags of a broadcast's tag audience (name as when chosen). */
  list(workspaceId: string, broadcastId: string, tx?: Executor): Promise<AudienceTagRow[]>;
  /** Replaces the stored tags with `rows`. */
  replace(
    workspaceId: string,
    broadcastId: string,
    rows: readonly AudienceTagRow[],
    tx: Executor,
  ): Promise<void>;
  /** Copies the stored tags of `fromId` onto `toId`, both of the workspace (duplicate). */
  copy(workspaceId: string, fromId: string, toId: string, tx: Executor): Promise<void>;
}

export interface GroupRow {
  contactId: string;
  addedByAccountId: string;
  addedAt: Date;
}

/** The last group row shown: where the next page continues. */
export interface GroupPosition {
  addedAt: Date;
  contactId: string;
}

export interface GroupRepo {
  /** `ON CONFLICT DO NOTHING`; whether a row was written. */
  add(
    workspaceId: string,
    broadcastId: string,
    contactId: string,
    actorAccountId: string,
    at: Date,
    tx?: Executor,
  ): Promise<boolean>;
  /** One statement; the number of rows written (those already in are skipped). */
  addMany(
    workspaceId: string,
    broadcastId: string,
    contactIds: readonly string[],
    actorAccountId: string,
    at: Date,
    tx?: Executor,
  ): Promise<number>;
  /** Deletes every row of the group (a switch to a tag audience); the number deleted. */
  removeAll(workspaceId: string, broadcastId: string, tx: Executor): Promise<number>;
  /** Deletes one row by key; whether a row was deleted. */
  remove(
    workspaceId: string,
    broadcastId: string,
    contactId: string,
    tx?: Executor,
  ): Promise<boolean>;
  /** Which of `contactIds` are in the group. */
  membership(
    workspaceId: string,
    broadcastId: string,
    contactIds: readonly string[],
  ): Promise<string[]>;
  count(workspaceId: string, broadcastId: string, tx?: Executor): Promise<number>;
  /** Every contact id of the group, sorted. */
  ids(workspaceId: string, broadcastId: string, tx?: Executor): Promise<string[]>;
  /** Up to `limit` rows, newest added first (contact id descending on a tie), after `after`. */
  page(
    workspaceId: string,
    broadcastId: string,
    after: GroupPosition | undefined,
    limit: number,
  ): Promise<{ rows: GroupRow[]; hasNext: boolean }>;
}

// ───────── recipients (ADR-0007, ADR-0009) ─────────

/** One recipient frozen at launch: position = rank of the contact id in the sorted reachable set. */
export interface NewRecipient {
  id: string;
  contactId: string;
  position: number;
  telegramUserId: bigint;
}

export interface RecipientRecord {
  id: string;
  broadcastId: string;
  contactId: string;
  position: number;
  telegramUserId: bigint;
  state: RecipientState;
  failureReason: FailureReason | null;
  claimedAt: Date | null;
  outcomeAt: Date | null;
  telegramMessageId: bigint | null;
}

/** A `sending` recipient left by a dead link, resolved as not confirmed (its item sits at `claimedAt`). */
export interface StaleRecipient {
  id: string;
  broadcastId: string;
  contactId: string;
  claimedAt: Date;
}

export type Settlement = { state: 'stopped' } | { state: 'failed'; reason: AbortReason };

export type RecipientTotals = Record<RecipientState, number>;

export interface RecipientRepo {
  /** Every recipient of the launch in one `INSERT … SELECT … FROM unnest(…)`, all `waiting`. */
  insertAll(
    workspaceId: string,
    broadcastId: string,
    rows: readonly NewRecipient[],
    tx: Executor,
  ): Promise<void>;
  /** `waiting` → `sending` at `at`; false when the row is not (or no longer) waiting. */
  claim(workspaceId: string, id: string, at: Date, tx?: Executor): Promise<boolean>;
  /**
   * The outcome of a claimed (`sending`) recipient, or `blocked` straight from `waiting` (the mark
   * at its turn); false when the row is in neither state.
   */
  recordOutcome(
    workspaceId: string,
    id: string,
    outcome: RecordedOutcome,
    at: Date,
    tx?: Executor,
  ): Promise<boolean>;
  /** `sending` → `waiting`, `claimed_at` cleared (a rate limit: nothing was sent). */
  backToWaiting(workspaceId: string, id: string, tx?: Executor): Promise<boolean>;
  /** Every `sending` recipient of these broadcasts → `not_confirmed` at `at`, keeping `claimed_at`. */
  resolveStaleInFlight(
    workspaceId: string,
    broadcastIds: readonly string[],
    at: Date,
    tx: Executor,
  ): Promise<StaleRecipient[]>;
  /** Every `waiting` recipient → `stopped`, or `failed` with the abort reason; the count. */
  settleWaiting(
    workspaceId: string,
    broadcastId: string,
    settlement: Settlement,
    at: Date,
    tx: Executor,
  ): Promise<number>;
  /** The count per state, every state present (0 when none). */
  totals(workspaceId: string, broadcastId: string, tx?: Executor): Promise<RecipientTotals>;
  /** Up to `limit` recipients by position after `after`, optionally of one state. */
  page(
    workspaceId: string,
    broadcastId: string,
    q: { after?: number; state?: RecipientState },
    limit: number,
  ): Promise<{ rows: RecipientRecord[]; hasNext: boolean }>;
  /** The waiting recipient with the lowest position. */
  nextWaiting(
    workspaceId: string,
    broadcastId: string,
    tx?: Executor,
  ): Promise<RecipientRecord | null>;
  /** Whether any recipient is still `waiting` or `sending`. */
  hasWaitingOrInFlight(workspaceId: string, broadcastId: string, tx?: Executor): Promise<boolean>;
  /** Every recipient's contact id, sorted (duplicate "all recipients"). */
  allContactIds(workspaceId: string, broadcastId: string, tx?: Executor): Promise<string[]>;
  /** "Only recipients it did not reach": the fixable failures plus stopped (plus not confirmed). */
  notReachedContactIds(
    workspaceId: string,
    broadcastId: string,
    includeNotConfirmed: boolean,
    tx?: Executor,
  ): Promise<string[]>;
  /** The delivered recipients' contact ids, sorted (the 48-hour blocked share). */
  deliveredContactIds(workspaceId: string, broadcastId: string): Promise<string[]>;
}

// ───────── use-case ports (sad.md §5) ─────────

/** Runs `fn` in one database transaction; a throw rolls it back with its signals. */
export type Transaction = <T>(fn: (tx: Executor) => Promise<T>) => Promise<T>;

/** One `change` per writing transaction (contracts/events.md assumption 2). */
export type BroadcastChange = 'draft' | 'group' | 'status' | 'report' | 'deleted';

/** `broadcast.changed`, published in the writing transaction (ids only). */
export interface BroadcastSignals {
  broadcastChanged(
    tx: Executor,
    workspaceId: string,
    broadcastId: string,
    change: BroadcastChange,
  ): Promise<void>;
}

/** What `broadcasts` asks the `contacts` app layer (sad.md §5, ADR-0004). */
export interface ContactsApi {
  /** The ids that are tags of the workspace, with their current names; others are left out. */
  resolveTags(
    workspaceId: string,
    tagIds: readonly string[],
  ): Promise<{ id: string; name: string }[]>;
}

/** What `broadcasts` asks the `workspaces` app layer. */
export interface WorkspacesApi {
  /**
   * Joins `tx`: `FOR SHARE` on the memberships of `accountIds` (sad.md §8 lock order: before the
   * broadcast row); returns the active accounts among them.
   */
  lockActiveMembers(
    tx: Executor,
    workspaceId: string,
    accountIds: readonly string[],
  ): Promise<string[]>;
}

/**
 * The draft as the API answers it (with its audience and breakdown) — `reads` (T17) implements it,
 * the composition root binds it; read after the writing transaction.
 */
export interface DraftView {
  draftView(workspaceId: string, broadcastId: string): Promise<BroadcastDraft>;
}
