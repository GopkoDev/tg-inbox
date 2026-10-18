import type { BotSettings } from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import {
  BotNeedsNewTokenError,
  NothingToReconnectError,
  TakeoverConfirmationRequiredError,
  TelegramUnavailableError,
} from '../../../platform/errors.js';
import {
  OWNER_ACTION_TIMEOUT,
  type BotRepo,
  type BotSignals,
  type TelegramGateway,
  type Transaction,
  type WebhookSecrets,
} from './ports.js';
import type { BotSettingsReader } from './settings.js';
import { webhookUrl } from './webhook-url.js';

export interface ReconnectDeps {
  bots: BotRepo;
  telegram: TelegramGateway;
  secrets: WebhookSecrets;
  clock: Clock;
  settings: BotSettingsReader;
  transaction: Transaction;
  signals: BotSignals;
  /** `TELEGRAM_WEBHOOK_BASE_URL`. */
  webhookBaseUrl: string;
}

export interface Reconnect {
  /**
   * Flow 6 (AC-16b): take a taken-over bot's messages back with the stored token. The token,
   * secret and capture epoch do not change, so the row is written only after setWebhook succeeds.
   */
  reconnect(workspaceId: string, confirmTakeover: boolean): Promise<BotSettings>;
}

export function createReconnect(deps: ReconnectDeps): Reconnect {
  const { bots, telegram, secrets, clock, settings, transaction, signals, webhookBaseUrl } = deps;

  // The state write and its `bot.changed` signal commit together.
  const writeState = (
    workspaceId: string,
    botId: string,
    state: 'connected' | 'needs_token',
    options?: { identity: { name: string; username: string } },
  ) =>
    transaction(async (tx) => {
      if (await bots.setState(workspaceId, botId, state, clock.now(), options, tx)) {
        await signals.botChanged(tx, workspaceId);
      }
    });

  return {
    async reconnect(workspaceId, confirmTakeover) {
      const row = await bots.findByWorkspace(workspaceId);
      const found =
        row?.state === 'taken_over' ? await bots.findForCheck(workspaceId, row.id) : null;
      if (!found?.bot.connectedAt) {
        throw new NothingToReconnectError(await settings.getSettings(workspaceId));
      }
      const { bot, token } = found;
      const connectedAt = found.bot.connectedAt;

      // A rejected stored token is an outcome: written at once (ADR-0008, AC-15).
      const needsToken = async () => {
        await writeState(workspaceId, bot.id, 'needs_token');
        return new BotNeedsNewTokenError(await settings.getSettings(workspaceId));
      };

      // A stored token the current key cannot decrypt is as good as a revoked one (ADR-0006).
      if (token === null) throw await needsToken();
      const me = await telegram.getMe(token, OWNER_ACTION_TIMEOUT);
      if (me === 'unauthorized') throw await needsToken();
      if (me === 'transient') throw new TelegramUnavailableError();
      const identity = { name: me.name, username: me.username };

      const url = webhookUrl(webhookBaseUrl, bot.id);
      const target = await telegram.getWebhook(token, url, OWNER_ACTION_TIMEOUT);
      if (target === 'unauthorized') throw await needsToken();
      if (target === 'transient') throw new TelegramUnavailableError();
      if (target === 'foreign' && !confirmTakeover) {
        throw new TakeoverConfirmationRequiredError(identity);
      }

      const set = await telegram.setWebhook(
        token,
        { url, secret: secrets.secretFor(bot.id, connectedAt), dropPending: false },
        OWNER_ACTION_TIMEOUT,
      );
      if (set === 'failed') throw new TelegramUnavailableError();

      await writeState(workspaceId, bot.id, 'connected', { identity });
      return settings.getSettings(workspaceId);
    },
  };
}
