import type { BotState } from '../domain/connection.js';
import type { BotRepo, Executor } from './ports.js';

export interface LaunchReadinessDeps {
  bots: Pick<BotRepo, 'findByWorkspace'>;
}

export interface LaunchReadinessReads {
  /**
   * What `broadcasts` needs before a launch and for every draft read (sad.md §5, AC-10): the bot
   * row's state and Telegram bot id; null when the workspace has no bot row.
   */
  launchReadiness(
    workspaceId: string,
    tx?: Executor,
  ): Promise<{ state: BotState; telegramBotId: bigint } | null>;
}

export function createLaunchReadiness({ bots }: LaunchReadinessDeps): LaunchReadinessReads {
  return {
    async launchReadiness(workspaceId, tx) {
      const bot = await bots.findByWorkspace(workspaceId, tx);
      return bot ? { state: bot.state, telegramBotId: bot.telegramBotId } : null;
    },
  };
}
