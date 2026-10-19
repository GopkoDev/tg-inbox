import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { NotificationReads, WaitingConversation } from '../app/ports.js';

interface WaitingRow {
  id: string;
  assignee_account_id: string | null;
  waiting_since: Date;
  waiting_started_by: string;
  starting_arrival: Date | null;
}

export function createNotificationQueries(db: Db): NotificationReads {
  return {
    async waitingForPings(workspaceId, { conversationIds, accountIds }) {
      if (conversationIds?.length === 0) return [];
      // Open and waiting only (a closed row never holds a period, conversations_waiting_open_check):
      // the partial index (workspace_id, waiting_since) serves the filter and the order.
      const narrowed = conversationIds ? sql`AND c.id = ANY(${conversationIds}::uuid[])` : sql``;
      const { rows } = await sql<WaitingRow>`
        SELECT c.id, c.assignee_account_id, c.waiting_since, c.waiting_started_by,
          (SELECT min(m.received_at) FROM messages m
            WHERE m.conversation_id = c.id AND m.workspace_id = ${workspaceId}
              AND CASE WHEN c.waiting_started_by = 'message'
                    THEN m.received_at >= c.waiting_since
                    ELSE (c.last_reply_sent_at IS NULL OR m.received_at > c.last_reply_sent_at)
                  END) AS starting_arrival
        FROM conversations c
        WHERE c.workspace_id = ${workspaceId}
          AND c.status = 'open' AND c.waiting_since IS NOT NULL
          ${narrowed}
        ORDER BY c.waiting_since, c.id`.execute(db);
      if (rows.length === 0) return [];

      const wanted = new Set(accountIds);
      for (const r of rows) if (r.assignee_account_id) wanted.add(r.assignee_account_id);
      const marks =
        wanted.size === 0
          ? []
          : await db
              .selectFrom('read_marks')
              .select(['conversation_id', 'account_id', 'read_through_at'])
              .where('workspace_id', '=', workspaceId)
              .where(
                'conversation_id',
                'in',
                rows.map((r) => r.id),
              )
              .where('account_id', 'in', [...wanted])
              .execute();
      const marked = new Map<string, Date>();
      for (const m of marks) marked.set(`${m.conversation_id}:${m.account_id}`, m.read_through_at);

      return rows.map((r): WaitingConversation => {
        const startingArrival = r.starting_arrival ?? r.waiting_since;
        const readBy = new Set<string>();
        for (const account of r.assignee_account_id
          ? new Set([...accountIds, r.assignee_account_id])
          : accountIds) {
          const mark = marked.get(`${r.id}:${account}`);
          if (mark && mark.getTime() >= startingArrival.getTime()) readBy.add(account);
        }
        return {
          conversationId: r.id,
          assigneeAccountId: r.assignee_account_id,
          waitingSince: r.waiting_since,
          startedBy: r.waiting_started_by === 'reopen' ? 'reopen' : 'message',
          startingArrival,
          readBy,
        };
      });
    },

    async attentionCount(workspaceId, accountId, activeSince) {
      // The list's unread predicate: a customer arrival after GREATEST(read mark, active since).
      const { rows } = await sql<{ n: number }>`
        SELECT count(*)::int AS n
        FROM conversations c
        LEFT JOIN read_marks rm
          ON rm.conversation_id = c.id AND rm.account_id = ${accountId}
            AND rm.workspace_id = ${workspaceId}
        WHERE c.workspace_id = ${workspaceId}
          AND c.status = 'open'
          AND (c.assignee_account_id = ${accountId}::uuid OR c.assignee_account_id IS NULL)
          AND EXISTS (
            SELECT 1 FROM messages um
            WHERE um.conversation_id = c.id AND um.workspace_id = ${workspaceId}
              AND um.received_at > GREATEST(rm.read_through_at, ${activeSince}::timestamptz))`.execute(
        db,
      );
      return rows[0]?.n ?? 0;
    },
  };
}
