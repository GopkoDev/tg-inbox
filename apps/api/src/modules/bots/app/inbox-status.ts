import type { InboxBotStatus } from '@tg/shared';
import type { BotRepo } from './ports.js';

export interface InboxBotStatusDeps {
  bots: Pick<BotRepo, 'findByWorkspace'>;
}

export interface InboxBotStatusReader {
  /**
   * Any member's view of the bot (AC-13, AC-14): a pure database read. Never the bot's name,
   * the token or the secret. No row and `disconnected` are both `not_connected`.
   */
  inboxBotStatus(workspaceId: string): Promise<InboxBotStatus>;
  /** The send pre-check: true for `connected` and `taken_over`. */
  canCarryReplies(workspaceId: string): Promise<boolean>;
}

export function createInboxBotStatus({ bots }: InboxBotStatusDeps): InboxBotStatusReader {
  const inboxBotStatus: InboxBotStatusReader['inboxBotStatus'] = async (workspaceId) => {
    const bot = await bots.findByWorkspace(workspaceId);
    const state = !bot || bot.state === 'disconnected' ? 'not_connected' : bot.state;
    return {
      workspace_id: workspaceId,
      state,
      can_reply: state === 'connected' || state === 'taken_over',
      receiving: state === 'connected',
    };
  };
  return {
    inboxBotStatus,
    canCarryReplies: async (workspaceId) => (await inboxBotStatus(workspaceId)).can_reply,
  };
}
