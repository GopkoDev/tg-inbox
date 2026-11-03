import { SEND_TIMEOUT, type BotRepo, type TelegramGateway } from './ports.js';

export interface BotRightsDeps {
  bots: BotRepo;
  telegram: TelegramGateway;
}

export interface BotRightsRequest {
  workspaceId: string;
  telegramBotId: bigint;
  chatId: bigint;
  kind: string;
}

export interface BotRights {
  /** Whether the workspace's bot may post in that chat; false when there is no usable bot or token. */
  botRights(request: BotRightsRequest): Promise<{ canPost: boolean }>;
}

export function createBotRights({ bots, telegram }: BotRightsDeps): BotRights {
  return {
    async botRights({ workspaceId, telegramBotId, chatId, kind }) {
      const bot = await bots.findByWorkspace(workspaceId);
      if (!bot || bot.telegramBotId !== telegramBotId) return { canPost: false };
      const found = await bots.findForCheck(workspaceId, bot.id);
      if (!found || found.token === null) return { canPost: false };
      return telegram.chatRights(found.token, chatId.toString(), telegramBotId, kind, SEND_TIMEOUT);
    },
  };
}
