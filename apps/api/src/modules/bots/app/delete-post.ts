import type { MarkNeedsToken } from './mark-needs-token.js';
import { SEND_TIMEOUT, type BotRepo, type TelegramGateway } from './ports.js';

export interface DeletePostDeps {
  bots: BotRepo;
  telegram: TelegramGateway;
  markNeedsToken: MarkNeedsToken;
}

export interface DeletePostRequest {
  workspaceId: string;
  /** The Telegram bot that published the post. */
  telegramBotId: bigint;
  chatId: string;
  messageId: bigint;
}

export type PostDeleteOutcome =
  | { outcome: 'deleted' }
  /** Telegram refused, or no working bot is left: the bot can no longer delete it. */
  | { outcome: 'refused' }
  /** The bot was replaced since the post went out. */
  | { outcome: 'bot_changed' };

export interface DeletePost {
  /** Deletes a published post through the workspace's bot; refuses a replaced bot before the call. */
  deletePost(request: DeletePostRequest): Promise<PostDeleteOutcome>;
}

export function createDeletePost({ bots, telegram, markNeedsToken }: DeletePostDeps): DeletePost {
  return {
    async deletePost({ workspaceId, telegramBotId, chatId, messageId }) {
      const bot = await bots.findByWorkspace(workspaceId);
      if (!bot || (bot.state !== 'connected' && bot.state !== 'taken_over')) {
        return { outcome: 'refused' };
      }
      if (bot.telegramBotId !== telegramBotId) return { outcome: 'bot_changed' };
      const found = await bots.findForCheck(workspaceId, bot.id);
      if (!found) return { outcome: 'refused' };
      if (found.token === null) {
        await markNeedsToken(workspaceId);
        return { outcome: 'refused' };
      }
      return telegram.deletePost(found.token, chatId, messageId, SEND_TIMEOUT);
    },
  };
}
