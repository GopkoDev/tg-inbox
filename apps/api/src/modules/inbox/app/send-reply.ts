import type { InboxBotStatus, ReplyResend, ReplySend, ThreadReply } from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import {
  BotCannotReplyError,
  DuplicateRiskConfirmationRequiredError,
  NotFoundError,
  ReplyLimitReachedError,
  ReplyNotResendableError,
  TeammateRepliedError,
  ValidationError,
} from '../../../platform/errors.js';
import type { EnqueueDrain, ReplyView } from '../../conversations/app/ports.js';
import type { ReplyRequests } from '../../conversations/app/replies.js';
import { checkReplyText } from '../domain/reply-text.js';
import { LIMIT_WINDOW_MS, REPLY_LIMIT, REPLY_MAX } from '../domain/rules.js';
import { replyDto } from './reads.js';

export interface SendReplyDeps {
  replies: ReplyRequests;
  bots: {
    canCarryReplies(workspaceId: string): Promise<boolean>;
    inboxBotStatus(workspaceId: string): Promise<InboxBotStatus>;
  };
  workspaces: {
    displayNames(workspaceId: string, accountIds: readonly string[]): Promise<Map<string, string>>;
  };
  /** Puts the conversation's drain job on the request's transaction (pg-boss, ADR-0004). */
  enqueueDrain: EnqueueDrain;
  clock: Clock;
}

const iso = (d: Date) => d.toISOString();

/**
 * Accepting a reply (flow 1) or a resend (flow 7): the checks run in the contract's order, the first
 * refusal wins and nothing is stored on a refusal.
 */
export function createSendReply(deps: SendReplyDeps) {
  const { replies, bots, workspaces, enqueueDrain, clock } = deps;

  const nameOf = async (workspaceId: string, accountId: string) =>
    (await workspaces.displayNames(workspaceId, [accountId])).get(accountId) ?? '?';

  const toDto = async (workspaceId: string, view: ReplyView): Promise<ThreadReply> =>
    replyDto(workspaceId, view, await workspaces.displayNames(workspaceId, [view.authorAccountId]));

  const limited = (retryAt: Date) =>
    new ReplyLimitReachedError(
      retryAt,
      Math.max(1, Math.ceil((retryAt.getTime() - clock.now().getTime()) / 1000)),
    );

  const cannotReply = async (workspaceId: string) =>
    new BotCannotReplyError(await bots.inboxBotStatus(workspaceId));

  return {
    async sendReply(
      workspaceId: string,
      memberId: string,
      conversationId: string,
      input: Pick<ReplySend, 'client_key' | 'body' | 'last_seen_reply_id'> & {
        confirm_teammate_reply?: boolean;
      },
    ): Promise<{ created: boolean; reply: ThreadReply }> {
      // 1. The text (AC-07); length in UTF-16 units, as Telegram counts.
      const text = checkReplyText(input.body);
      if (text === 'blank') {
        throw new ValidationError('Write a reply before sending', { field: 'body' });
      }
      if (text === 'too_long') {
        throw new ValidationError(`Replies are limited to ${REPLY_MAX} characters`, {
          field: 'body',
          max_length: REPLY_MAX,
        });
      }
      // 2. The bot (AC-13).
      if (!(await bots.canCarryReplies(workspaceId))) throw await cannotReply(workspaceId);

      // 3. One transaction: same key, the limit, the teammate warning, then store + enqueue.
      const result = await replies.createReply({
        workspaceId,
        conversationId,
        authorId: memberId,
        clientKey: input.client_key,
        body: input.body,
        lastSeenReplyId: input.last_seen_reply_id,
        confirmTeammate: input.confirm_teammate_reply === true,
        limit: REPLY_LIMIT,
        windowMs: LIMIT_WINDOW_MS,
        enqueueDrain,
      });
      switch (result.status) {
        case 'created':
        case 'existing':
          return {
            created: result.status === 'created',
            reply: await toDto(workspaceId, result.reply),
          };
        case 'limited':
          throw limited(result.retryAt);
        case 'teammate':
          throw new TeammateRepliedError({
            id: result.reply.id,
            author: {
              account_id: result.reply.authorAccountId,
              display_name: await nameOf(workspaceId, result.reply.authorAccountId),
            },
            position_at: iso(result.reply.positionAt),
          });
        case 'not_found':
          throw new NotFoundError('Not found');
      }
    },

    async resendReply(
      workspaceId: string,
      memberId: string,
      conversationId: string,
      replyId: string,
      input: Partial<ReplyResend>,
    ): Promise<ThreadReply> {
      // Checks 1-3 (resendable, limit, duplicate risk) run inside `requeueReply`; check 4 (the bot)
      // runs when the drain job is handed over, still inside its transaction, so a refusal rolls
      // the re-queue back.
      const result = await replies.requeueReply({
        workspaceId,
        conversationId,
        replyId,
        memberId,
        confirmDuplicate: input.confirm_duplicate_risk === true,
        limit: REPLY_LIMIT,
        windowMs: LIMIT_WINDOW_MS,
        enqueueDrain: async (tx, ws, conversation) => {
          if (!(await bots.canCarryReplies(ws))) throw await cannotReply(ws);
          await enqueueDrain(tx, ws, conversation);
        },
      });
      switch (result.status) {
        case 'requeued':
          return toDto(workspaceId, result.reply);
        case 'not_resendable':
          throw new ReplyNotResendableError(await toDto(workspaceId, result.reply));
        case 'limited':
          throw limited(result.retryAt);
        case 'confirmation_required':
          throw new DuplicateRiskConfirmationRequiredError();
        case 'not_found':
          throw new NotFoundError('Not found');
      }
    },
  };
}

export type SendReplyUseCases = ReturnType<typeof createSendReply>;
