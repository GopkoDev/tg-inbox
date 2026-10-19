import { sql, type Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { TelegramLinks } from '../../../platform/db.types.gen.js';
import type { LinkRemovalReason, TelegramLink, TelegramLinkRepo } from '../app/ports.js';

const NOTICE_SPACING_MS = 60 * 60_000;

function toLink(row: Selectable<TelegramLinks>): TelegramLink {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    telegramBotId: BigInt(row.telegram_bot_id),
    telegramUserId: row.telegram_user_id === null ? null : BigInt(row.telegram_user_id),
    displayName: row.display_name,
    linkedAt: row.linked_at,
    blockedAt: row.blocked_at,
    lastNoticeAt: row.last_notice_at,
    removedAt: row.removed_at,
    removedReason: row.removed_reason as LinkRemovalReason | null,
  };
}

function conflict(err: unknown): 'account_linked' | 'telegram_user_linked' | null {
  const e = err as { code?: string; constraint?: string };
  if (e.code !== '23505') return null;
  if (e.constraint === 'telegram_links_live_workspace_id_account_id_key') return 'account_linked';
  if (e.constraint === 'telegram_links_live_workspace_id_telegram_user_id_key') {
    return 'telegram_user_linked';
  }
  return null;
}

export function createTelegramLinkRepo(db: Db): TelegramLinkRepo {
  return {
    async findLiveByAccount(workspaceId, accountId, options, tx) {
      const row = await (tx ?? db)
        .selectFrom('telegram_links')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('account_id', '=', accountId)
        .where('removed_at', 'is', null)
        .$if(options?.lock === true, (qb) => qb.forUpdate())
        .$if(options?.lock === 'share', (qb) => qb.forShare())
        .executeTakeFirst();
      return row ? toLink(row) : null;
    },

    async findLiveByTelegramUser(workspaceId, telegramUserId, tx) {
      const row = await (tx ?? db)
        .selectFrom('telegram_links')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('telegram_user_id', '=', String(telegramUserId))
        .where('removed_at', 'is', null)
        .executeTakeFirst();
      return row ? toLink(row) : null;
    },

    async findById(workspaceId, linkId, tx) {
      const row = await (tx ?? db)
        .selectFrom('telegram_links')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', linkId)
        .executeTakeFirst();
      return row ? toLink(row) : null;
    },

    async listLive(workspaceId, tx) {
      const rows = await (tx ?? db)
        .selectFrom('telegram_links')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('removed_at', 'is', null)
        .orderBy('linked_at')
        .orderBy('id')
        .execute();
      return rows.map(toLink);
    },

    async insert(workspaceId, link, tx) {
      try {
        await (tx ?? db)
          .insertInto('telegram_links')
          .values({
            id: link.id,
            workspace_id: workspaceId,
            account_id: link.accountId,
            telegram_bot_id: link.telegramBotId,
            telegram_user_id: link.telegramUserId,
            display_name: link.displayName,
            linked_at: link.linkedAt,
          })
          .execute();
        return { ok: true };
      } catch (err) {
        const reason = conflict(err);
        if (reason) return { ok: false, reason };
        throw err;
      }
    },

    async remove(workspaceId, linkId, reason, at, tx) {
      const row = await (tx ?? db)
        .updateTable('telegram_links')
        .set({
          removed_at: at,
          removed_reason: reason,
          display_name: null,
          ...(reason === 'member' ? {} : { telegram_user_id: null }),
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', linkId)
        .where('removed_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      return row !== undefined;
    },

    async markBlocked(workspaceId, linkId, at, tx) {
      const row = await (tx ?? db)
        .updateTable('telegram_links')
        .set({ blocked_at: sql`COALESCE(blocked_at, ${at}::timestamptz)` })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', linkId)
        .where('removed_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      return row !== undefined;
    },

    async clearBlocked(workspaceId, linkId, tx) {
      const row = await (tx ?? db)
        .updateTable('telegram_links')
        .set({ blocked_at: null })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', linkId)
        .where('removed_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      return row !== undefined;
    },

    async claimNotice(workspaceId, linkId, now, tx) {
      const row = await (tx ?? db)
        .updateTable('telegram_links')
        .set({ last_notice_at: now })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', linkId)
        .where((eb) =>
          eb.or([
            eb('last_notice_at', 'is', null),
            eb('last_notice_at', '<', new Date(now.getTime() - NOTICE_SPACING_MS)),
          ]),
        )
        .returning('id')
        .executeTakeFirst();
      return row !== undefined;
    },

    async clearRemovedUserId(workspaceId, linkId, tx) {
      const row = await (tx ?? db)
        .updateTable('telegram_links')
        .set({ telegram_user_id: null })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', linkId)
        .where('removed_reason', '=', 'member')
        .where('telegram_user_id', 'is not', null)
        .returning('id')
        .executeTakeFirst();
      return row !== undefined;
    },

    async listLiveWithOtherBot(workspaceId, telegramBotId, tx) {
      const rows = await (tx ?? db)
        .selectFrom('telegram_links')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('removed_at', 'is', null)
        .where('telegram_bot_id', '<>', String(telegramBotId))
        .orderBy('id')
        .execute();
      return rows.map(toLink);
    },

    async workspacesWithLiveLink() {
      const rows = await db
        .selectFrom('telegram_links')
        .select('workspace_id')
        .distinct()
        .where('removed_at', 'is', null)
        .execute();
      return rows.map((r) => r.workspace_id);
    },
  };
}
