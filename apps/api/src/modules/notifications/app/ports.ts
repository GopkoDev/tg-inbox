import type { Db } from '../../../platform/db.js';

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
  /** `lock`: `FOR UPDATE` on the live row, for the rest of the transaction `tx`. */
  findLiveByAccount(
    workspaceId: string,
    accountId: string,
    options?: { lock?: boolean },
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
