import type { Clock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import { canTransition } from '../domain/reply.js';
import type { Transaction } from './conversations.js';
import { recordChange } from './state-changes.js';
import type {
  ActivityRepo,
  AttemptKind,
  ConversationRepo,
  AttemptOutcomeValue,
  ConversationSignals,
  DrainQueued,
  EnqueueDrain,
  ReplyRepo,
  ReplySettlement,
  ReplyView,
} from './ports.js';

interface Limits {
  /** Member-initiated sends allowed per window (30). */
  limit: number;
  /** The window in milliseconds (60 000). */
  windowMs: number;
  /** Supplied by `inbox`: puts the drain job on the request's transaction. */
  enqueueDrain: EnqueueDrain;
}

export interface CreateReplyInput extends Limits {
  workspaceId: string;
  conversationId: string;
  authorId: string;
  clientKey: string;
  body: string;
  /** The newest reply the composer showed when typing began; unknown ids count as none. */
  lastSeenReplyId: string | null;
  confirmTeammate: boolean;
}

export type CreateReplyResult =
  | { status: 'created'; reply: ReplyView }
  | { status: 'existing'; reply: ReplyView }
  | { status: 'limited'; retryAt: Date }
  | { status: 'teammate'; reply: ReplyView }
  | { status: 'not_found' };

export interface RequeueReplyInput extends Limits {
  workspaceId: string;
  conversationId: string;
  replyId: string;
  memberId: string;
  confirmDuplicate: boolean;
}

export type RequeueReplyResult =
  | { status: 'requeued'; reply: ReplyView }
  | { status: 'not_found' }
  | { status: 'not_resendable'; reply: ReplyView }
  | { status: 'limited'; retryAt: Date }
  | { status: 'confirmation_required' };

export interface ReplyRequests {
  createReply(input: CreateReplyInput): Promise<CreateReplyResult>;
  requeueReply(input: RequeueReplyInput): Promise<RequeueReplyResult>;
}

export interface ReplyRequestsDeps {
  transaction: Transaction;
  replies: ReplyRepo;
  signals: ConversationSignals;
  clock: Clock;
}

/**
 * Lock order of every reply write (sad.md §8): the `drain:` advisory lock first, then the reply and
 * attempt rows, then the conversation row (`lockState`, FOR NO KEY UPDATE) — taken once per
 * transaction, after the last reply or attempt write, never between them. A transaction that held
 * the conversation row while it went on to lock more reply rows would deadlock with a lagging drain
 * that holds one of those rows and waits for the conversation row to reopen it.
 * The row lock is `FOR NO KEY UPDATE`, so the `FOR KEY SHARE` a reply or attempt insert takes on the
 * conversation through its foreign key never queues behind it; it still conflicts with every other
 * state lock and with the capture's raise `UPDATE`, which is all the state changes rely on. The
 * request side still takes the drain lock before it writes anything. The member limit lock comes
 * after the drain lock.
 */

/** Reply creation and re-queueing: the request side of at-most-once delivery (ADR-0004). */
export function createReplies(deps: ReplyRequestsDeps): ReplyRequests {
  const { transaction, replies, signals, clock } = deps;

  /** Counts under the (workspace, member) lock; the retry time when the member is at the limit. */
  async function limitedUntil(
    tx: Parameters<Parameters<Transaction>[0]>[0],
    workspaceId: string,
    memberId: string,
    now: Date,
    { limit, windowMs }: Limits,
  ): Promise<Date | null> {
    const since = new Date(now.getTime() - windowMs);
    const { count, oldest } = await replies.lockAndCountAttempts(workspaceId, memberId, since, tx);
    if (count < limit || oldest === null) return null;
    return new Date(oldest.getTime() + windowMs);
  }

  return {
    createReply(input) {
      const { workspaceId, conversationId, authorId, clientKey } = input;
      return transaction(async (tx) => {
        await replies.lockDrain(workspaceId, conversationId, tx);
        const now = clock.now();
        const existing = await replies.findByClientKey(workspaceId, conversationId, clientKey, tx);
        if (existing) return { status: 'existing', reply: existing };

        const retryAt = await limitedUntil(tx, workspaceId, authorId, now, input);
        // A double press may have waited on the limit lock while the first press stored this key and
        // committed; it answers with that reply, never with 429 (AC-11).
        const stored = await replies.findByClientKey(workspaceId, conversationId, clientKey, tx);
        if (stored) return { status: 'existing', reply: stored };
        if (retryAt) return { status: 'limited', retryAt };

        if (!input.confirmTeammate) {
          const teammate = await replies.newestTeammateReply(
            workspaceId,
            conversationId,
            authorId,
            input.lastSeenReplyId,
            tx,
          );
          if (teammate) return { status: 'teammate', reply: teammate };
        }

        const reply = await replies.insert(
          workspaceId,
          {
            id: newId(),
            conversationId,
            clientKey,
            body: input.body,
            authorAccountId: authorId,
            positionAt: now,
          },
          tx,
        );
        if (!reply) {
          // Either the conversation is not in this workspace, or a concurrent request with the same
          // client key committed first (the insert did nothing): answer with that reply.
          const raced = await replies.findByClientKey(workspaceId, conversationId, clientKey, tx);
          return raced ? { status: 'existing', reply: raced } : { status: 'not_found' };
        }
        await replies.insertAttempt(
          workspaceId,
          {
            id: newId(),
            conversationId,
            replyId: reply.id,
            kind: 'send',
            initiatedByAccountId: authorId,
            createdAt: now,
          },
          tx,
        );
        await input.enqueueDrain(tx, workspaceId, conversationId);
        await signals.replyChanged(tx, {
          workspaceId,
          conversationId,
          replyId: reply.id,
          change: 'created',
        });
        return { status: 'created', reply };
      });
    },

    requeueReply(input) {
      const { workspaceId, conversationId, replyId, memberId } = input;
      return transaction(async (tx): Promise<RequeueReplyResult> => {
        await replies.lockDrain(workspaceId, conversationId, tx);
        const now = clock.now();
        const current = await replies.findForUpdate(workspaceId, conversationId, replyId, tx);
        if (!current) return { status: 'not_found' };
        if (current.state === 'sending' || !canTransition(current.state, 'sending')) {
          return { status: 'not_resendable', reply: current };
        }

        const retryAt = await limitedUntil(tx, workspaceId, memberId, now, input);
        if (retryAt) return { status: 'limited', retryAt };

        if (current.state === 'not_confirmed' && !input.confirmDuplicate) {
          return { status: 'confirmation_required' };
        }

        const reply = await replies.requeue(workspaceId, conversationId, replyId, now, tx);
        if (!reply) return { status: 'not_resendable', reply: current };
        const kind: AttemptKind = current.state === 'not_confirmed' ? 'send_again' : 'try_again';
        await replies.insertAttempt(
          workspaceId,
          {
            id: newId(),
            conversationId,
            replyId,
            kind,
            initiatedByAccountId: memberId,
            createdAt: now,
          },
          tx,
        );
        await input.enqueueDrain(tx, workspaceId, conversationId);
        await signals.replyChanged(tx, { workspaceId, conversationId, replyId, change: 'state' });
        return { status: 'requeued', reply };
      });
    },
  };
}

export interface FinishAttemptInput {
  workspaceId: string;
  conversationId: string;
  attemptId: string;
  attemptOutcome: AttemptOutcomeValue;
  /** `sending` leaves the reply as it is (a not-accepted answer inside the retry window). */
  replyState: 'sending' | 'sent' | 'not_delivered' | 'not_confirmed';
  failureReason?: string;
  telegramMessageId?: bigint;
  sentAt?: Date;
}

export interface DeadLetterOptions {
  /** In-flight attempts started before this are stale (the send timeout has passed). */
  staleBefore: Date;
  /** Supplied by `inbox`: whether a drain job of the conversation is queued or running. */
  drainQueued: DrainQueued;
}

export interface DeadLetterResult {
  notConfirmed: string[];
  interrupted: string[];
  /** Start of a young in-flight attempt left to its drain; a later drain must resolve it. */
  inFlightSince: Date | null;
}

export interface ReplyDelivery {
  /** Read under the conversation's drain lock, so a reply being stored with its job is waited for. */
  pendingReplies(workspaceId: string, conversationId: string): Promise<ReplyView[]>;
  lastStartedAt(workspaceId: string, conversationId: string): Promise<Date | null>;
  /** Start of the oldest attempt that started and has no outcome (in flight); null when none. */
  inFlightSince(workspaceId: string, conversationId: string): Promise<Date | null>;
  /** The Telegram chat to send to; null when the conversation is not in the workspace. */
  chatIdOf(workspaceId: string, conversationId: string): Promise<bigint | null>;
  /** Commits the attempt's `started_at` (in flight); null when the reply is no longer `sending`. */
  startAttempt(input: {
    workspaceId: string;
    conversationId: string;
    replyId: string;
  }): Promise<{ attemptId: string } | null>;
  /** Records the outcome, settles the reply and signals; false (no write) when already finished. */
  finishAttempt(input: FinishAttemptInput): Promise<boolean>;
  /** A pre-check failed: the attempt is `skipped` and the reply `not_delivered`. */
  skipReply(input: {
    workspaceId: string;
    conversationId: string;
    replyId: string;
    failureReason: string;
  }): Promise<boolean>;
  /** In-flight attempts started before `olderThan` become `unknown`, their replies `not_confirmed`. */
  resolveStaleInFlight(
    workspaceId: string,
    conversationId: string,
    olderThan: Date,
  ): Promise<string[]>;
  /** Whether the reply was refused with "not accepted" since `since` (its position): a retry is due. */
  wasNotAccepted(
    workspaceId: string,
    conversationId: string,
    replyId: string,
    since: Date,
  ): Promise<boolean>;
  /**
   * Dead-letter, under the drain lock: stale in-flight attempts end `unknown`. When no drain job of the
   * conversation is queued or running, `sending` replies with nothing in flight end
   * `delivery_interrupted`; a young in-flight attempt is left to the drain that started it.
   */
  resolveDeadLetter(
    workspaceId: string,
    conversationId: string,
    options: DeadLetterOptions,
  ): Promise<DeadLetterResult>;
}

export interface ReplyDeliveryDeps extends ReplyRequestsDeps {
  conversations: ConversationRepo;
  activities: ActivityRepo;
}

/** The storage half of the drain: pending, in flight, and the truthful final state of each reply (ADR-0004). */
export function createReplyDelivery(deps: ReplyDeliveryDeps): ReplyDelivery {
  const { transaction, replies, conversations, activities, signals, clock } = deps;
  type Tx = Parameters<Parameters<Transaction>[0]>[0];

  /**
   * Settles a `sending` reply and publishes its `state` signal; null when it was not `sending`
   * (or, with `idleOnly`, when an attempt of it is in flight). It takes no conversation lock: a
   * caller whose settlement failed calls `reopenIfClosed` once, after its last reply / attempt write.
   * A reply that was already final returns null, so it never reopens twice.
   */
  async function settle(
    tx: Tx,
    workspaceId: string,
    conversationId: string,
    replyId: string,
    settlement: ReplySettlement,
    idleOnly = false,
  ): Promise<ReplyView | null> {
    const reply = idleOnly
      ? await replies.settleIdleReply(workspaceId, conversationId, replyId, settlement, tx)
      : await replies.settleReply(workspaceId, conversationId, replyId, settlement, tx);
    if (!reply) return null;
    if (settlement.state === 'sent') {
      await replies.raiseReplySent(workspaceId, conversationId, settlement.sentAt, tx);
    }
    await signals.replyChanged(tx, { workspaceId, conversationId, replyId, change: 'state' });
    return reply;
  }

  /**
   * A reply that ended not delivered or not confirmed reopens a closed conversation (AC-08), on the
   * same transaction, under the conversation row lock — the last lock of the order documented above
   * `createReplies`, so it is called once, after every reply and attempt write of the transaction.
   */
  async function reopenIfClosed(tx: Tx, workspaceId: string, conversationId: string) {
    const locked = await conversations.lockState(workspaceId, conversationId, tx);
    if (locked?.status !== 'closed') return;
    await recordChange({ conversations, activities, signals }, tx, {
      workspaceId,
      conversationId,
      kind: 'reopened',
      cause: 'reply_not_delivered',
      actorAccountId: null,
      previousAssignee: null,
      newAssignee: null,
      now: clock.now(),
    });
  }

  return {
    pendingReplies: (workspaceId, conversationId) =>
      transaction(async (tx) => {
        await replies.lockDrain(workspaceId, conversationId, tx);
        return replies.pendingReplies(workspaceId, conversationId, tx);
      }),
    wasNotAccepted: (workspaceId, conversationId, replyId, since) =>
      replies.hasNotAcceptedAttempt(workspaceId, conversationId, replyId, since),
    lastStartedAt: (workspaceId, conversationId) =>
      replies.lastStartedAt(workspaceId, conversationId),
    inFlightSince: (workspaceId, conversationId) =>
      replies.oldestInFlightStart(workspaceId, conversationId),
    chatIdOf: (workspaceId, conversationId) => replies.chatIdOf(workspaceId, conversationId),

    startAttempt({ workspaceId, conversationId, replyId }) {
      return transaction(async (tx) => {
        const attemptId = await replies.startAttempt(
          workspaceId,
          conversationId,
          replyId,
          newId(),
          clock.now(),
          tx,
        );
        return attemptId ? { attemptId } : null;
      });
    },

    finishAttempt(input) {
      const { workspaceId, conversationId } = input;
      return transaction(async (tx) => {
        const finished = await replies.finishAttempt(
          workspaceId,
          conversationId,
          input.attemptId,
          input.attemptOutcome,
          clock.now(),
          tx,
        );
        if (!finished) return false;
        let settlement: ReplySettlement;
        switch (input.replyState) {
          case 'sending':
            return true;
          case 'sent':
            if (input.telegramMessageId === undefined || !input.sentAt) {
              throw new Error('A sent reply needs the Telegram message id and the sent time');
            }
            settlement = {
              state: 'sent',
              telegramMessageId: input.telegramMessageId,
              sentAt: input.sentAt,
            };
            break;
          case 'not_delivered':
            if (!input.failureReason)
              throw new Error('A not delivered reply needs a failure reason');
            settlement = { state: 'not_delivered', failureReason: input.failureReason };
            break;
          case 'not_confirmed':
            settlement = { state: 'not_confirmed' };
            break;
        }
        const settled = await settle(tx, workspaceId, conversationId, finished.replyId, settlement);
        if (settled && settlement.state !== 'sent') {
          await reopenIfClosed(tx, workspaceId, conversationId);
        }
        return true;
      });
    },

    skipReply({ workspaceId, conversationId, replyId, failureReason }) {
      return transaction(async (tx) => {
        const reply = await settle(tx, workspaceId, conversationId, replyId, {
          state: 'not_delivered',
          failureReason,
        });
        if (!reply) return false;
        await replies.skipAttempt(workspaceId, conversationId, replyId, newId(), clock.now(), tx);
        await reopenIfClosed(tx, workspaceId, conversationId);
        return true;
      });
    },

    resolveStaleInFlight(workspaceId, conversationId, olderThan) {
      return transaction(async (tx) => {
        const stale = await replies.inFlightAttempts(workspaceId, conversationId, olderThan, tx);
        const resolved = await resolveUnknown(tx, workspaceId, conversationId, stale);
        if (resolved.length) await reopenIfClosed(tx, workspaceId, conversationId);
        return resolved;
      });
    },

    resolveDeadLetter(workspaceId, conversationId, { staleBefore, drainQueued }) {
      return transaction(async (tx): Promise<DeadLetterResult> => {
        // Under the lock, a reply stored beside a new job is either committed (its job is seen
        // below) or not yet visible; neither is interrupted while a drain will carry it.
        await replies.lockDrain(workspaceId, conversationId, tx);
        const stale = await replies.inFlightAttempts(workspaceId, conversationId, staleBefore, tx);
        const notConfirmed = await resolveUnknown(tx, workspaceId, conversationId, stale);
        const interrupted: string[] = [];
        if (await drainQueued(tx, workspaceId, conversationId)) {
          if (notConfirmed.length) await reopenIfClosed(tx, workspaceId, conversationId);
          const inFlightSince = await replies.oldestInFlightStart(workspaceId, conversationId, tx);
          return { notConfirmed, interrupted, inFlightSince };
        }
        for (const reply of await replies.pendingReplies(workspaceId, conversationId, tx)) {
          // Atomic with the settle: an attempt a lagging drain started (even after a snapshot
          // taken here) leaves the reply to that drain, never `delivery_interrupted` mid-send.
          const settled = await settle(
            tx,
            workspaceId,
            conversationId,
            reply.id,
            { state: 'not_delivered', failureReason: 'delivery_interrupted' },
            true,
          );
          if (!settled) continue;
          await replies.skipAttempt(
            workspaceId,
            conversationId,
            reply.id,
            newId(),
            clock.now(),
            tx,
          );
          interrupted.push(reply.id);
        }
        // Once, after the loop: the conversation row is the last lock (see `createReplies`).
        if (notConfirmed.length || interrupted.length) {
          await reopenIfClosed(tx, workspaceId, conversationId);
        }
        // Read after the loop: a reply skipped for an attempt started meanwhile still gets the
        // delayed drain that resolves it once that attempt is stale.
        const inFlightSince = await replies.oldestInFlightStart(workspaceId, conversationId, tx);
        return { notConfirmed, interrupted, inFlightSince };
      });
    },
  };

  /**
   * Each in-flight attempt ends `unknown` and its reply `not_confirmed`; never retried on its own.
   * It takes no conversation lock: the caller reopens once, after its last write.
   */
  async function resolveUnknown(
    tx: Tx,
    workspaceId: string,
    conversationId: string,
    attempts: Array<{ id: string; replyId: string }>,
  ): Promise<string[]> {
    const resolved: string[] = [];
    for (const attempt of attempts) {
      const done = await replies.finishAttempt(
        workspaceId,
        conversationId,
        attempt.id,
        'unknown',
        clock.now(),
        tx,
      );
      if (!done) continue;
      await settle(tx, workspaceId, conversationId, done.replyId, { state: 'not_confirmed' });
      resolved.push(done.replyId);
    }
    return resolved;
  }
}
