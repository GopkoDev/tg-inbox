import type { Clock } from '../../../platform/clock.js';
import { HEALTH_CHECK_TIMEOUT, type BotRepo, type TelegramGateway } from './ports.js';
import { webhookUrl } from './webhook-url.js';

export interface HealthCheckDeps {
  bots: BotRepo;
  telegram: TelegramGateway;
  clock: Clock;
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
  webhookBaseUrl,
}: HealthCheckDeps): HealthCheck {
  return {
    scheduleChecks: () => bots.listDueForCheck(clock.now()),

    async checkOne(workspaceId, botId) {
      const found = await bots.findForCheck(workspaceId, botId);
      if (!found) return 'skipped';
      const { token } = found;

      // setState only matches a live row, so a bot disconnected meanwhile is not resurrected.
      const write = async (
        state: 'connected' | 'needs_token' | 'taken_over',
        identity?: { name: string; username: string },
      ): Promise<CheckOutcome> =>
        (await bots.setState(workspaceId, botId, state, clock.now(), identity)) ? state : 'skipped';

      const me = await telegram.getMe(token, HEALTH_CHECK_TIMEOUT);
      if (me === 'transient') return 'transient';
      if (me === 'unauthorized') return write('needs_token');

      const target = await telegram.getWebhook(
        token,
        webhookUrl(webhookBaseUrl, botId),
        HEALTH_CHECK_TIMEOUT,
      );
      const identity = { name: me.name, username: me.username };
      switch (target) {
        case 'transient':
          return 'transient';
        case 'unauthorized':
          return write('needs_token');
        case 'ours':
          return write('connected', identity);
        case 'foreign':
        case 'none':
          return write('taken_over', identity);
      }
    },
  };
}
