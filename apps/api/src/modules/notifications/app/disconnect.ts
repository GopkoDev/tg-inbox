import type { NotificationSettings } from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import type {
  EnqueueBotMessage,
  NotificationSignals,
  TelegramLinkRepo,
  Transaction,
} from './ports.js';
import type { Settings, SettingsInput } from './settings.js';

export interface DisconnectTelegramDeps {
  transaction: Transaction;
  links: Pick<TelegramLinkRepo, 'findLiveByAccount' | 'remove'>;
  signals: NotificationSignals;
  enqueue: EnqueueBotMessage;
  settings: Settings;
  clock: Clock;
}

export interface DisconnectTelegram {
  disconnectTelegram(input: SettingsInput): Promise<NotificationSettings>;
}

/**
 * The member removes their own link (flow 9). Locks only the link row (`FOR UPDATE`), which is
 * the last lock of the order workspace -> membership -> conversations -> link. Disconnecting a link
 * that is already gone succeeds and changes nothing: no signal, no job.
 */
export function createDisconnectTelegram(deps: DisconnectTelegramDeps): DisconnectTelegram {
  const { transaction, links, signals, enqueue, settings, clock } = deps;
  return {
    disconnectTelegram(input) {
      const { workspaceId, accountId } = input;
      return transaction(async (tx) => {
        const link = await links.findLiveByAccount(workspaceId, accountId, { lock: true }, tx);
        if (link && (await links.remove(workspaceId, link.id, 'member', clock.now(), tx))) {
          await signals.telegramLinkChanged(tx, workspaceId, accountId);
          await enqueue(tx, workspaceId, { kind: 'notifications_off', telegramLinkId: link.id });
        }
        return settings.mySettings(input, tx);
      });
    },
  };
}
