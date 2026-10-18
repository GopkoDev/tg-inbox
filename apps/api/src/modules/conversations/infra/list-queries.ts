import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import { isMessageKind, type MessageKind } from '../domain/message.js';
import type { ConversationListReads, ConversationRow, LastItemView, Viewer } from '../app/ports.js';

interface RawRow {
  id: string;
  contact_id: string;
  last_activity_at: Date;
  waiting: boolean;
  unread: number;
  m_id: string | null;
  m_kind: string | null;
  m_body: string | null;
  m_received_at: Date | null;
  r_id: string | null;
  r_body: string | null;
  r_sent_at: Date | null;
}

function lastItemOf(r: RawRow): LastItemView | null {
  const message =
    r.m_id !== null && r.m_kind !== null && isMessageKind(r.m_kind)
      ? { id: r.m_id, kind: r.m_kind as MessageKind, body: r.m_body, at: r.m_received_at! }
      : null;
  const reply =
    r.r_id !== null && r.r_body !== null ? { id: r.r_id, body: r.r_body, at: r.r_sent_at! } : null;
  // The later of the newest arrival and the newest sent reply; a message wins a tie.
  if (reply && (!message || reply.at.getTime() > message.at.getTime())) {
    return { type: 'reply', id: reply.id, body: reply.body };
  }
  if (message) return { type: 'message', id: message.id, kind: message.kind, body: message.body };
  return null;
}

function toRow(r: RawRow): ConversationRow {
  return {
    id: r.id,
    contactId: r.contact_id,
    lastActivityAt: r.last_activity_at,
    lastItem: lastItemOf(r),
    unreadCount: r.unread,
    waitingForReply: r.waiting,
  };
}

export function createListQueries(db: Db): ConversationListReads {
  /** The rows of one workspace, each with this member's unread count, the waiting marker and the last item. */
  function select(
    workspaceId: string,
    viewer: Viewer,
    filter: ReturnType<typeof sql>,
    tail: ReturnType<typeof sql>,
  ) {
    return sql<RawRow>`
      SELECT c.id, c.contact_id, c.last_activity_at,
        (c.last_reply_sent_at IS NULL OR c.last_message_received_at > c.last_reply_sent_at) AS waiting,
        (SELECT count(*)::int FROM messages um
          WHERE um.conversation_id = c.id AND um.workspace_id = ${workspaceId}
            AND um.received_at > GREATEST(rm.read_through_at, ${viewer.activeSince}::timestamptz)) AS unread,
        lm.id AS m_id, lm.kind AS m_kind, lm.body AS m_body, lm.received_at AS m_received_at,
        lr.id AS r_id, lr.body AS r_body, lr.sent_at AS r_sent_at
      FROM conversations c
      LEFT JOIN read_marks rm
        ON rm.conversation_id = c.id AND rm.account_id = ${viewer.accountId}
          AND rm.workspace_id = ${workspaceId}
      LEFT JOIN LATERAL (
        SELECT id, kind, body, received_at FROM messages
        WHERE conversation_id = c.id AND workspace_id = ${workspaceId}
        ORDER BY received_at DESC, telegram_message_id DESC LIMIT 1
      ) lm ON true
      LEFT JOIN LATERAL (
        SELECT id, body, sent_at FROM replies
        WHERE conversation_id = c.id AND workspace_id = ${workspaceId} AND state = 'sent'
        ORDER BY position_at DESC, id DESC LIMIT 1
      ) lr ON true
      WHERE c.workspace_id = ${workspaceId} ${filter}
      ${tail}`;
  }

  return {
    async listPage(workspaceId, q) {
      const cursor = q.after
        ? sql`AND (c.last_activity_at, c.id) < (${q.after.lastActivityAt}::timestamptz, ${q.after.id}::uuid)`
        : sql``;
      const contacts =
        q.contactIds === null ? sql`` : sql`AND c.contact_id = ANY(${q.contactIds}::uuid[])`;
      const { rows } = await select(
        workspaceId,
        q,
        sql`${cursor} ${contacts}`,
        sql`ORDER BY c.last_activity_at DESC, c.id DESC LIMIT ${q.limit + 1}`,
      ).execute(db);
      return { rows: rows.slice(0, q.limit).map(toRow), hasNext: rows.length > q.limit };
    },

    async summary(workspaceId, conversationId, viewer) {
      const { rows } = await select(
        workspaceId,
        viewer,
        sql`AND c.id = ${conversationId}::uuid`,
        sql`LIMIT 1`,
      ).execute(db);
      return rows[0] ? toRow(rows[0]) : null;
    },
  };
}
