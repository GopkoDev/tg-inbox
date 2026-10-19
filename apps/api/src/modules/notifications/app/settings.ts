import type { NotificationSettings } from '@tg/shared';
import type { BotReadiness, TelegramLinkRepo, Executor } from './ports.js';

export interface SettingsDeps {
  links: Pick<TelegramLinkRepo, 'findLiveByAccount' | 'listLive'>;
  bots: BotReadiness;
}

export interface SettingsInput {
  workspaceId: string;
  accountId: string;
  /** The caller's role from the workspace guard. */
  role: NotificationSettings['caller_role'];
}

export interface Settings {
  /**
   * The caller's own notification settings. Never carries the Telegram user id; a teammate's link is
   * never read. `tx` joins a caller's transaction (the refusals and Disconnect build their answer in it).
   */
  mySettings(input: SettingsInput, tx?: Executor): Promise<NotificationSettings>;
  /** The accounts with a live link in this workspace: ids only, for the Team mark (AC-12). */
  linkedAccounts(workspaceId: string): Promise<Set<string>>;
}

export function createSettings({ links, bots }: SettingsDeps): Settings {
  return {
    async linkedAccounts(workspaceId) {
      return new Set((await links.listLive(workspaceId)).map((link) => link.accountId));
    },

    async mySettings({ workspaceId, accountId, role }, tx) {
      const [link, bot] = await Promise.all([
        links.findLiveByAccount(workspaceId, accountId, {}, tx),
        bots.inboxBotStatus(workspaceId, tx),
      ]);
      if (!link) {
        return {
          workspace_id: workspaceId,
          caller_role: role,
          bot,
          telegram: { state: 'not_connected' },
          can_connect: bot.state === 'connected',
        };
      }
      // Flow 18's order: a blocked link wins over a bot that is not working; a taken-over bot still sends.
      const pings = link.blockedAt
        ? 'not_reachable'
        : bot.state === 'not_connected' || bot.state === 'needs_token'
          ? 'paused'
          : 'on';
      return {
        workspace_id: workspaceId,
        caller_role: role,
        bot,
        telegram: {
          state: 'connected',
          display_name: link.displayName ?? '',
          linked_at: link.linkedAt.toISOString(),
          blocked_at: link.blockedAt ? link.blockedAt.toISOString() : null,
          pings,
        },
        can_connect: false,
      };
    },
  };
}
