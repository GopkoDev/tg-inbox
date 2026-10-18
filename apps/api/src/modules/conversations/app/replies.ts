import type { Clock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import { canTransition } from '../domain/reply.js';
import type { Transaction } from './conversations.js';
import type {
  AttemptKind,
  AttemptOutcomeValue,
  ConversationSignals,
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
        const now = clock.now();
        const existing = await replies.findByClientKey(workspaceId, conversationId, clientKey, tx);
        if (existing) return { status: 'existing', reply: existing };

        const retryAt = await limitedUntil(tx, workspaceId, authorId, now, input);
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

export interface ReplyDelivery {
  pendingReplies(workspaceId: string, conversationId: string): Promise<ReplyView[]>;
  lastStartedAt(workspaceId: string, conversationId: string): Promise<Date | null>;
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
  /** Dead-letter: every in-flight attempt `unknown`; unattempted `sending` replies `delivery_interrupted`. */
  resolveDeadLetter(
    workspaceId: string,
    conversationId: string,
  ): Promise<{ notConfirmed: string[]; interrupted: string[] }>;
}

/** The storage half of the drain: pending, in flight, and the truthful final state of each reply (ADR-0004). */
export function createReplyDelivery(deps: ReplyRequestsDeps): ReplyDelivery {
  const { transaction, replies, signals, clock } = deps;
  type Tx = Parameters<Parameters<Transaction>[0]>[0];

  /** Settles a `sending` reply and publishes its `state` signal; null when it was not `sending`. */
  async function settle(
    tx: Tx,
    workspaceId: string,
    conversationId: string,
    replyId: string,
    settlement: ReplySettlement,
  ): Promise<ReplyView | null> {
    const reply = await replies.settleReply(workspaceId, conversationId, replyId, settlement, tx);
    if (!reply) return null;
    if (settlement.state === 'sent') {
      await replies.raiseReplySent(workspaceId, conversationId, settlement.sentAt, tx);
    }
    await signals.replyChanged(tx, { workspaceId, conversationId, replyId, change: 'state' });
    return reply;
  }

  return {
    pendingReplies: (workspaceId, conversationId) =>
      replies.pendingReplies(workspaceId, conversationId),
    lastStartedAt: (workspaceId, conversationId) =>
      replies.lastStartedAt(workspaceId, conversationId),

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
        await settle(tx, workspaceId, conversationId, finished.replyId, settlement);
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
        return true;
      });
    },

    resolveStaleInFlight(workspaceId, conversationId, olderThan) {
      return transaction(async (tx) => {
        const stale = await replies.inFlightAttempts(workspaceId, conversationId, olderThan, tx);
        return resolveUnknown(tx, workspaceId, conversationId, stale);
      });
    },

    resolveDeadLetter(workspaceId, conversationId) {
      return transaction(async (tx) => {
        const inFlight = await replies.inFlightAttempts(workspaceId, conversationId, null, tx);
        const notConfirmed = await resolveUnknown(tx, workspaceId, conversationId, inFlight);
        const interrupted: string[] = [];
        for (const reply of await replies.pendingReplies(workspaceId, conversationId, tx)) {
          const settled = await settle(tx, workspaceId, conversationId, reply.id, {
            state: 'not_delivered',
            failureReason: 'delivery_interrupted',
          });
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
        return { notConfirmed, interrupted };
      });
    },
  };

  /** Each in-flight attempt ends `unknown` and its reply `not_confirmed`; never retried on its own. */
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
