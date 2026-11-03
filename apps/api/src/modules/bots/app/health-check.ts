import type { Clock } from '../../../platform/clock.js';
import {
  HEALTH_CHECK_TIMEOUT,
  type BotRepo,
  type BotSignals,
  type TelegramGateway,
  type Transaction,
  type WebhookSecrets,
} from './ports.js';
import { webhookUrl } from './webhook-url.js';

export interface HealthCheckDeps {
  bots: BotRepo;
  telegram: TelegramGateway;
  clock: Clock;
  transaction: Transaction;
  signals: BotSignals;
  /** The per-bot derived secret, for re-registering an outdated webhook (ADR-0003). */
  secrets: WebhookSecrets;
  /** `TELEGRAM_WEBHOOK_BASE_URL`. */
  webhookBaseUrl: string;
}

export interface DueBot {
  botId: string;
  workspaceId: string;
}

/**
 * `skipped` — gone, disconnected or not this workspace's bot; `transient` — Telegram gave no
 * answer to conclude from, nothing written (the bot stays due); otherwise the state written.
 */
export type CheckOutcome = 'connected' | 'needs_token' | 'taken_over' | 'transient' | 'skipped';

export interface HealthCheck {
  /** The bots due for a check now (the controlled exception *bots due for a health check*). */
  scheduleChecks(): Promise<DueBot[]>;
  /** One bot's check (flow 3, events.md `bots.check-health` outcome table). */
  checkOne(workspaceId: string, botId: string): Promise<CheckOutcome>;
}

export function createHealthCheck({
  bots,
  telegram,
  clock,
  transaction,
  signals,
  secrets,
  webhookBaseUrl,
}: HealthCheckDeps): HealthCheck {
  return {
    scheduleChecks: () => bots.listDueForCheck(clock.now()),

    async checkOne(workspaceId, botId) {
      const found = await bots.findForCheck(workspaceId, botId);
      if (!found) return 'skipped';
      const { token } = found;

      // setState only matches a live row unchanged since it was read: a bot disconnected
      // meanwhile is not resurrected, and an owner action written meanwhile (a new token, a
      // reconnect) is not overwritten by the outcome of the old one.
      const write = async (
        state: 'connected' | 'needs_token' | 'taken_over',
        identity?: { name: string; username: string },
      ): Promise<CheckOutcome> =>
        (await transaction(async (tx) => {
          const written = await bots.setState(
            workspaceId,
            botId,
            state,
            clock.now(),
            { ...(identity && { identity }), ifLastCheckedAt: found.bot.lastCheckedAt },
            tx,
          );
          // A check that finds the same state refreshes the check time only: nothing to tell.
          if (written && state !== found.bot.state) await signals.botChanged(tx, workspaceId);
          return written;
        }))
          ? state
          : 'skipped';

      // The key that encrypted the token is gone (ADR-0006): the owner pastes the token again.
      if (token === null) return write('needs_token');

      const me = await telegram.getMe(token, HEALTH_CHECK_TIMEOUT);
      if (me === 'transient') return 'transient';
      if (me === 'unauthorized') return write('needs_token');

      const url = webhookUrl(webhookBaseUrl, botId);
      const target = await telegram.getWebhook(token, url, HEALTH_CHECK_TIMEOUT);
      const identity = { name: me.name, username: me.username };
      switch (target) {
        case 'transient':
          return 'transient';
        case 'unauthorized':
          return write('needs_token');
        case 'ours':
          return write('connected', identity);
        case 'ours_outdated': {
          // Registered before `my_chat_member` (flow 17): set again with the same URL and secret,
          // keeping pending updates. A failure writes nothing; the next due check tries again.
          const connectedAt = found.bot.connectedAt;
          if (connectedAt === null) return 'skipped';
          const set = await telegram.setWebhook(
            token,
            { url, secret: secrets.secretFor(botId, connectedAt), dropPending: false },
            HEALTH_CHECK_TIMEOUT,
          );
          return set === 'ok' ? write('connected', identity) : 'transient';
        }
        case 'stale':
        case 'foreign':
        case 'none':
          return write('taken_over', identity);
      }
    },
  };
}
