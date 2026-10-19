import type { InboxBotStatus } from '@tg/shared';
import type { Db } from '../../../platform/db.js';
import type { PresenceLease } from '../domain/presence.js';

/** A Kysely handle or a transaction. */
export type Executor = Db;

export type LinkRemovalReason = 'member' | 'deactivated' | 'bot_replaced';

/** A member's Telegram link (telegram_links row), live while `removedAt` is null. */
export interface TelegramLink {
  id: string;
  workspaceId: string;
  accountId: string;
  /** The bot the link was made with. */
  telegramBotId: bigint;
  /** Null once removed, except a member removal, which keeps it until the answer job cleared it. */
  telegramUserId: bigint | null;
  /** Shown only to that member; null once removed. */
  displayName: string | null;
  linkedAt: Date;
  /** Set when a ping was answered 403; null when reachable. */
  blockedAt: Date | null;
  lastNoticeAt: Date | null;
  removedAt: Date | null;
  removedReason: LinkRemovalReason | null;
}

export interface NewTelegramLink {
  id: string;
  accountId: string;
  telegramBotId: bigint;
  telegramUserId: bigint;
  displayName: string;
  linkedAt: Date;
}

export type TelegramLinkInsert =
  | { ok: true }
  /** `telegram_links_live_workspace_id_account_id_key`: the member already has a live link. */
  | { ok: false; reason: 'account_linked' }
  /** `telegram_links_live_workspace_id_telegram_user_id_key`: that Telegram account is linked to a member. */
  | { ok: false; reason: 'telegram_user_linked' };

export interface TelegramLinkRepo {
  /**
   * `lock: true`: `FOR UPDATE` on the live row; `'share'`: `FOR SHARE` (a ping send, so a Disconnect
   * waits for it); both for the rest of the transaction `tx`.
   */
  findLiveByAccount(
    workspaceId: string,
    accountId: string,
    options?: { lock?: boolean | 'share' },
    tx?: Executor,
  ): Promise<TelegramLink | null>;
  findLiveByTelegramUser(
    workspaceId: string,
    telegramUserId: bigint,
    tx?: Executor,
  ): Promise<TelegramLink | null>;
  /** Live or removed: the answer job's lookup by id. */
  findById(workspaceId: string, linkId: string, tx?: Executor): Promise<TelegramLink | null>;
  listLive(workspaceId: string, tx?: Executor): Promise<TelegramLink[]>;
  insert(workspaceId: string, link: NewTelegramLink, tx?: Executor): Promise<TelegramLinkInsert>;
  /**
   * Removes a live link: sets `removed_at` / `removed_reason`, clears the display name and, except for
   * a member removal, the Telegram user id. False when no live link of the workspace matched.
   */
  remove(
    workspaceId: string,
    linkId: string,
    reason: LinkRemovalReason,
    at: Date,
    tx?: Executor,
  ): Promise<boolean>;
  /** Marks a live link not reachable; keeps the first block time. */
  markBlocked(workspaceId: string, linkId: string, at: Date, tx?: Executor): Promise<boolean>;
  clearBlocked(workspaceId: string, linkId: string, tx?: Executor): Promise<boolean>;
  /** One notice per link per hour: true for exactly one of any concurrent callers. */
  claimNotice(workspaceId: string, linkId: string, now: Date, tx?: Executor): Promise<boolean>;
  /** Clears the Telegram user id a member-removed link kept for the "notifications off" answer. */
  clearRemovedUserId(workspaceId: string, linkId: string, tx?: Executor): Promise<boolean>;
  /** Live links made with a bot other than `telegramBotId` (the bot-connected hook). */
  listLiveWithOtherBot(
    workspaceId: string,
    telegramBotId: bigint,
    tx?: Executor,
  ): Promise<TelegramLink[]>;

  // The sixth controlled exception to the tenancy rule (sad.md §8, ADR-0005): it produces workspace ids.
  /** Workspaces with at least one live link; read only by the scheduled backstop. */
  workspacesWithLiveLink(): Promise<string[]>;
}

/** A connect link (connect_links row); only the token's hash is stored. */
export interface ConnectLink {
  id: string;
  workspaceId: string;
  accountId: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  replacedAt: Date | null;
}

export interface NewConnectLink {
  id: string;
  accountId: string;
  tokenHash: Buffer;
  createdAt: Date;
  expiresAt: Date;
}

export interface ConnectLinkRepo {
  /** The redeem's plain read, scoped by the workspace of the authenticated webhook's bot. */
  findByHash(workspaceId: string, tokenHash: Buffer, tx?: Executor): Promise<ConnectLink | null>;
  /** `FOR UPDATE` by id for the rest of the transaction; the redeem re-checks `usable` on it. */
  lockById(workspaceId: string, linkId: string, tx: Executor): Promise<ConnectLink | null>;
  /**
   * Takes the transaction-level advisory lock `connect-links:<workspace>:<account>`, which serialises
   * the issuing of one member's links.
   */
  lockIssuing(workspaceId: string, accountId: string, tx: Executor): Promise<void>;
  /** The member's links created strictly after `since`, and the earliest of them. */
  countSince(
    workspaceId: string,
    accountId: string,
    since: Date,
    tx?: Executor,
  ): Promise<{ count: number; oldestCreatedAt: Date | null }>;
  /** Marks the member's unused, not yet replaced links replaced; returns how many. */
  markUnusedReplaced(
    workspaceId: string,
    accountId: string,
    at: Date,
    tx?: Executor,
  ): Promise<number>;
  insert(workspaceId: string, link: NewConnectLink, tx?: Executor): Promise<void>;
  /** Uses an unused, not replaced link; false when it is not (or not in the workspace). */
  markUsed(workspaceId: string, linkId: string, at: Date, tx?: Executor): Promise<boolean>;
}

export interface NewPresence {
  /** The hub's connection id of the socket. */
  id: string;
  accountId: string;
  liveUntil: Date;
  onScreen: boolean;
  at: Date;
}

/** Per-tab presence leases (ADR-0002); a clean close or expiry deletes the row. */
export interface PresenceRepo {
  /** A tab opened: stores the lease; a tab that opens on screen counts as on screen at `at`. */
  open(workspaceId: string, lease: NewPresence, tx?: Executor): Promise<void>;
  /** A pong: moves `live_until` forward, never back. False when the lease is not in the workspace. */
  extend(workspaceId: string, id: string, liveUntil: Date, tx?: Executor): Promise<boolean>;
  /**
   * The tab went on or off screen at `at`. `last_on_screen_at` moves to `at` while on screen and on a
   * real on -> off transition only: an off frame on a never-on-screen lease keeps it NULL (D1).
   */
  setScreen(
    workspaceId: string,
    id: string,
    onScreen: boolean,
    at: Date,
    tx?: Executor,
  ): Promise<boolean>;
  close(workspaceId: string, id: string, tx?: Executor): Promise<boolean>;
  /** Deletes leases whose `live_until` is not after `now`; of one member when `accountId` is given. */
  deleteExpired(workspaceId: string, now: Date, accountId?: string, tx?: Executor): Promise<number>;
  /** Live leases (`live_until` after `now`) by member; for the given members when `accountIds` is. */
  listLive(
    workspaceId: string,
    now: Date,
    accountIds?: string[],
    tx?: Executor,
  ): Promise<Map<string, PresenceLease[]>>;
}

export type PingOutcome = 'sending' | 'accepted' | 'blocked' | 'failed';

export interface NewPing {
  id: string;
  accountId: string;
  telegramLinkId: string;
  createdAt: Date;
}

/** A conversation's waiting period: the ledger's unit. */
export interface PingPeriod {
  conversationId: string;
  waitingSince: Date;
}

export interface LedgerEntry extends PingPeriod {
  accountId: string;
}

export interface PingRepo {
  /**
   * Inserts a `sending` ping and one ledger item per period in the caller's transaction. When any
   * (conversation, period, member) was pinged already, another worker won: the ping is removed again
   * and the result is `lost`, so nothing is sent.
   */
  insertWithItems(
    workspaceId: string,
    ping: NewPing,
    items: PingPeriod[],
    tx: Executor,
  ): Promise<'inserted' | 'lost'>;
  /**
   * Takes the transaction-level advisory lock `pings:<workspace>:<account>`: one member's send
   * transactions run one at a time across sweeps and instances, so the spacing re-check that follows
   * sees the other's committed ping (AC-08). Taken after the membership share lock, before the link.
   */
  lockMember(workspaceId: string, accountId: string, tx: Executor): Promise<void>;
  /** The member's newest ping in the workspace (any outcome), for the 10-minute spacing. */
  lastPingAt(workspaceId: string, accountId: string, tx?: Executor): Promise<Date | null>;
  /** The members already pinged for these periods. */
  ledger(workspaceId: string, periods: PingPeriod[], tx?: Executor): Promise<LedgerEntry[]>;
  setOutcome(
    workspaceId: string,
    pingId: string,
    outcome: PingOutcome,
    tx?: Executor,
  ): Promise<boolean>;
  /** Deletes a ping Telegram did not accept, with its items (cascade): the conversations are due again. */
  rollOut(workspaceId: string, pingId: string, tx?: Executor): Promise<boolean>;
  /**
   * The member opened a ping link at `now`: marks their newest delivered (`accepted` or `sending`)
   * ping created within the last 15 minutes as opened, once. False when there is none.
   */
  markOpened(workspaceId: string, accountId: string, now: Date, tx?: Executor): Promise<boolean>;
}

// ───────── ports to other modules and the platform (filled by the composition root) ─────────

/** One database transaction; the callback's executor is the transaction every repo call joins. */
export type Transaction = <T>(fn: (tx: Executor) => Promise<T>) => Promise<T>;

/** The slice of `workspaces` the connect/redeem use cases need. */
export interface MembershipLocks {
  /**
   * Joins `tx`: `FOR SHARE` on the memberships of `accountIds`, so a concurrent deactivation waits;
   * returns the active accounts among them.
   */
  lockActiveMembers(tx: Executor, workspaceId: string, accountIds: string[]): Promise<string[]>;
}

/** The slice of `bots` notifications reads; `tx` joins a caller's transaction (never a 2nd connection). */
export interface BotReadiness {
  inboxBotStatus(workspaceId: string, tx?: Executor): Promise<InboxBotStatus>;
  pingReadiness(
    workspaceId: string,
    tx?: Executor,
  ): Promise<{
    state: 'connected' | 'needs_token' | 'taken_over' | 'disconnected';
    telegramBotId: bigint;
    username: string;
    sendPausedUntil: Date | null;
  } | null>;
}

export interface NotificationSignals {
  /** `telegram_link.changed` for that account, in the caller's transaction. */
  telegramLinkChanged(tx: Executor, workspaceId: string, accountId: string): Promise<void>;
}

export type CannotConnectReasonValue = 'telegram_linked_to_teammate' | 'member_linked_elsewhere';

/** A bot answer to enqueue (`notifications.send-bot-message`); exactly one recipient per kind. */
export type BotMessage =
  | {
      kind: 'connected' | 'already_connected' | 'notifications_off' | 'chat_only_notifications';
      telegramLinkId: string;
    }
  | { kind: 'link_expired'; telegramUserId: bigint }
  | { kind: 'cannot_connect'; telegramUserId: bigint; reason: CannotConnectReasonValue };

/** Puts the answer job on the caller's transaction, so it commits or rolls back with the rows. */
export type EnqueueBotMessage = (
  tx: Executor,
  workspaceId: string,
  message: BotMessage,
) => Promise<void>;

/**
 * What `bots.sendMemberMessage` answers; it never throws. `transient`: definitely not sent (safe to
 * retry); `unknown`: may have been delivered (never retried, so a member never gets it twice).
 */
export type MemberSendOutcome =
  | { outcome: 'accepted' }
  | { outcome: 'blocked' }
  | { outcome: 'rate_limited'; retryAfter: Date }
  | { outcome: 'bot_unavailable' }
  | { outcome: 'transient' }
  | { outcome: 'unknown' };

/** Sends plain text to a member's private chat through the workspace's bot (paced, behind the pause). */
export type SendMemberMessage = (request: {
  workspaceId: string;
  telegramUserId: bigint;
  text: string;
}) => Promise<MemberSendOutcome>;

/** The workspace facts a text needs. */
export interface WorkspaceNames {
  /** Null when the workspace is gone. */
  workspaceName(workspaceId: string): Promise<string | null>;
}

/** One open conversation in a waiting period, as the sweep reads it from `conversations`. */
export interface WaitingRead {
  conversationId: string;
  assigneeAccountId: string | null;
  waitingSince: Date;
  startedBy: 'message' | 'reopen';
  /** Accounts, among those asked for and the assignee, that read the waiting message. */
  readBy: Set<string>;
}

export interface WaitingReads {
  /** `tx` joins the caller's transaction (the send-time re-check). */
  waitingForPings(
    workspaceId: string,
    query: { conversationIds?: string[]; accountIds: string[] },
    tx?: Executor,
  ): Promise<WaitingRead[]>;
}
