import type { Db } from '../../../platform/db.js';
import type { ActivityCause, ActivityKind } from '../domain/activity.js';
import type { ConversationState, LatestReply } from '../domain/state.js';
import type { MessageKind } from '../domain/message.js';
import type { MediaFile, MessageProjection } from '../domain/projection.js';
import type { ListPosition, ThreadPosition } from '../domain/thread.js';

/** A Kysely handle or a transaction (the capture transaction). */
export type Executor = Db;

export interface UpsertedConversation {
  conversationId: string;
  created: boolean;
}

export interface ConversationRepo {
  /**
   * One conversation per (workspace, private chat); inserted once, returned again after. A new row
   * starts with arrival and activity at `now`, the arrival of the message that created it.
   */
  upsert(
    workspaceId: string,
    conversation: { contactId: string; telegramChatId: bigint },
    now: Date,
    tx?: Executor,
  ): Promise<UpsertedConversation>;
  /**
   * A customer message arrived at `receivedAt`: raises the arrival with GREATEST and rewrites activity
   * as GREATEST(arrival, last sent reply) and raises `customer_message_seq` in the same UPDATE. Edits
   * and duplicates never call this. Returns the status and assignee read under the row lock the
   * UPDATE takes: the only state capture may decide a reopen on.
   */
  raiseReceived(
    workspaceId: string,
    conversationId: string,
    receivedAt: Date,
    tx?: Executor,
  ): Promise<RaisedConversation>;
  findByChat(workspaceId: string, telegramChatId: bigint, tx?: Executor): Promise<string | null>;
  hasAny(workspaceId: string, tx?: Executor): Promise<boolean>;
  /**
   * Reads the state columns and takes the row lock (`FOR UPDATE`) for the rest of the transaction.
   * Null when the conversation is not in the workspace (nothing is locked).
   */
  lockState(workspaceId: string, conversationId: string, tx: Executor): Promise<LockedState | null>;
  /**
   * Locks (`FOR UPDATE`, by id) every conversation of the workspace assigned to the account, open and
   * closed, and returns their ids. The deactivation's step 3: it runs after the membership `UPDATE`.
   */
  lockAssignedTo(workspaceId: string, accountId: string, tx: Executor): Promise<string[]>;
  /**
   * Writes the given state fields and raises `state_version` by one in the same UPDATE; never touches
   * `last_activity_at`. Returns the new version, null when the conversation is not in the workspace.
   */
  writeState(
    workspaceId: string,
    conversationId: string,
    change: StateChange,
    tx?: Executor,
  ): Promise<number | null>;
  /**
   * The newest customer message that arrived after `max(the member's arrival watermark, activeSince)`;
   * null when there is none.
   */
  newestUnreadCustomerMessage(
    workspaceId: string,
    conversationId: string,
    accountId: string,
    activeSince: Date,
    tx?: Executor,
  ): Promise<{ id: string; receivedAt: Date } | null>;
  /** The newest reply in thread order (position, then id); null when there is none. */
  latestReply(
    workspaceId: string,
    conversationId: string,
    tx?: Executor,
  ): Promise<LatestReply | null>;
}

/** The state columns read under the row lock, plus what the close reasons need from the row itself. */
export interface LockedState extends ConversationState {
  lastActivityAt: Date;
  /** No reply yet, or the last customer message is newer than the last sent reply. */
  waitingForReply: boolean;
}

/** The conversation's state as the arrival-raise UPDATE left it, under its row lock. */
export interface RaisedConversation {
  status: ConversationState['status'];
  assigneeAccountId: string | null;
  stateVersion: number;
}

/** Fields to write; an absent field is left as it is. */
export interface StateChange {
  status?: ConversationState['status'];
  assigneeAccountId?: string | null;
}

export interface NewActivity {
  id: string;
  conversationId: string;
  kind: ActivityKind;
  cause: ActivityCause;
  actorAccountId: string | null;
  previousAssigneeAccountId: string | null;
  newAssigneeAccountId: string | null;
  positionAt: Date;
  createdAt: Date;
}

export type ActivityView = NewActivity;

export interface ActivityRepo {
  insert(workspaceId: string, activity: NewActivity, tx?: Executor): Promise<void>;
  /** The conversation's newest entry by position, ties broken by id. */
  latestFor(
    workspaceId: string,
    conversationId: string,
    tx?: Executor,
  ): Promise<ActivityView | null>;
  byId(workspaceId: string, activityId: string, tx?: Executor): Promise<ActivityView | null>;
  /**
   * Takes the transaction-level advisory lock `changes:<workspace>:<account>` and counts the member's
   * entries created strictly after `since`; `oldestCreatedAt` is the earliest of them.
   */
  countByActorSince(
    workspaceId: string,
    accountId: string,
    since: Date,
    tx: Executor,
  ): Promise<{ count: number; oldestCreatedAt: Date | null }>;
}

export interface NewMessage {
  /** Generated by the caller so the live signal can name the message. */
  id: string;
  conversationId: string;
  telegramMessageId: bigint;
  kind: MessageKind;
  body: string | null;
  /** Telegram's message object, stored whole for its media references. */
  telegramMessage: Record<string, unknown>;
  sentAt: Date;
}

export interface MessageEdit {
  conversationId: string;
  telegramMessageId: bigint;
  /** The new text or caption; null when an edit removed a caption (never applied to a text). */
  body: string | null;
  telegramMessage: Record<string, unknown>;
  editedAt: Date;
  editUpdateId: bigint;
}

export type InsertOutcome = 'captured' | 'already_present';
export type EditOutcome = 'applied' | 'not_later' | 'not_found';

export interface MessageRepo {
  /** Keyed by (conversation, Telegram message id): a redelivery is `already_present` (AC-11). */
  insertOnce(
    workspaceId: string,
    message: NewMessage,
    receivedAt: Date,
    tx?: Executor,
  ): Promise<InsertOutcome>;
  /** The conditional update of the edit rule (conversations/domain/edit.ts, AC-10). */
  applyEdit(workspaceId: string, edit: MessageEdit, tx?: Executor): Promise<EditOutcome>;
  /** The id of a captured message, for the live signal of an applied edit. */
  findId(
    workspaceId: string,
    conversationId: string,
    telegramMessageId: bigint,
    tx?: Executor,
  ): Promise<string | null>;
  newestReceivedAt(workspaceId: string, tx?: Executor): Promise<Date | null>;
}

export interface MessageSignal {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  change: 'created' | 'edited';
}

export interface ReadSignal {
  workspaceId: string;
  conversationId: string;
  /** The member who read; the frame goes to this member's own sockets only. */
  accountId: string;
}

export interface ReplySignal {
  workspaceId: string;
  conversationId: string;
  replyId: string;
  change: 'created' | 'state';
}

export interface ActivitySignal {
  workspaceId: string;
  conversationId: string;
  activityId: string;
}

/** Live signals, published in the caller's transaction so they are delivered only on commit (ADR-0003). */
export interface ConversationSignals {
  messageChanged(tx: Executor, signal: MessageSignal): Promise<void>;
  /** `conversation.changed` with item type reply: a reply was created or changed state. */
  replyChanged(tx: Executor, signal: ReplySignal): Promise<void>;
  /** `conversation.changed { change: read, account_id }` after a member's watermark was written. */
  conversationRead(tx: Executor, signal: ReadSignal): Promise<void>;
  /** `conversation.changed` with item type activity (created): one per recorded state change. */
  activityChanged(tx: Executor, signal: ActivitySignal): Promise<void>;
}

// ───────── read side (inbox) ─────────

/** The member whose unread counts a read is computed for. */
export interface Viewer {
  accountId: string;
  /** Join or reactivation time: messages that arrived before it count as read. */
  activeSince: Date;
}

export type LastItemView =
  | { type: 'message'; id: string; kind: MessageKind; body: string | null }
  | { type: 'reply'; id: string; body: string };

export interface ConversationRow {
  id: string;
  contactId: string;
  lastActivityAt: Date;
  /** Null only for a conversation with no message and no sent reply (not produced by capture). */
  lastItem: LastItemView | null;
  unreadCount: number;
  waitingForReply: boolean;
}

export interface ListPageQuery extends Viewer {
  /** Null: no filter. An empty list matches nothing. */
  contactIds: string[] | null;
  after: ListPosition | null;
  limit: number;
}

export interface ConversationListReads {
  /** Newest activity first; `hasNext` says more rows follow the returned ones. */
  listPage(
    workspaceId: string,
    query: ListPageQuery,
  ): Promise<{ rows: ConversationRow[]; hasNext: boolean }>;
  summary(
    workspaceId: string,
    conversationId: string,
    viewer: Viewer,
  ): Promise<ConversationRow | null>;
}

export interface MessageView extends MessageProjection {
  id: string;
  conversationId: string;
  kind: MessageKind;
  body: string | null;
  sentAt: Date;
  receivedAt: Date;
  editedAt: Date | null;
}

export type ReplyStateValue = 'sending' | 'sent' | 'not_delivered' | 'not_confirmed';

export interface ReplyView {
  id: string;
  conversationId: string;
  clientKey: string;
  body: string;
  /** Names are joined by `inbox` through `workspaces`. */
  authorAccountId: string;
  state: ReplyStateValue;
  failureReason: string | null;
  positionAt: Date;
  sentAt: Date | null;
  createdAt: Date;
}

export type ThreadEntry =
  | { type: 'message'; position: ThreadPosition; message: MessageView }
  | { type: 'reply'; position: ThreadPosition; reply: ReplyView };

export interface ThreadPageQuery {
  /** Items strictly before this position (older page). */
  before: ThreadPosition | null;
  /** Items strictly after this position (newer page). Not combined with `before`. */
  after: ThreadPosition | null;
  limit: number;
}

export interface ThreadPageRows {
  /** Oldest first. */
  entries: ThreadEntry[];
  hasPrev: boolean;
  hasNext: boolean;
  /** The conversation's newest arrival, read in the same snapshot; the latest page only. */
  readThroughAt: Date | null;
  /** The conversation's newest reply in thread order, read in the same snapshot; every page. */
  newestReplyId: string | null;
}

export interface MediaReference extends MediaFile {
  kind: MessageKind;
}

export interface ThreadReads {
  /** Null when the conversation is not in the workspace. */
  page(
    workspaceId: string,
    conversationId: string,
    query: ThreadPageQuery,
  ): Promise<ThreadPageRows | null>;
  message(
    workspaceId: string,
    conversationId: string,
    messageId: string,
  ): Promise<MessageView | null>;
  reply(workspaceId: string, conversationId: string, replyId: string): Promise<ReplyView | null>;
  /** Null for an unknown message and for a kind with no file. */
  mediaReference(
    workspaceId: string,
    conversationId: string,
    messageId: string,
  ): Promise<MediaReference | null>;
}

export interface MarkReadInput extends Viewer {
  conversationId: string;
  proposed: Date;
  now: Date;
}

export interface ReadState {
  readThroughAt: Date;
  unreadCount: number;
}

export interface ReadMarkRepo {
  /**
   * Raises this member's arrival watermark to `proposed`: never lowered, never past the conversation's
   * newest arrival. Null when the conversation is not in the workspace (nothing is written).
   */
  markRead(workspaceId: string, input: MarkReadInput, tx?: Executor): Promise<ReadState | null>;
}

// ───────── reply requests (inbox send / resend) ─────────

export type AttemptKind = 'send' | 'try_again' | 'send_again';

/** Hands the conversation's drain job to the delivery queue in the request's own transaction (ADR-0004). */
export type EnqueueDrain = (
  tx: Executor,
  workspaceId: string,
  conversationId: string,
) => Promise<void>;

/**
 * Whether the conversation has a drain job queued or running (inbox's delivery queue), read on the
 * caller's transaction after it took the drain lock, so a job committed beside a reply is seen.
 */
export type DrainQueued = (
  tx: Executor,
  workspaceId: string,
  conversationId: string,
) => Promise<boolean>;

export interface NewReply {
  id: string;
  conversationId: string;
  clientKey: string;
  body: string;
  authorAccountId: string;
  positionAt: Date;
}

export interface ReplyRepo {
  findByClientKey(
    workspaceId: string,
    conversationId: string,
    clientKey: string,
    tx?: Executor,
  ): Promise<ReplyView | null>;
  /** Row-locks the reply for the rest of the transaction. */
  findForUpdate(
    workspaceId: string,
    conversationId: string,
    replyId: string,
    tx?: Executor,
  ): Promise<ReplyView | null>;
  /**
   * Takes the transaction-level advisory lock on (workspace, member) and counts the member-initiated
   * attempts created after `since`; `oldest` is the earliest of them. Automatic retries have no initiator.
   */
  lockAndCountAttempts(
    workspaceId: string,
    accountId: string,
    since: Date,
    tx?: Executor,
  ): Promise<{ count: number; oldest: Date | null }>;
  /**
   * The newest reply by someone other than `accountId` that follows the reply `afterReplyId` in thread
   * order (any reply when it is null or not a reply of this conversation).
   */
  newestTeammateReply(
    workspaceId: string,
    conversationId: string,
    accountId: string,
    afterReplyId: string | null,
    tx?: Executor,
  ): Promise<ReplyView | null>;
  /** Stores a `sending` reply; null when the conversation is not in the workspace or the key is taken. */
  insert(workspaceId: string, reply: NewReply, tx?: Executor): Promise<ReplyView | null>;
  insertAttempt(
    workspaceId: string,
    attempt: {
      id: string;
      conversationId: string;
      replyId: string;
      kind: AttemptKind;
      initiatedByAccountId: string;
      createdAt: Date;
    },
    tx?: Executor,
  ): Promise<void>;
  /** not_delivered / not_confirmed -> sending at a new position; null when it is in neither state. */
  requeue(
    workspaceId: string,
    conversationId: string,
    replyId: string,
    positionAt: Date,
    tx?: Executor,
  ): Promise<ReplyView | null>;
  // ───────── delivery side (inbox drain) ─────────

  /**
   * Takes the conversation's transaction-level drain lock. Storing or re-queueing a reply holds it
   * from before its job is sent until commit, and the drain reads `pending` under it, so a reply whose
   * job was absorbed by a queued drain (stately singleton) is always seen by that drain (ADR-0004).
   */
  lockDrain(workspaceId: string, conversationId: string, tx: Executor): Promise<void>;
  /** Whether the reply has a `not_accepted` attempt created at or after `since` (its position). */
  hasNotAcceptedAttempt(
    workspaceId: string,
    conversationId: string,
    replyId: string,
    since: Date,
    tx?: Executor,
  ): Promise<boolean>;

  /** The conversation's `sending` replies, oldest position first. */
  pendingReplies(workspaceId: string, conversationId: string, tx?: Executor): Promise<ReplyView[]>;
  /** The Telegram chat the conversation talks to; null when the conversation is not in the workspace. */
  chatIdOf(workspaceId: string, conversationId: string, tx?: Executor): Promise<bigint | null>;
  /** Start of the newest started attempt of the conversation (pacing); null when none. */
  lastStartedAt(workspaceId: string, conversationId: string, tx?: Executor): Promise<Date | null>;
  /**
   * Puts the reply in flight: stamps `startedAt` on its oldest unstarted attempt or, when there is none
   * (an automatic retry), inserts a `retry` attempt already started. Null unless the reply is `sending`.
   */
  startAttempt(
    workspaceId: string,
    conversationId: string,
    replyId: string,
    attemptId: string,
    startedAt: Date,
    tx?: Executor,
  ): Promise<string | null>;
  /** Records the outcome on an unfinished attempt; null (nothing written) when it is already finished. */
  finishAttempt(
    workspaceId: string,
    conversationId: string,
    attemptId: string,
    outcome: AttemptOutcomeValue,
    finishedAt: Date,
    tx?: Executor,
  ): Promise<{ replyId: string } | null>;
  /** `sending` -> a final state; null when the reply is not `sending`. */
  settleReply(
    workspaceId: string,
    conversationId: string,
    replyId: string,
    settlement: ReplySettlement,
    tx?: Executor,
  ): Promise<ReplyView | null>;
  /**
   * Like `settleReply`, but only while the reply has no attempt in flight (started, unfinished).
   * Locks the reply row first, so an attempt committed by a concurrent `startAttempt` is seen.
   */
  settleIdleReply(
    workspaceId: string,
    conversationId: string,
    replyId: string,
    settlement: ReplySettlement,
    tx?: Executor,
  ): Promise<ReplyView | null>;
  /** A reply was sent at `sentAt`: raises the reply and activity columns in one UPDATE (GREATEST). */
  raiseReplySent(
    workspaceId: string,
    conversationId: string,
    sentAt: Date,
    tx?: Executor,
  ): Promise<void>;
  /**
   * Closes the reply's never-started attempt as `skipped`, or inserts a finished `retry` one when it has
   * none; returns nothing.
   */
  skipAttempt(
    workspaceId: string,
    conversationId: string,
    replyId: string,
    attemptId: string,
    finishedAt: Date,
    tx?: Executor,
  ): Promise<void>;
  /** Start of the oldest started-and-unfinished attempt of the conversation; null when none. */
  oldestInFlightStart(
    workspaceId: string,
    conversationId: string,
    tx?: Executor,
  ): Promise<Date | null>;
  /** Attempts started and unfinished, started before `olderThan` when given; locked for the transaction. */
  inFlightAttempts(
    workspaceId: string,
    conversationId: string,
    olderThan: Date | null,
    tx?: Executor,
  ): Promise<Array<{ id: string; replyId: string }>>;
}

export type AttemptOutcomeValue =
  'accepted' | 'refused' | 'bot_unauthorized' | 'not_accepted' | 'unknown' | 'skipped';

export type ReplySettlement =
  | { state: 'sent'; telegramMessageId: bigint; sentAt: Date }
  | { state: 'not_delivered'; failureReason: string }
  | { state: 'not_confirmed' };
