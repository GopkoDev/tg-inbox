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
      // A disconnected row is kept only for its conversations (AC-05). One without is a
      // disconnect cut short between its clear and its delete: running disconnect again finishes it.
      if (row?.state === 'disconnected' && !(await conversations.hasConversations(workspaceId))) {
        await bots.delete(workspaceId, row.id);
        return settings.getSettings(workspaceId);
      }
      const found =
        row && row.state !== 'disconnected' ? await bots.findForCheck(workspaceId, row.id) : null;
      if (!found) throw new NoBotConnectedError(await settings.getSettings(workspaceId));
      const { bot, token } = found;

      // A token the current key cannot decrypt (ADR-0006) is treated like a dead one: no Telegram
      // call is possible. Deliveries to its webhook stop authenticating once the clear below
      // removes the secret hash.
      if (token !== null) {
        const target = await telegram.getWebhook(
          token,
          webhookUrl(webhookBaseUrl, bot.id),
          OWNER_ACTION_TIMEOUT,
        );
        if (target === 'transient') throw new TelegramUnavailableError();
        // `unauthorized`: the token is dead, nothing to remove; foreign / none: not ours.
        if (target === 'ours') {
          const deleted = await telegram.deleteWebhook(token, OWNER_ACTION_TIMEOUT);
          if (deleted === 'failed') throw new TelegramUnavailableError();
        }
      }

      // Clear first: from here no delivery authenticates, so no new first conversation can
      // appear after the check below. A delivery that authenticated earlier and commits between
      // the clear and the check is seen by it; only one still in flight past the check remains
      // (a sub-millisecond window, accepted). Should the check fail after the clear, running
      // disconnect again (or the next paste) finishes the delete of a row nobody wrote through.
      await bots.clearOnDisconnect(workspaceId, bot.id);
      if (!(await conversations.hasConversations(workspaceId))) {
        await bots.delete(workspaceId, bot.id);
      }
      return settings.getSettings(workspaceId);
    },
  };
}
