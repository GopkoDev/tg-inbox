import type { BotState } from '../domain/connection.js';
import type { BotRepo } from './ports.js';

export interface PostReadinessDeps {
  bots: BotRepo;
}

export interface PostReadiness {
  state: BotState;
  telegramBotId: bigint;
  /** Posts wait until then; null or past: not paused. */
  sendPausedUntil: Date | null;
}

export interface PostReadinessReads {
  /** What `posts` needs to know before it sends; null when the workspace has no bot. */
  postReadiness(workspaceId: string): Promise<PostReadiness | null>;
}

export function createPostReadiness({ bots }: PostReadinessDeps): PostReadinessReads {
  return {
    async postReadiness(workspaceId) {
      const bot = await bots.findByWorkspace(workspaceId);
      if (!bot) return null;
      return {
        state: bot.state,
        telegramBotId: bot.telegramBotId,
        sendPausedUntil: bot.sendPausedUntil,
      };
    },
  };
}
