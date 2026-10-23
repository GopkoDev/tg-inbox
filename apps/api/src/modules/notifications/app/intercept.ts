import type { Clock } from '../../../platform/clock.js';
import { parseStartPayload } from '../domain/connect-link.js';
import { telegramDisplayName } from '../domain/sender.js';
import type { EnqueueBotMessage, TelegramLinkRepo, Transaction } from './ports.js';
import type { Redeem } from './redeem.js';

/** One private message or edit from a human sender (structurally what `bots` passes in). */
export interface InterceptInput {
  workspaceId: string;
  telegramBotId: bigint;
  from: {
    telegramUserId: bigint;
    firstName: string;
    lastName: string | null;
    username: string | null;
  };
  kind: string;
  /** The text, or the caption of any other kind. */
  text: string | null;
  edited: boolean;
}

export interface InterceptDeps {
  transaction: Transaction;
  links: Pick<TelegramLinkRepo, 'findLiveByTelegramUser' | 'claimNotice'>;
  redeem: Redeem;
  enqueue: EnqueueBotMessage;
  clock: Clock;
}

export interface Intercept {
  /**
   * `consumed` for a connect-link start (redeemed, whoever sends it) and for anything from a sender
   * with a live link made with this bot (AC-11); `pass` for everyone else. Failures propagate, so
   * nothing is captured and Telegram redelivers. Never logs the sender, the text or the token.
   */
  intercept(input: InterceptInput): Promise<'pass' | 'consumed'>;
}

export function createIntercept(deps: InterceptDeps): Intercept {
  const { transaction, links, redeem, enqueue, clock } = deps;
  return {
    async intercept(input) {
      const { workspaceId, from } = input;

      // Only a new plain text message is a start: not a caption, not an edit.
      const token =
        input.kind === 'text' && !input.edited && input.text ? parseStartPayload(input.text) : null;
      if (token) {
        await redeem.redeem({
          workspaceId,
          telegramBotId: input.telegramBotId,
          from: {
            id: from.telegramUserId,
            displayName: telegramDisplayName({
              firstName: from.firstName,
              lastName: from.lastName ?? undefined,
              username: from.username ?? undefined,
            }),
          },
          token,
          at: clock.now(),
        });
        return 'consumed';
      }

      // A link made with another bot does not count: that member is an end customer of this bot.
      const link = await links.findLiveByTelegramUser(workspaceId, from.telegramUserId);
      if (!link || link.telegramBotId !== input.telegramBotId) return 'pass';

      await transaction(async (tx) => {
        // At most one notice per link per hour; true for exactly one of any concurrent callers.
        if (await links.claimNotice(workspaceId, link.id, clock.now(), tx)) {
          await enqueue(tx, workspaceId, {
            kind: 'chat_only_notifications',
            telegramLinkId: link.id,
          });
        }
      });
      return 'consumed';
    },
  };
}
