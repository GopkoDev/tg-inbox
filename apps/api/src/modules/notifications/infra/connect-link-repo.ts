import { sql, type Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { ConnectLinks } from '../../../platform/db.types.gen.js';
import type { ConnectLink, ConnectLinkRepo } from '../app/ports.js';

function toLink(row: Selectable<ConnectLinks>): ConnectLink {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    replacedAt: row.replaced_at,
  };
}

const COLUMNS = [
  'id',
  'workspace_id',
  'account_id',
  'created_at',
  'expires_at',
  'used_at',
  'replaced_at',
] as const;

export function createConnectLinkRepo(db: Db): ConnectLinkRepo {
  return {
    async findByHash(workspaceId, tokenHash, tx) {
      const row = await (tx ?? db)
        .selectFrom('connect_links')
        .select(COLUMNS)
        .where('workspace_id', '=', workspaceId)
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst();
      return row ? toLink(row as Selectable<ConnectLinks>) : null;
    },

    async lockById(workspaceId, linkId, tx) {
      const row = await tx
        .selectFrom('connect_links')
        .select(COLUMNS)
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', linkId)
        .forUpdate()
        .executeTakeFirst();
      return row ? toLink(row as Selectable<ConnectLinks>) : null;
    },

    async lockIssuing(workspaceId, accountId, tx) {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`connect-links:${workspaceId}:${accountId}`}, 0))`.execute(
        tx,
      );
    },

    async countSince(workspaceId, accountId, since, tx) {
      const row = await (tx ?? db)
        .selectFrom('connect_links')
        .select([
          sql<number>`count(*)::int`.as('n'),
          sql<Date | null>`min(created_at)`.as('oldest'),
        ])
        .where('workspace_id', '=', workspaceId)
        .where('account_id', '=', accountId)
        .where('created_at', '>', since)
        .executeTakeFirstOrThrow();
      return { count: row.n, oldestCreatedAt: row.oldest };
    },

    async markUnusedReplaced(workspaceId, accountId, at, tx) {
      const rows = await (tx ?? db)
        .updateTable('connect_links')
        .set({ replaced_at: at })
        .where('workspace_id', '=', workspaceId)
        .where('account_id', '=', accountId)
        .where('used_at', 'is', null)
        .where('replaced_at', 'is', null)
        .returning('id')
        .execute();
      return rows.length;
    },

    async insert(workspaceId, link, tx) {
      await (tx ?? db)
        .insertInto('connect_links')
        .values({
          id: link.id,
          workspace_id: workspaceId,
          account_id: link.accountId,
          token_hash: link.tokenHash,
          created_at: link.createdAt,
          expires_at: link.expiresAt,
        })
        .execute();
    },

    async markUsed(workspaceId, linkId, at, tx) {
      const row = await (tx ?? db)
        .updateTable('connect_links')
        .set({ used_at: at })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', linkId)
        .where('used_at', 'is', null)
        .where('replaced_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      return row !== undefined;
    },
  };
}
