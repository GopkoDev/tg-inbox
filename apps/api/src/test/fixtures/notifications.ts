import type { Kysely } from 'kysely';
import type { DB } from '../../platform/db.types.gen.js';
import { newId } from '../../platform/ids.js';
import { issueLinkToken } from '../../platform/tokens.js';
import { insertMembership, insertWorkspace } from './workspaces.js';

const T = new Date('2026-10-11T10:00:00Z');
const MINUTE = 60_000;
let nextTelegramUserId = 5001n;

/** A telegram_links row written directly (PII guard: `Test User`, synthetic ids). A live link by default. */
export async function insertTelegramLink(
  db: Kysely<DB>,
  o: {
    workspaceId: string;
    accountId: string;
    telegramBotId?: bigint;
    telegramUserId?: bigint | null;
    displayName?: string | null;
    linkedAt?: Date;
    blockedAt?: Date | null;
    lastNoticeAt?: Date | null;
    /** A removed link: display name cleared; the Telegram user id kept only for 'member'. */
    removed?: { at: Date; reason: 'member' | 'deactivated' | 'bot_replaced' };
  },
): Promise<{ id: string; telegramUserId: bigint | null }> {
  const id = newId();
  const removed = o.removed;
  const telegramUserId = removed
    ? removed.reason === 'member'
      ? (o.telegramUserId ?? null)
      : null
    : (o.telegramUserId ?? nextTelegramUserId++);
  await db
    .insertInto('telegram_links')
    .values({
      id,
      workspace_id: o.workspaceId,
      account_id: o.accountId,
      telegram_bot_id: o.telegramBotId ?? 7001n,
      telegram_user_id: telegramUserId,
      display_name: removed ? null : (o.displayName ?? 'Test User'),
      linked_at: o.linkedAt ?? T,
      blocked_at: o.blockedAt ?? null,
      last_notice_at: o.lastNoticeAt ?? null,
      removed_at: removed?.at ?? null,
      removed_reason: removed?.reason ?? null,
    })
    .execute();
  return { id, telegramUserId };
}

/**
 * A connect_links row. Returns the plain token and the `/start` payload (`tgi_<token>`) a test sends
 * to the webhook; only the token's hash is stored.
 */
export async function insertConnectLink(
  db: Kysely<DB>,
  o: {
    workspaceId: string;
    accountId: string;
    createdAt?: Date;
    /** Defaults to 10 minutes after createdAt. */
    expiresAt?: Date;
    usedAt?: Date | null;
    replacedAt?: Date | null;
  },
): Promise<{ id: string; token: string; startPayload: string; tokenHash: Buffer }> {
  const { token, hash } = issueLinkToken();
  const id = newId();
  const createdAt = o.createdAt ?? T;
  await db
    .insertInto('connect_links')
    .values({
      id,
      workspace_id: o.workspaceId,
      account_id: o.accountId,
      token_hash: hash,
      created_at: createdAt,
      expires_at: o.expiresAt ?? new Date(createdAt.getTime() + 10 * MINUTE),
      used_at: o.usedAt ?? null,
      replaced_at: o.replacedAt ?? null,
    })
    .execute();
  return { id, token, startPayload: `tgi_${token}`, tokenHash: hash };
}

/** A tab_presences lease: on screen and live for 50 s after it opened, by default. Returns the connection id. */
export async function insertPresence(
  db: Kysely<DB>,
  o: {
    workspaceId: string;
    accountId: string;
    id?: string;
    openedAt?: Date;
    liveUntil?: Date;
    onScreen?: boolean;
    lastOnScreenAt?: Date | null;
  },
): Promise<string> {
  const id = o.id ?? newId();
  const openedAt = o.openedAt ?? T;
  await db
    .insertInto('tab_presences')
    .values({
      id,
      workspace_id: o.workspaceId,
      account_id: o.accountId,
      live_until: o.liveUntil ?? new Date(openedAt.getTime() + 50_000),
      on_screen: o.onScreen ?? true,
      last_on_screen_at: o.lastOnScreenAt ?? null,
      opened_at: openedAt,
    })
    .execute();
  return id;
}

/** A pings row with its ledger items (the ping's workspace and account). */
export async function insertPing(
  db: Kysely<DB>,
  o: {
    workspaceId: string;
    accountId: string;
    telegramLinkId: string;
    outcome?: 'sending' | 'accepted' | 'blocked' | 'failed';
    createdAt?: Date;
    openedAt?: Date | null;
    items?: { conversationId: string; waitingSince: Date }[];
  },
): Promise<{ id: string; itemIds: string[] }> {
  const id = newId();
  await db
    .insertInto('pings')
    .values({
      id,
      workspace_id: o.workspaceId,
      account_id: o.accountId,
      telegram_link_id: o.telegramLinkId,
      outcome: o.outcome ?? 'accepted',
      created_at: o.createdAt ?? T,
      opened_at: o.openedAt ?? null,
    })
    .execute();
  const itemIds: string[] = [];
  for (const item of o.items ?? []) {
    const itemId = newId();
    itemIds.push(itemId);
    await db
      .insertInto('ping_items')
      .values({
        id: itemId,
        workspace_id: o.workspaceId,
        ping_id: id,
        account_id: o.accountId,
        conversation_id: item.conversationId,
        waiting_since: item.waitingSince,
      })
      .execute();
  }
  return { id, itemIds };
}

/**
 * Two workspaces sharing one account and one Telegram user id, each with a live link: the base of
 * every cross-workspace isolation test.
 */
export async function twoWorkspacesWithLinks(db: Kysely<DB>) {
  const telegramUserId = nextTelegramUserId++;
  const workspaceA = await insertWorkspace(db, 'A');
  const workspaceB = await insertWorkspace(db, 'B');
  const { accountId } = await insertMembership(db, workspaceA);
  await insertMembership(db, workspaceB, { accountId });
  const linkA = await insertTelegramLink(db, {
    workspaceId: workspaceA,
    accountId,
    telegramUserId,
  });
  const linkB = await insertTelegramLink(db, {
    workspaceId: workspaceB,
    accountId,
    telegramUserId,
  });
  return {
    accountId,
    telegramUserId,
    a: { workspaceId: workspaceA, linkId: linkA.id },
    b: { workspaceId: workspaceB, linkId: linkB.id },
  };
}
