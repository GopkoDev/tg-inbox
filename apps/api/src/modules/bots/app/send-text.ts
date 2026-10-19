import type { Clock } from '../../../platform/clock.js';
import { SEND_TIMEOUT, type BotRepo, type SendOutcome, type TelegramGateway } from './ports.js';
import type { MarkNeedsToken } from './mark-needs-token.js';

export interface SendTextDeps {
  bots: BotRepo;
  telegram: TelegramGateway;
  markNeedsToken: MarkNeedsToken;
  clock: Clock;
}

export interface SendTextRequest {
  workspaceId: string;
  chatId: bigint;
  text: string;
}

export interface SendText {
  /**
   * Sends plain text through the workspace's own bot and classifies the answer. A bot that is not
   * `connected` / `taken_over` is not called (`bot_unauthorized`); a rejected token flips the bot
   * to `needs_token` (and tells the open inboxes) before the outcome is returned. A Telegram 429
   * stores the bot's send pause (ADR-0006); the reply path stores it but never reads it.
   */
  sendText(request: SendTextRequest): Promise<SendOutcome>;
}

const UNAUTHORIZED: SendOutcome = { outcome: 'bot_unauthorized' };

export function createSendText({ bots, telegram, markNeedsToken, clock }: SendTextDeps): SendText {
  return {
    async sendText({ workspaceId, chatId, text }) {
      const bot = await bots.findByWorkspace(workspaceId);
      if (!bot || (bot.state !== 'connected' && bot.state !== 'taken_over')) return UNAUTHORIZED;
      const found = await bots.findForCheck(workspaceId, bot.id);
      if (!found) return UNAUTHORIZED;
      // The key that encrypted the token is gone (ADR-0006): the owner pastes the token again.
      if (found.token === null) {
        await markNeedsToken(workspaceId);
        return UNAUTHORIZED;
      }
      const outcome = await telegram.sendText(found.token, chatId, text, SEND_TIMEOUT);
      if (outcome.outcome === 'bot_unauthorized') await markNeedsToken(workspaceId);
      if (outcome.outcome === 'not_accepted' && outcome.retryAfterMs !== undefined) {
        await bots.pauseSends(
          workspaceId,
          bot.id,
          new Date(clock.now().getTime() + outcome.retryAfterMs),
        );
      }
      return outcome;
    },
  };
}
