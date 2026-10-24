import type { Clock } from '../../../platform/clock.js';
import type { MarkNeedsToken } from './mark-needs-token.js';
import type { Pacer } from './pacer.js';
import {
  SEND_TIMEOUT,
  type BotRepo,
  type BroadcastSendOutcome,
  type ContactsReach,
  type TelegramGateway,
} from './ports.js';

export interface SendBroadcastMessageDeps {
  bots: BotRepo;
  telegram: TelegramGateway;
  markNeedsToken: MarkNeedsToken;
  clock: Clock;
  /** The broadcast pacer (25 per second per bot), not the member-message one. */
  pacer: Pacer;
  /** A send refused as blocked records the block (ADR-0003). */
  reach: ContactsReach;
}

export interface SendBroadcastRequest {
  workspaceId: string;
  /** The Telegram bot the broadcast was launched with. */
  telegramBotId: bigint;
  /** The recipient's Telegram user id: the private chat id. */
  chatId: bigint;
  /** Sent exactly as given (already trimmed at save), as plain text. */
  text: string;
  /**
   * When the broadcast was launched: a bot connected again since (after a disconnect or a lost
   * token) stopped working meanwhile, so nothing more of it is sent (AC-12).
   */
  launchedAt: Date;
}

export interface SendBroadcastMessage {
  /**
   * One broadcast message through the workspace's own bot (ADR-0008, flow 12). Refuses without a
   * Telegram call when the bot is missing or not `connected` / `taken_over`, is another Telegram
   * bot than the launch one, or its send pause runs; otherwise takes the bot's next pacer slot and
   * classifies Telegram's answer. Never throws on a Telegram answer.
   */
  sendBroadcastMessage(request: SendBroadcastRequest): Promise<BroadcastSendOutcome>;
}

/** A 429 without `retry_after` still pauses the bot's broadcasts briefly. */
const DEFAULT_PAUSE_MS = 1000;
const UNAVAILABLE: BroadcastSendOutcome = { outcome: 'bot_unavailable' };

export function createSendBroadcastMessage({
  bots,
  telegram,
  markNeedsToken,
  clock,
  pacer,
  reach,
}: SendBroadcastMessageDeps): SendBroadcastMessage {
  return {
    async sendBroadcastMessage({ workspaceId, telegramBotId, chatId, text, launchedAt }) {
      const bot = await bots.findByWorkspace(workspaceId);
      if (!bot || (bot.state !== 'connected' && bot.state !== 'taken_over')) return UNAVAILABLE;
      if (bot.telegramBotId !== telegramBotId) return { outcome: 'bot_changed' };
      if (bot.connectedAt !== null && bot.connectedAt.getTime() > launchedAt.getTime()) {
        return UNAVAILABLE;
      }
      if (bot.sendPausedUntil && bot.sendPausedUntil.getTime() > clock.now().getTime()) {
        return { outcome: 'paused', until: bot.sendPausedUntil };
      }
      const found = await bots.findForCheck(workspaceId, bot.id);
      if (!found) return UNAVAILABLE;
      // The key that encrypted the token is gone (ADR-0006): the owner pastes the token again.
      if (found.token === null) {
        await markNeedsToken(workspaceId);
        return UNAVAILABLE;
      }
      await pacer.wait(bot.id);
      // A rate limit answered to any send of the bot while this one waited for its slot (AC-15).
      const pausedUntil = (await bots.findByWorkspace(workspaceId))?.sendPausedUntil;
      if (pausedUntil && pausedUntil.getTime() > clock.now().getTime()) {
        return { outcome: 'paused', until: pausedUntil };
      }
      const sent = await telegram.sendBroadcast(found.token, chatId, text, SEND_TIMEOUT);
      switch (sent.outcome) {
        case 'accepted':
          return { outcome: 'delivered', messageId: sent.messageId, at: sent.at };
        case 'blocked':
          // Our clock is the fact's time (data-model assumption 11). The answer never depends on
          // this write: the block is learned again on the next refusal or my_chat_member.
          await reach
            .recordBlockChange(workspaceId, telegramBotId, chatId, true, clock.now())
            .catch(() => undefined);
          return { outcome: 'blocked' };
        case 'account_gone':
        case 'chat_not_found':
        case 'text_refused':
          return { outcome: sent.outcome };
        case 'error':
          return { outcome: 'telegram_error' };
        case 'bot_unauthorized':
          await markNeedsToken(workspaceId);
          return UNAVAILABLE;
        case 'rate_limited': {
          const retryAfter = new Date(
            clock.now().getTime() + (sent.retryAfterMs ?? DEFAULT_PAUSE_MS),
          );
          await bots.pauseSends(workspaceId, bot.id, retryAfter);
          return { outcome: 'rate_limited', retryAfter };
        }
        case 'unknown':
          return { outcome: 'not_confirmed' };
      }
    },
  };
}
