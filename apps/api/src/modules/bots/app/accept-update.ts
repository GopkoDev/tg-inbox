import { classifyUpdate, type IgnoreReason } from '../domain/inbound.js';
import type { BotRepo, ConversationsApi } from './ports.js';

/** pino-compatible: the webhook route passes its request logger. */
export interface CaptureLog {
  info(fields: Record<string, unknown>, msg: string): void;
}

export type AcceptOutcome =
  'unauthorized' | 'captured' | 'already_present' | 'edited' | `ignored:${IgnoreReason}`;

export interface AcceptUpdateDeps {
  bots: BotRepo;
  conversations: Pick<ConversationsApi, 'captureInbound' | 'applyEdit'>;
}

export interface AcceptUpdate {
  /**
   * Flow 2 / flow 8: authenticate by the per-bot secret, filter, then hand the message or edit to
   * `conversations`. Logs carry bot id, workspace id, update id and the outcome — never the token,
   * the secret or message content. Database errors propagate so Telegram redelivers.
   */
  acceptUpdate(
    botId: string,
    secret: string | undefined,
    body: unknown,
    log: CaptureLog,
  ): Promise<AcceptOutcome>;
}

function updateIdOf(body: unknown): number | undefined {
  const id = (body as { update_id?: unknown } | null)?.update_id;
  return typeof id === 'number' && Number.isSafeInteger(id) ? id : undefined;
}

export function createAcceptUpdate({ bots, conversations }: AcceptUpdateDeps): AcceptUpdate {
  return {
    async acceptUpdate(botId, secret, body, log) {
      // Controlled exception *bot by webhook id*: scoped by possession of the secret.
      const bot = await bots.findByWebhookId(botId, secret);
      if (!bot?.connectedAt) {
        log.info({ botId, outcome: 'unauthorized' }, 'telegram update refused');
        return 'unauthorized';
      }

      const updateId = updateIdOf(body);
      const ids = {
        botId,
        workspaceId: bot.workspaceId,
        ...(updateId !== undefined && { updateId }),
      };
      const decision = classifyUpdate(body, { connectedAt: bot.connectedAt });

      if (decision.type === 'ignore') {
        log.info(
          { ...ids, outcome: 'ignored', reason: decision.reason },
          'telegram update ignored',
        );
        return `ignored:${decision.reason}`;
      }
      if (decision.type === 'edit') {
        const result = await conversations.applyEdit(bot.workspaceId, decision.edit);
        log.info({ ...ids, outcome: 'edited', edit: result }, 'telegram edit handled');
        return 'edited';
      }
      const outcome = await conversations.captureInbound(bot.workspaceId, decision.message);
      log.info({ ...ids, outcome }, 'telegram update captured');
      return outcome;
    },
  };
}
