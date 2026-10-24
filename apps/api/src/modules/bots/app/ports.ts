import type { Readable } from 'node:stream';
import type { Db } from '../../../platform/db.js';
import type { BotState } from '../domain/connection.js';
import type {
  InboundKind,
  NormalisedEdit,
  NormalisedMessage,
  SenderProfile,
} from '../domain/inbound.js';

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
  /** Bot sends to members are refused until then (ADR-0006); null or past: not paused. */
  sendPausedUntil: Date | null;
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

/**
 * A live row as one writer left it: its capture epoch and, optionally, the check time it wrote.
 * Conditional writes keyed on it touch the row only if no other writer changed it since.
 */
export interface LiveRowGuard {
  connectedAt: Date;
  lastCheckedAt?: Date;
}

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
    ifRead?: 'disconnected' | LiveRowGuard,
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
  /**
   * Keeps the row (and so the binding) without token, secret hash and capture epoch (AC-18).
   * `ifWritten`: only while the row is still the live one this caller wrote (an undo).
   */
  clearOnDisconnect(
    workspaceId: string,
    botId: string,
    tx?: Executor,
    ifWritten?: LiveRowGuard,
  ): Promise<boolean>;
  /** `ifWritten`: only while the row is still the live one this caller wrote (an undo). */
  delete(
    workspaceId: string,
    botId: string,
    tx?: Executor,
    ifWritten?: LiveRowGuard,
  ): Promise<boolean>;
  /**
   * Stores `send_paused_until = max(stored, until)` after a Telegram 429 on this bot (a reply or a
   * member message); false when the bot is not in the workspace.
   */
  pauseSends(workspaceId: string, botId: string, until: Date, tx?: Executor): Promise<boolean>;
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

/** Per-call timeout of `sendMessage` (sad.md §8): past it the answer is `unknown`. */
export const SEND_TIMEOUT = 10_000;

/**
 * The answer to sending a reply, classified. Structurally identical to inbox's `GatewayOutcome`
 * (`bots` must not import `inbox`); `send-text.test.ts` pins that at the type level.
 */
export type SendOutcome =
  | { outcome: 'accepted'; messageId: bigint; at: Date }
  | { outcome: 'refused'; reason: 'blocked' | 'account_gone' | 'chat_not_found' }
  | { outcome: 'bot_unauthorized' }
  | { outcome: 'not_accepted'; retryAfterMs?: number }
  | { outcome: 'unknown' };

/**
 * The answer to a message to a member (a ping or a bot answer). `rate_limited`: the bot is paused
 * until `retryAfter`; `blocked`: the member cannot receive it (blocked the bot, or the account is
 * gone); `transient`: Telegram definitely did not take it (an error answer, or the request was never
 * written), safe to retry; `unknown`: a timeout or a connection lost after the request was written,
 * so it may have been delivered and must not be retried.
 */
export type MemberMessageOutcome =
  | { outcome: 'accepted' }
  | { outcome: 'blocked' }
  | { outcome: 'rate_limited'; retryAfter: Date }
  | { outcome: 'bot_unavailable' }
  | { outcome: 'transient' }
  | { outcome: 'unknown' };

/** `getFile` timeout (sad.md §8). */
export const GET_FILE_TIMEOUT = 5000;
/** A media download is aborted after this long without a byte (sad.md §8). */
export const DOWNLOAD_IDLE_TIMEOUT = 30_000;
/** The largest file a bot can download (20 MiB). */
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/**
 * The answer to fetching a customer's file, classified. No token or Telegram address in any
 * variant. `unavailable`: 5xx, 429, timeout or network failure.
 */
export type FileFetch =
  | {
      outcome: 'stream';
      body: Readable;
      status: 200 | 206;
      contentLength: number | null;
      contentRange?: string;
    }
  | { outcome: 'too_large' }
  | { outcome: 'gone' }
  | { outcome: 'unauthorized' }
  | { outcome: 'unavailable' }
  | { outcome: 'range_not_satisfiable' };

export interface TelegramGateway {
  /**
   * `getFile` (path cached in memory per file, under its one-hour validity) then a streamed
   * download of it, forwarding a single `Range`. Never throws; the download URL stays inside.
   */
  openFile(token: string, fileReference: string, range: string | undefined): Promise<FileFetch>;
  /**
   * Plain text (no `parse_mode`). Never throws: every answer, a timeout included, is an outcome.
   * A call that may have been written is never repeated here.
   */
  sendText(
    token: string,
    chatId: bigint,
    text: string,
    timeoutMs: number,
    options?: { disableLinkPreview?: boolean },
  ): Promise<SendOutcome>;
  getMe(token: string, timeoutMs: number): Promise<GetMeResult>;
  getWebhook(token: string, ourUrl: string, timeoutMs: number): Promise<WebhookTarget>;
  /**
   * Always `allowed_updates: message, edited_message, my_chat_member` (ADR-0003) and the configured
   * `max_connections`.
   */
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

/**
 * Tells every open inbox of the workspace that its bot changed (`bot.changed`). It runs in the
 * transaction of the state write, so the signal is delivered only if that write commits.
 */
export interface BotSignals {
  botChanged(tx: Executor, workspaceId: string): Promise<void>;
}

/** What `bots` calls on the conversations app layer (sad.md §5, cross-module app-layer calls). */
export interface ConversationsApi {
  /**
   * Contact (with its "wrote" mark for the receiving Telegram bot), conversation and message in
   * one transaction; a redelivery is `already_present`.
   */
  captureInbound(
    workspaceId: string,
    message: NormalisedMessage & { telegramBotId: bigint },
  ): Promise<'captured' | 'already_present'>;
  /** Replaces the text only when the edit is later; nothing for an uncaptured message (AC-10). */
  applyEdit(
    workspaceId: string,
    edit: NormalisedEdit,
  ): Promise<'applied' | 'not_later' | 'not_found'>;
  lastMessageReceivedAt(workspaceId: string): Promise<Date | null>;
  hasConversations(workspaceId: string): Promise<boolean>;
}

/** One private message or edit from a human sender, as the interceptor sees it. No content beyond the text. */
export interface InterceptInput {
  workspaceId: string;
  /** The Telegram id of the bot the update came to. */
  telegramBotId: bigint;
  from: SenderProfile;
  kind: InboundKind;
  /** The text, or the caption of any other kind; null when there is neither. */
  text: string | null;
  /** The update is an edit of an earlier message. */
  edited: boolean;
}

/**
 * Asked for every private human message or edit before it is captured (ADR-0003). `consumed`: the
 * update is not a customer message and nothing of it is captured. Implemented by `notifications` and
 * passed in by the composition root. A failure propagates: nothing is captured and Telegram redelivers.
 */
export interface InboundInterceptor {
  intercept(input: InterceptInput): Promise<'pass' | 'consumed'>;
}

/**
 * Called inside the paste-token connect transaction once the bot row is written (and a takeover is
 * confirmed): `notifications` removes the live links made with another Telegram bot. A rotation
 * passes the same bot id. A failure rolls the connect back.
 */
export type BotConnectedHook = (
  tx: Executor,
  event: { workspaceId: string; telegramBotId: bigint },
) => Promise<void>;

/** What `bots` calls on the contacts app layer. */
export interface ContactsApi {
  countContacts(workspaceId: string): Promise<number>;
}

/**
 * The contacts reach write `bots` calls when it learns a block (ADR-0003): a `my_chat_member`
 * update (Telegram's time) or a send refused as blocked (our clock). A Telegram user who is not a
 * contact is a no-op in `contacts`. Passed in by the composition root.
 */
export interface ContactsReach {
  recordBlockChange(
    workspaceId: string,
    telegramBotId: bigint,
    telegramUserId: bigint,
    blocked: boolean,
    at: Date,
  ): Promise<unknown>;
}
