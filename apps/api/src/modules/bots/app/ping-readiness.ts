import type { BotRepo } from './ports.js';
import type { BotState } from '../domain/connection.js';

export interface PingReadinessDeps {
  bots: BotRepo;
}

export interface PingReadiness {
  state: BotState;
  telegramBotId: bigint;
  username: string;
  /** Pings are refused until then; null or past: not paused. */
  sendPausedUntil: Date | null;
}

export interface PingReadinessReads {
  /** What `notifications` needs to know before it sends; null when the workspace has no bot. */
  pingReadiness(workspaceId: string): Promise<PingReadiness | null>;
}

export function createPingReadiness({ bots }: PingReadinessDeps): PingReadinessReads {
  return {
    async pingReadiness(workspaceId) {
      const bot = await bots.findByWorkspace(workspaceId);
      if (!bot) return null;
      return {
        state: bot.state,
        telegramBotId: bot.telegramBotId,
        username: bot.username,
        sendPausedUntil: bot.sendPausedUntil,
      };
    },
  };
}
