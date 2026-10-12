import type { BotSettings } from '@tg/shared';
import type { BotRepo, ContactsApi, ConversationsApi } from './ports.js';

export interface BotSettingsDeps {
  bots: BotRepo;
  conversations: ConversationsApi;
  contacts: ContactsApi;
}

export interface BotSettingsReader {
  /** SCR-02 (flow 4): a pure database read, no Telegram call. Never the token or the secret. */
  getSettings(workspaceId: string): Promise<BotSettings>;
}

export function createBotSettings({
  bots,
  conversations,
  contacts,
}: BotSettingsDeps): BotSettingsReader {
  return {
    async getSettings(workspaceId) {
      const bot = await bots.findByWorkspace(workspaceId);
      // A live row always has a last check (bots_last_checked_at_state_check).
      if (!bot || bot.state === 'disconnected' || !bot.lastCheckedAt) {
        return { state: 'not_connected' };
      }
      const [lastMessage, contactsCount] = await Promise.all([
        conversations.lastMessageReceivedAt(workspaceId),
        contacts.countContacts(workspaceId),
      ]);
      return {
        state: bot.state,
        bot: { name: bot.name, username: bot.username },
        last_checked_at: bot.lastCheckedAt.toISOString(),
        last_message_received_at: lastMessage?.toISOString() ?? null,
        contacts_count: contactsCount,
      };
    },
  };
}
