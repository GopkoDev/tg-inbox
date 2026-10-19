import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import type { LedgerEntry, PingOutcome, PingRepo } from '../app/ports.js';

/** A ping opened within this long after it was sent counts for the opened-at KPI (flows 7, 14). */
const OPEN_WINDOW_MS = 15 * 60_000;

export function createPingRepo(db: Db): PingRepo {
  return {
    async insertWithItems(workspaceId, ping, items, tx) {
      await tx
        .insertInto('pings')
        .values({
          id: ping.id,
          workspace_id: workspaceId,
          account_id: ping.accountId,
          telegram_link_id: ping.telegramLinkId,
          outcome: 'sending',
          created_at: ping.createdAt,
        })
        .execute();
      if (items.length === 0) return 'inserted';
      // A conflict on the ledger key means another worker pinged this member for that period first.
      const inserted = await tx
        .insertInto('ping_items')
        .values(
          items.map((item) => ({
            id: newId(),
            workspace_id: workspaceId,
            ping_id: ping.id,
            account_id: ping.accountId,
            conversation_id: item.conversationId,
            waiting_since: item.waitingSince,
          })),
        )
        .onConflict((oc) =>
          oc.columns(['conversation_id', 'waiting_since', 'account_id']).doNothing(),
        )
        .returning('id')
        .execute();
      if (inserted.length === items.length) return 'inserted';
      // The ping and the items that did get in go together (cascade): nothing is sent.
      await tx
        .deleteFrom('pings')
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', ping.id)
        .execute();
      return 'lost';
    },

    async lastPingAt(workspaceId, accountId, tx) {
      const row = await (tx ?? db)
        .selectFrom('pings')
        .select('created_at')
        .where('workspace_id', '=', workspaceId)
        .where('account_id', '=', accountId)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      return row?.created_at ?? null;
    },

    async ledger(workspaceId, periods, tx) {
      if (periods.length === 0) return [];
      const { rows } = await sql<{
        conversation_id: string;
        waiting_since: Date;
        account_id: string;
      }>`SELECT i.conversation_id, i.waiting_since, i.account_id
        FROM ping_items i
        WHERE i.workspace_id = ${workspaceId}
          AND (i.conversation_id, i.waiting_since) IN (
            SELECT * FROM unnest(${periods.map((p) => p.conversationId)}::uuid[],
                                 ${periods.map((p) => p.waitingSince)}::timestamptz[]))`.execute(
        tx ?? db,
      );
      return rows.map((r): LedgerEntry => ({
        conversationId: r.conversation_id,
        waitingSince: r.waiting_since,
        accountId: r.account_id,
      }));
    },

    async setOutcome(workspaceId, pingId, outcome: PingOutcome, tx) {
      const row = await (tx ?? db)
        .updateTable('pings')
        .set({ outcome })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', pingId)
        .returning('id')
        .executeTakeFirst();
      return row !== undefined;
    },

    async rollOut(workspaceId, pingId, tx) {
      const row = await (tx ?? db)
        .deleteFrom('pings')
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', pingId)
        .returning('id')
        .executeTakeFirst();
      return row !== undefined;
    },

    async markOpened(workspaceId, accountId, now, tx) {
      const exec = tx ?? db;
      const newest = await exec
        .selectFrom('pings')
        .select(['id', 'created_at', 'opened_at'])
        .where('workspace_id', '=', workspaceId)
        .where('account_id', '=', accountId)
        .where('outcome', 'in', ['accepted', 'sending'])
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (!newest || newest.opened_at !== null) return false;
      if (newest.created_at.getTime() <= now.getTime() - OPEN_WINDOW_MS) return false;
      const row = await exec
        .updateTable('pings')
        .set({ opened_at: now })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', newest.id)
        .where('opened_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      return row !== undefined;
    },
  };
}
