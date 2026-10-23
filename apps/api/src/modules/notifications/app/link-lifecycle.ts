import type { Clock } from '../../../platform/clock.js';
import type { ConnectLinkRepo, Executor, NotificationSignals, TelegramLinkRepo } from './ports.js';

export interface LinkLifecycleDeps {
  links: Pick<TelegramLinkRepo, 'findLiveByAccount' | 'listLiveWithOtherBot' | 'remove'>;
  connectLinks: Pick<ConnectLinkRepo, 'markUnusedReplaced'>;
  signals: NotificationSignals;
  clock: Clock;
}

export interface LinkLifecycle {
  /**
   * Called by `workspaces` inside the deactivation transaction, after the conversations are
   * unassigned (sad.md §8: workspace row -> membership -> conversations -> notifications rows). Removes
   * the member's live link as `deactivated` (Telegram id and name cleared, no answer is sent),
   * replaces their unused connect links, and signals their tabs. Reactivation restores nothing.
   */
  removeLinkOnDeactivation(
    tx: Executor,
    event: { workspaceId: string; accountId: string; at: Date },
  ): Promise<void>;
  /**
   * Called by `bots` inside the connect transaction, after the bot row is written: removes every live
   * link made with another Telegram bot as `bot_replaced`, one signal per account. A rotation keeps the
   * bot id, so it keeps every link. Sends no answer.
   */
  onBotConnected(
    tx: Executor,
    event: { workspaceId: string; telegramBotId: bigint },
  ): Promise<void>;
}

export function createLinkLifecycle(deps: LinkLifecycleDeps): LinkLifecycle {
  const { links, connectLinks, signals, clock } = deps;
  return {
    async removeLinkOnDeactivation(tx, { workspaceId, accountId, at }) {
      await connectLinks.markUnusedReplaced(workspaceId, accountId, at, tx);
      // `FOR UPDATE`: a Disconnect or a ping send holding the row finishes first.
      const link = await links.findLiveByAccount(workspaceId, accountId, { lock: true }, tx);
      if (!link) return;
      if (await links.remove(workspaceId, link.id, 'deactivated', at, tx)) {
        await signals.telegramLinkChanged(tx, workspaceId, accountId);
      }
    },

    async onBotConnected(tx, { workspaceId, telegramBotId }) {
      const stale = await links.listLiveWithOtherBot(workspaceId, telegramBotId, tx);
      const at = clock.now();
      for (const link of stale) {
        if (await links.remove(workspaceId, link.id, 'bot_replaced', at, tx)) {
          await signals.telegramLinkChanged(tx, workspaceId, link.accountId);
        }
      }
    },
  };
}
