import type { BroadcastLogger, BroadcastRepo, ContactsApi, RecipientRepo } from './ports.js';

export interface MeasureBlockedShareDeps {
  broadcasts: Pick<BroadcastRepo, 'find'>;
  recipients: Pick<RecipientRepo, 'deliveredContactIds'>;
  contacts: Pick<ContactsApi, 'audienceBreakdown'>;
  logger: BroadcastLogger;
}

export interface BlockedShare {
  deliveredCount: number;
  blockedSinceCount: number;
  share: number;
}

export interface MeasureBlockedShare {
  /**
   * The 48-hour blocked share (spec §7, events.md `broadcast.blocked_share`): of the broadcast's
   * delivered recipients, how many have blocked the launch Telegram bot now. One log line with ids
   * and counts only; null (nothing logged) for a broadcast of another workspace, an unknown id or
   * one never launched.
   */
  measureBlockedShare(workspaceId: string, broadcastId: string): Promise<BlockedShare | null>;
}

export function createMeasureBlockedShare(deps: MeasureBlockedShareDeps): MeasureBlockedShare {
  const { broadcasts, recipients, contacts, logger } = deps;
  return {
    async measureBlockedShare(workspaceId, broadcastId) {
      const row = await broadcasts.find(workspaceId, broadcastId);
      if (!row || row.launchTelegramBotId === null) return null;
      const delivered = await recipients.deliveredContactIds(workspaceId, broadcastId);
      let blocked = 0;
      if (delivered.length > 0) {
        const breakdown = await contacts.audienceBreakdown(
          workspaceId,
          { kind: 'ids', contactIds: delivered },
          row.launchTelegramBotId,
        );
        blocked = breakdown.reach?.blocked ?? 0;
      }
      const result: BlockedShare = {
        deliveredCount: delivered.length,
        blockedSinceCount: blocked,
        share: delivered.length === 0 ? 0 : blocked / delivered.length,
      };
      logger.info(
        {
          workspace_id: workspaceId,
          broadcast_id: broadcastId,
          delivered_count: result.deliveredCount,
          blocked_since_count: result.blockedSinceCount,
          share: result.share,
        },
        'broadcast.blocked_share',
      );
      return result;
    },
  };
}
