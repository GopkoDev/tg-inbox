import type { BotSettings } from '@tg/shared';
import type { Clock } from '../../../platform/clock.js';
import {
  BotBelongsToAnotherWorkspaceError,
  BotTokenInvalidError,
  TakeoverConfirmationRequiredError,
  TelegramUnavailableError,
  WorkspaceKeepsOneBotError,
} from '../../../platform/errors.js';
import { newId as defaultNewId } from '../../../platform/ids.js';
import { decidePaste } from '../domain/connection.js';
import { parseBotToken } from '../domain/token.js';
import {
  OWNER_ACTION_TIMEOUT,
  type BotRecord,
  type BotRepo,
  type ConversationsApi,
  type LiveRowGuard,
  type TelegramGateway,
  type Transaction,
  type WebhookSecrets,
} from './ports.js';
import type { BotSettingsReader } from './settings.js';
import { webhookUrl } from './webhook-url.js';

export interface PasteTokenDeps {
  bots: BotRepo;
  conversations: Pick<ConversationsApi, 'hasConversations'>;
  telegram: TelegramGateway;
  secrets: WebhookSecrets;
  clock: Clock;
  transaction: Transaction;
  settings: BotSettingsReader;
  /** `TELEGRAM_WEBHOOK_BASE_URL`. */
  webhookBaseUrl: string;
  newId?: () => string;
}

export interface PasteToken {
  /**
   * Flows 1 and 5: connect, connect again or rotate, deciding refusals in the contract's order —
   * token form, Telegram rejects it, a different bot, bound to another workspace, takeover
   * confirmation. Any refusal changes nothing — apart from finishing a disconnect that was cut
   * short (a disconnected row with no conversation is deleted before deciding).
   */
  pasteToken(workspaceId: string, raw: string, confirmTakeover: boolean): Promise<BotSettings>;
}

/** The workspace's row changed between the read and the write (a concurrent paste/disconnect). */
class RowChanged extends Error {}

export function createPasteToken(deps: PasteTokenDeps): PasteToken {
  const { bots, conversations, telegram, secrets, clock, transaction, settings, webhookBaseUrl } =
    deps;
  const newId = deps.newId ?? defaultNewId;

  return {
    async pasteToken(workspaceId, raw, confirmTakeover) {
      const parsed = parseBotToken(raw);
      if (!parsed.valid) throw new BotTokenInvalidError();
      const { token } = parsed;

      const me = await telegram.getMe(token, OWNER_ACTION_TIMEOUT);
      if (me === 'unauthorized') throw new BotTokenInvalidError();
      if (me === 'transient') throw new TelegramUnavailableError();
      const identity = { name: me.name, username: me.username };

      // A concurrent paste or disconnect of this workspace can change its row between the read
      // and the write (a double click, two owners): the write then rolls back and the decision
      // is taken once more on the row as it is now.
      for (let attempt = 1; ; attempt++) {
        try {
          await connect(workspaceId, token, me.telegramBotId, identity, confirmTakeover);
          break;
        } catch (err) {
          if (!(err instanceof RowChanged)) throw err;
          // Still changing under us: a transient conflict — the owner tries again (never a 500).
          if (attempt === 2) throw new TelegramUnavailableError();
        }
      }
      return settings.getSettings(workspaceId);
    },
  };

  async function connect(
    workspaceId: string,
    token: string,
    telegramBotId: bigint,
    identity: { name: string; username: string },
    confirmTakeover: boolean,
  ) {
    let row = await bots.findByWorkspace(workspaceId);
    // A disconnected row is kept only because customers wrote through the bot (AC-05). One with
    // no conversation is what a disconnect cut short between its clear and its delete leaves:
    // finish that delete instead of binding the workspace to a bot nobody wrote to.
    if (row?.state === 'disconnected' && !(await conversations.hasConversations(workspaceId))) {
      await bots.delete(workspaceId, row.id);
      row = null;
    }
    const decision = decidePaste(row, telegramBotId);
    if (decision.action === 'refuse') throw new WorkspaceKeepsOneBotError(decision.reason);

    const botId = row?.id ?? newId();
    const url = webhookUrl(webhookBaseUrl, botId);
    const target = await telegram.getWebhook(token, url, OWNER_ACTION_TIMEOUT);
    if (target === 'transient') throw new TelegramUnavailableError();
    if (target === 'unauthorized') throw new BotTokenInvalidError();

    const now = clock.now();
    // Rotation keeps the capture epoch, so the derived secret is the one already registered.
    const connectedAt = decision.action === 'rotate' && row?.connectedAt ? row.connectedAt : now;
    const secret = secrets.secretFor(botId, connectedAt);
    // What a failed setWebhook restores: the old token is read before it is replaced. A token
    // the current key cannot decrypt (ADR-0006) has nothing to restore, and the registered
    // secret was derived under the old key, so the secret hash is written again.
    const previous =
      decision.action === 'rotate' ? await bots.findForCheck(workspaceId, botId) : null;
    const rederive = decision.action === 'connectAgain' || previous?.token === null;

    // The row write runs first, so an ownership conflict wins over a takeover confirmation;
    // both refusals roll the write back. No Telegram call runs inside the transaction.
    await transaction(async (tx) => {
      const written =
        decision.action === 'connect'
          ? await bots.insert(
              workspaceId,
              {
                id: botId,
                telegramBotId,
                ...identity,
                state: 'connected',
                token,
                webhookSecret: secret,
                connectedAt: now,
                lastCheckedAt: now,
                createdAt: now,
              },
              tx,
            )
          : await bots.update(
              workspaceId,
              botId,
              {
                ...identity,
                state: 'connected',
                token,
                lastCheckedAt: now,
                ...(rederive && { webhookSecret: secret }),
                ...(decision.action === 'connectAgain' && { connectedAt: now }),
              },
              tx,
              // Only the row this decision was taken on: a concurrent connect-again or a
              // disconnect in between makes it `not_found`, and the paste decides again.
              decision.action === 'connectAgain'
                ? 'disconnected'
                : { connectedAt: row?.connectedAt ?? now },
            );
      if (!written.ok) {
        if (written.reason === 'bound_elsewhere') throw new BotBelongsToAnotherWorkspaceError();
        throw new RowChanged();
      }
      if (target === 'foreign' && !confirmTakeover) {
        throw new TakeoverConfirmationRequiredError(identity);
      }
    });

    const set = await telegram.setWebhook(
      token,
      { url, secret, dropPending: decision.action !== 'rotate' },
      OWNER_ACTION_TIMEOUT,
    );
    if (set === 'failed') {
      // The undo touches the row only while it is still what this paste wrote: a disconnect or
      // another paste that changed it since keeps its own state.
      const written = {
        connectedAt: decision.action === 'rotate' ? connectedAt : now,
        lastCheckedAt: now,
      };
      await restore(workspaceId, botId, decision.action, row, previous, written);
      throw new TelegramUnavailableError();
    }
  }

  async function restore(
    workspaceId: string,
    botId: string,
    action: 'connect' | 'connectAgain' | 'rotate',
    row: BotRecord | null,
    previous: { bot: BotRecord; token: string | null } | null,
    written: LiveRowGuard,
  ) {
    if (action === 'connect') {
      await bots.delete(workspaceId, botId, undefined, written);
      return;
    }
    if (!row) return;
    await transaction(async (tx) => {
      if (action === 'connectAgain') {
        if (!(await bots.clearOnDisconnect(workspaceId, botId, tx, written))) return;
      }
      await bots.update(
        workspaceId,
        botId,
        {
          name: row.name,
          username: row.username,
          ...(row.lastCheckedAt && { lastCheckedAt: row.lastCheckedAt }),
          ...(action === 'rotate' &&
            previous &&
            row.state !== 'disconnected' &&
            // An undecryptable old token cannot be put back: the bot still needs a new one.
            (previous.token === null
              ? { state: 'needs_token' as const }
              : { token: previous.token, state: row.state })),
        },
        tx,
        action === 'connectAgain' ? 'disconnected' : written,
      );
    });
  }
}
