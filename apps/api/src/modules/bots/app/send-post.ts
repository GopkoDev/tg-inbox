import type { Clock } from '../../../platform/clock.js';
import type { MarkNeedsToken } from './mark-needs-token.js';
import type { Pacer } from './pacer.js';
import { SEND_TIMEOUT, type BotRepo, type TelegramGateway } from './ports.js';

export interface SendPostDeps {
  bots: BotRepo;
  telegram: TelegramGateway;
  markNeedsToken: MarkNeedsToken;
  clock: Clock;
  /** The post pacer (1 per second per bot), apart from the member and broadcast ones. */
  pacer: Pacer;
}

export interface SendPostRequest {
  workspaceId: string;
  /** The Telegram bot the post was claimed with. */
  telegramBotId: bigint;
  /** The channel or group id, as a string (it never goes through `Number`). */
  chatId: string;
  /** Sent exactly as given, as plain text. */
  text: string;
  silent: boolean;
}

export type PostSendOutcome =
  | { outcome: 'sent'; messageId: bigint; at: Date }
  /** The bot's send pause runs: not called. */
  | { outcome: 'paused'; until: Date }
  | { outcome: 'bot_unavailable' }
  | { outcome: 'bot_changed' }
  /** A 429 to this chat: the caller delays only this destination; the bot's pause is untouched. */
  | { outcome: 'rate_limited'; retryAfterMs?: number }
  | { outcome: 'no_post_right' }
  | { outcome: 'chat_gone' }
  | { outcome: 'text_refused' }
  | { outcome: 'telegram_error' }
  | { outcome: 'no_answer' };

export interface SendPost {
  /**
   * One post through the workspace's own bot. Refuses without a Telegram call when the bot is
   * missing or not working, is another Telegram bot than the claim one, or its send pause runs;
   * otherwise takes the bot's next post slot and classifies Telegram's answer. Never throws on a
   * Telegram answer.
   */
  sendPost(request: SendPostRequest): Promise<PostSendOutcome>;
}

const UNAVAILABLE: PostSendOutcome = { outcome: 'bot_unavailable' };

export function createSendPost({
  bots,
  telegram,
  markNeedsToken,
  clock,
  pacer,
}: SendPostDeps): SendPost {
  return {
    async sendPost({ workspaceId, telegramBotId, chatId, text, silent }) {
      const bot = await bots.findByWorkspace(workspaceId);
      if (!bot || (bot.state !== 'connected' && bot.state !== 'taken_over')) return UNAVAILABLE;
      if (bot.telegramBotId !== telegramBotId) return { outcome: 'bot_changed' };
      if (bot.sendPausedUntil && bot.sendPausedUntil.getTime() > clock.now().getTime()) {
        return { outcome: 'paused', until: bot.sendPausedUntil };
      }
      const found = await bots.findForCheck(workspaceId, bot.id);
      if (!found) return UNAVAILABLE;
      if (found.token === null) {
        await markNeedsToken(workspaceId);
        return UNAVAILABLE;
      }
      await pacer.wait(bot.id);
      const sent = await telegram.sendPost(found.token, chatId, text, silent, SEND_TIMEOUT);
      switch (sent.outcome) {
        case 'accepted':
          return { outcome: 'sent', messageId: sent.messageId, at: sent.at };
        case 'bot_unauthorized':
          await markNeedsToken(workspaceId);
          return UNAVAILABLE;
        case 'rate_limited':
          return sent.retryAfterMs === undefined
            ? { outcome: 'rate_limited' }
            : { outcome: 'rate_limited', retryAfterMs: sent.retryAfterMs };
        case 'no_post_right':
        case 'chat_gone':
        case 'text_refused':
        case 'no_answer':
          return { outcome: sent.outcome };
        default:
          return { outcome: 'telegram_error' };
      }
    },
  };
}
