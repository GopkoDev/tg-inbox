import type { Db } from '../../../platform/db.js';
import type { BotState } from '../domain/connection.js';
import type { NormalisedEdit, NormalisedMessage } from '../domain/inbound.js';

/** A Kysely handle or a transaction. */
export type Executor = Db;

export type LiveBotState = Exclude<BotState, 'disconnected'>;

/** A bot row as the app layer sees it — never the token or the webhook secret. */
export interface BotRecord {
  id: string;
  workspaceId: string;
  telegramBotId: bigint;
  name: string;
  username: string;
  state: BotState;
  /** The capture epoch; null only when disconnected. */
  connectedAt: Date | null;
  /** The last Bot API exchange that had an outcome; null only when disconnected. */
  lastCheckedAt: Date | null;
  createdAt: Date;
}

export interface NewBot {
  id: string;
  telegramBotId: bigint;
  name: string;
  username: string;
  state: LiveBotState;
  /** Plain token: encrypted by the repository, never stored or logged as is. */
  token: string;
  /** Plain webhook secret: only its SHA-256 hash is stored. */
  webhookSecret: string;
  connectedAt: Date;
  lastCheckedAt: Date;
  createdAt: Date;
}

export type BotPatch = Partial<
  Pick<
    NewBot,
    'name' | 'username' | 'state' | 'token' | 'webhookSecret' | 'connectedAt' | 'lastCheckedAt'
  >
>;

export type BotWriteResult =
  | { ok: true }
  /** `bots_telegram_bot_id_key`: the bot belongs to another workspace (AC-04). */
  | { ok: false; reason: 'bound_elsewhere' }
  /** `bots_workspace_id_key`: a concurrent paste inserted this workspace's bot first. */
  | { ok: false; reason: 'workspace_has_bot' }
  | { ok: false; reason: 'not_found' };

export interface BotRepo {
  findByWorkspace(workspaceId: string, tx?: Executor): Promise<BotRecord | null>;
  /** A second bot of the workspace still rejects (`bots_workspace_id_key`, the AC-05 backstop). */
  insert(workspaceId: string, bot: NewBot, tx?: Executor): Promise<BotWriteResult>;
  /**
   * `ifRead`: write only when the row is still what the caller decided on — `'disconnected'`, or
   * live with this capture epoch; otherwise `not_found` (a concurrent paste or disconnect won).
   */
  update(
    workspaceId: string,
    botId: string,
    patch: BotPatch,
    tx?: Executor,
    ifRead?: 'disconnected' | { connectedAt: Date },
  ): Promise<BotWriteResult>;
  /**
   * Records the outcome of a Bot API exchange on a live bot; false when no live row matched.
   * `ifLastCheckedAt`: write only when the row is unchanged since it was read (the health check
   * never overwrites an owner action that wrote in between).
   */
  setState(
    workspaceId: string,
    botId: string,
    state: LiveBotState,
    checkedAt: Date,
    options?: { identity?: { name: string; username: string }; ifLastCheckedAt?: Date | null },
    tx?: Executor,
  ): Promise<boolean>;
  /** Keeps the row (and so the binding) without token, secret hash and capture epoch (AC-18). */
  clearOnDisconnect(workspaceId: string, botId: string, tx?: Executor): Promise<boolean>;
  delete(workspaceId: string, botId: string, tx?: Executor): Promise<boolean>;
  /**
   * A live bot with its decrypted token, for a Bot API call right after. `token` is null when the
   * stored token cannot be decrypted (the key was lost or changed, ADR-0006): the bot then needs
   * a new token.
   */
  findForCheck(
    workspaceId: string,
    botId: string,
    tx?: Executor,
  ): Promise<{ bot: BotRecord; token: string | null } | null>;

  // Controlled exceptions to the tenancy rule (sad.md §5): they produce the workspace id.
  /** Scoped by possession of the webhook secret: the bot only when its hash matches. */
  findByWebhookId(botId: string, secret: string | undefined): Promise<BotRecord | null>;
  /** Connected or taken-over bots last checked at least 3 minutes before `now` (the scheduler). */
  listDueForCheck(now: Date): Promise<{ botId: string; workspaceId: string }[]>;
}

export interface TokenCipher {
  encrypt(token: string): Buffer;
  decrypt(blob: Buffer): string;
}

export interface WebhookSecrets {
  /** The bot's webhook secret for a capture epoch (stable across rotation and reconnect). */
  secretFor(botId: string, connectedAt: Date): string;
}

/** Per-call Bot API timeout on owner actions, so connect / rotate / disconnect stay within 3 s. */
export const OWNER_ACTION_TIMEOUT = 1000;
/** Per-call Bot API timeout in the scheduled health check. */
export const HEALTH_CHECK_TIMEOUT = 10_000;

/**
 * Typed outcomes of a Bot API call: `unauthorized` — Telegram rejects the token (revoked,
 * deleted); `transient` — network, timeout, 5xx or rate limit, nothing to conclude.
 */
export type GetMeResult =
  | { ok: true; telegramBotId: bigint; name: string; username: string }
  | 'unauthorized'
  | 'transient';

/**
 * Where the bot delivers: our webhook URL, another service's, or none (polling is invisible).
 * `stale`: tg-inbox's own webhook path for another bot row id — left by a first connect whose
 * setWebhook reached Telegram after we gave up; not another service, so no takeover warning.
 */
export type WebhookTarget = 'ours' | 'stale' | 'foreign' | 'none' | 'unauthorized' | 'transient';

export interface TelegramGateway {
  getMe(token: string, timeoutMs: number): Promise<GetMeResult>;
  getWebhook(token: string, ourUrl: string, timeoutMs: number): Promise<WebhookTarget>;
  /** Always `allowed_updates: message, edited_message` and the configured `max_connections`. */
  setWebhook(
    token: string,
    webhook: { url: string; secret: string; dropPending: boolean },
    timeoutMs: number,
  ): Promise<'ok' | 'failed'>;
  /** Always drops pending updates. */
  deleteWebhook(token: string, timeoutMs: number): Promise<'ok' | 'failed'>;
}

/** Runs `fn` in one database transaction; a throw rolls it back. No Telegram call runs inside. */
export type Transaction = <T>(fn: (tx: Executor) => Promise<T>) => Promise<T>;

/** What `bots` calls on the conversations app layer (sad.md §5, cross-module app-layer calls). */
export interface ConversationsApi {
  /** Contact, conversation and message in one transaction; a redelivery is `already_present`. */
  captureInbound(
    workspaceId: string,
    message: NormalisedMessage,
  ): Promise<'captured' | 'already_present'>;
  /** Replaces the text only when the edit is later; nothing for an uncaptured message (AC-10). */
  applyEdit(
    workspaceId: string,
    edit: NormalisedEdit,
  ): Promise<'applied' | 'not_later' | 'not_found'>;
  lastMessageReceivedAt(workspaceId: string): Promise<Date | null>;
  hasConversations(workspaceId: string): Promise<boolean>;
}

/** What `bots` calls on the contacts app layer. */
export interface ContactsApi {
  countContacts(workspaceId: string): Promise<number>;
}
