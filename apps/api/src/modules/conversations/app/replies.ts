import type { Clock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import { canTransition } from '../domain/reply.js';
import type { Transaction } from './conversations.js';
import type {
  AttemptKind,
  ConversationSignals,
  EnqueueDrain,
  ReplyRepo,
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
        if (!reply) return { status: 'not_found' };
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
