import { classifyUpdate, detectKind, type IgnoreReason } from '../domain/inbound.js';
import type { BotRecord, BotRepo, ConversationsApi, InboundInterceptor } from './ports.js';

/** pino-compatible: the webhook route passes its request logger. */
export interface CaptureLog {
  info(fields: Record<string, unknown>, msg: string): void;
}

export type AcceptOutcome =
  | 'unauthorized'
  | 'captured'
  | 'already_present'
  | 'edited'
  /** A connect-link start or a linked member's message: not a customer message, nothing captured. */
  | 'consumed'
  | `ignored:${IgnoreReason}`;

export interface AcceptUpdateDeps {
  bots: BotRepo;
  conversations: Pick<ConversationsApi, 'captureInbound' | 'applyEdit'>;
  /** Asked before anything is captured (ADR-0003). */
  interceptor: InboundInterceptor;
}

/** A bot whose webhook secret matched: the only way the webhook learns a workspace id. */
export type AuthenticBot = BotRecord & { connectedAt: Date };

export interface AcceptUpdate {
  /**
   * Step 1, before the body is parsed: the bot only when the presented secret matches its stored
   * hash and it has a capture epoch (a disconnected bot keeps no secret). Logs a refusal.
   */
  authenticate(
    botId: string,
    secret: string | undefined,
    log: CaptureLog,
  ): Promise<AuthenticBot | null>;
  /** Step 2: filter the authentic update and hand the message or edit to `conversations`. */
  accept(
    bot: AuthenticBot,
    body: unknown,
    log: CaptureLog,
  ): Promise<Exclude<AcceptOutcome, 'unauthorized'>>;
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

export function createAcceptUpdate({
  bots,
  conversations,
  interceptor,
}: AcceptUpdateDeps): AcceptUpdate {
  const authenticate: AcceptUpdate['authenticate'] = async (botId, secret, log) => {
    // Controlled exception *bot by webhook id*: scoped by possession of the secret.
    const bot = await bots.findByWebhookId(botId, secret);
    if (!bot?.connectedAt) {
      log.info({ botId, outcome: 'unauthorized' }, 'telegram update refused');
      return null;
    }
    return { ...bot, connectedAt: bot.connectedAt };
  };

  const accept: AcceptUpdate['accept'] = async (bot, body, log) => {
    const botId = bot.id;
    const updateId = updateIdOf(body);
    const ids = {
      botId,
      workspaceId: bot.workspaceId,
      ...(updateId !== undefined && { updateId }),
    };
    const decision = classifyUpdate(body, { connectedAt: bot.connectedAt });

    if (decision.type === 'ignore') {
      log.info({ ...ids, outcome: 'ignored', reason: decision.reason }, 'telegram update ignored');
      return `ignored:${decision.reason}`;
    }
    // A connect-link start or a linked member's message is not a customer message (AC-04, AC-11).
    // Logged by outcome only: no sender id, text or token.
    const consumed =
      (await interceptor.intercept({
        workspaceId: bot.workspaceId,
        telegramBotId: bot.telegramBotId,
        from: decision.type === 'edit' ? decision.sender : decision.message.sender,
        kind: decision.type === 'edit' ? detectKind(decision.edit.raw) : decision.message.kind,
        text: decision.type === 'edit' ? decision.edit.body : decision.message.body,
        edited: decision.type === 'edit',
      })) === 'consumed';
    if (consumed) {
      log.info({ ...ids, outcome: 'consumed' }, 'telegram update consumed');
      return 'consumed';
    }
    if (decision.type === 'edit') {
      const result = await conversations.applyEdit(bot.workspaceId, decision.edit);
      log.info({ ...ids, outcome: 'edited', edit: result }, 'telegram edit handled');
      return 'edited';
    }
    const outcome = await conversations.captureInbound(bot.workspaceId, {
      ...decision.message,
      telegramBotId: bot.telegramBotId,
    });
    log.info({ ...ids, outcome }, 'telegram update captured');
    return outcome;
  };

  return {
    authenticate,
    accept,
    async acceptUpdate(botId, secret, body, log) {
      const bot = await authenticate(botId, secret, log);
      return bot ? accept(bot, body, log) : 'unauthorized';
    },
  };
}
