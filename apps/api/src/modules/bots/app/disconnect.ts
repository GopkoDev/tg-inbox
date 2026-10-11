import type { BotSettings } from '@tg/shared';
import { NoBotConnectedError, TelegramUnavailableError } from '../../../platform/errors.js';
import {
  OWNER_ACTION_TIMEOUT,
  type BotRepo,
  type ConversationsApi,
  type TelegramGateway,
} from './ports.js';
import type { BotSettingsReader } from './settings.js';
import { webhookUrl } from './webhook-url.js';

export interface DisconnectDeps {
  bots: BotRepo;
  telegram: TelegramGateway;
  conversations: Pick<ConversationsApi, 'hasConversations'>;
  settings: BotSettingsReader;
  /** `TELEGRAM_WEBHOOK_BASE_URL`. */
  webhookBaseUrl: string;
}

export interface Disconnect {
  /**
   * Flow 7 (AC-18): stop capturing. Our webhook is removed (dropping pending updates); another
   * service's is never touched. A bot customers wrote to keeps its row — bound, without token,
   * secret or capture epoch — so the workspace stays with it (AC-05); otherwise the row is deleted.
   */
  disconnect(workspaceId: string): Promise<BotSettings>;
}

export function createDisconnect(deps: DisconnectDeps): Disconnect {
  const { bots, telegram, conversations, settings, webhookBaseUrl } = deps;

  return {
    async disconnect(workspaceId) {
      const row = await bots.findByWorkspace(workspaceId);
      const found =
        row && row.state !== 'disconnected' ? await bots.findForCheck(workspaceId, row.id) : null;
      if (!found) throw new NoBotConnectedError(await settings.getSettings(workspaceId));
      const { bot, token } = found;

      const target = await telegram.getWebhook(
        token,
        webhookUrl(webhookBaseUrl, bot.id),
        OWNER_ACTION_TIMEOUT,
      );
      if (target === 'transient') throw new TelegramUnavailableError();
      // `unauthorized`: the token is dead, nothing to remove; foreign / none: not ours to remove.
      if (target === 'ours') {
        const deleted = await telegram.deleteWebhook(token, OWNER_ACTION_TIMEOUT);
        if (deleted === 'failed') throw new TelegramUnavailableError();
      }

      if (await conversations.hasConversations(workspaceId)) {
        await bots.clearOnDisconnect(workspaceId, bot.id);
      } else {
        await bots.delete(workspaceId, bot.id);
      }
      return settings.getSettings(workspaceId);
    },
  };
}
