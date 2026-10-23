import type { Clock } from '../../../platform/clock.js';
import type { MarkNeedsToken } from './mark-needs-token.js';
import type { Pacer } from './pacer.js';
import {
  SEND_TIMEOUT,
  type BotRepo,
  type MemberMessageOutcome,
  type TelegramGateway,
} from './ports.js';

export interface SendMemberMessageDeps {
  bots: BotRepo;
  telegram: TelegramGateway;
  markNeedsToken: MarkNeedsToken;
  clock: Clock;
  pacer: Pacer;
}

export interface SendMemberMessageRequest {
  workspaceId: string;
  /** The member's Telegram user id: the private chat id. */
  telegramUserId: bigint;
  text: string;
}

export interface SendMemberMessage {
  /**
   * Sends plain text (link preview off) to a member through the workspace's own bot, paced at
   * 10 per second per bot and refused while the bot's send pause runs (ADR-0006). Never throws:
   * every answer is an outcome. A 429 stores the pause; a 401 flips the bot to `needs_token`.
   */
  sendMemberMessage(request: SendMemberMessageRequest): Promise<MemberMessageOutcome>;
}

const UNAVAILABLE: MemberMessageOutcome = { outcome: 'bot_unavailable' };

export function createSendMemberMessage({
  bots,
  telegram,
  markNeedsToken,
  clock,
  pacer,
}: SendMemberMessageDeps): SendMemberMessage {
  return {
    async sendMemberMessage({ workspaceId, telegramUserId, text }) {
      const bot = await bots.findByWorkspace(workspaceId);
      if (!bot || (bot.state !== 'connected' && bot.state !== 'taken_over')) return UNAVAILABLE;
      if (bot.sendPausedUntil && bot.sendPausedUntil.getTime() > clock.now().getTime()) {
        return { outcome: 'rate_limited', retryAfter: bot.sendPausedUntil };
      }
      const found = await bots.findForCheck(workspaceId, bot.id);
      if (!found) return UNAVAILABLE;
      if (found.token === null) {
        await markNeedsToken(workspaceId);
        return UNAVAILABLE;
      }
      await pacer.wait(bot.id);
      const sent = await telegram.sendText(found.token, telegramUserId, text, SEND_TIMEOUT, {
        disableLinkPreview: true,
      });
      switch (sent.outcome) {
        case 'accepted':
          return { outcome: 'accepted' };
        case 'refused':
          return { outcome: 'blocked' };
        case 'bot_unauthorized':
          await markNeedsToken(workspaceId);
          return UNAVAILABLE;
        case 'not_accepted': {
          if (sent.retryAfterMs === undefined) return { outcome: 'transient' };
          const retryAfter = new Date(clock.now().getTime() + sent.retryAfterMs);
          await bots.pauseSends(workspaceId, bot.id, retryAfter);
          return { outcome: 'rate_limited', retryAfter };
        }
        case 'unknown':
          return { outcome: 'unknown' };
      }
    },
  };
}
