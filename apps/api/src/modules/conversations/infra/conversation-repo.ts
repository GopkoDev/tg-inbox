import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { unreadFloor } from '../domain/read-state.js';
import type { LatestReply } from '../domain/state.js';
import type { ConversationRepo } from '../app/ports.js';

export function createConversationRepo(db: Db): ConversationRepo {
  async function findByChat(workspaceId: string, telegramChatId: bigint, tx?: Db) {
    const row = await (tx ?? db)
      .selectFrom('conversations')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('telegram_chat_id', '=', String(telegramChatId))
      .executeTakeFirst();
    return row?.id ?? null;
  }

  return {
    async upsert(workspaceId, { contactId, telegramChatId }, now, tx) {
      const inserted = await (tx ?? db)
        .insertInto('conversations')
        .values({
          id: newId(),
          workspace_id: workspaceId,
          contact_id: contactId,
          telegram_chat_id: telegramChatId,
          created_at: now,
          last_message_received_at: now,
          last_activity_at: now,
          status: 'open',
          state_version: 0,
          customer_message_seq: 0,
        })
        .onConflict((oc) => oc.columns(['workspace_id', 'telegram_chat_id']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (inserted) return { conversationId: inserted.id, created: true };
      const existing = await findByChat(workspaceId, telegramChatId, tx);
      if (existing === null) throw new Error('conversation vanished after a conflicting insert');
      return { conversationId: existing, created: false };
    },

    async raiseReceived(workspaceId, conversationId, receivedAt, tx) {
      // One UPDATE keeps conversations_last_activity_at_check true; GREATEST ignores a null reply time.
      // It takes the row lock and returns the state under it: capture decides the reopen on this result,
      // never on an earlier read (ADR-0004).
      const { rows } = await sql<{
        status: 'open' | 'closed';
        assignee_account_id: string | null;
        state_version: number;
        waiting_since: Date | null;
      }>`UPDATE conversations
        SET last_message_received_at = GREATEST(last_message_received_at, ${receivedAt}::timestamptz),
            last_activity_at = GREATEST(last_message_received_at, ${receivedAt}::timestamptz, last_reply_sent_at),
            customer_message_seq = customer_message_seq + 1
        WHERE id = ${conversationId} AND workspace_id = ${workspaceId}
        RETURNING status, assignee_account_id, state_version, waiting_since`.execute(tx ?? db);
      const row = rows[0];
      if (!row) throw new Error('conversation vanished before its arrival was recorded');
      return {
        status: row.status,
        assigneeAccountId: row.assignee_account_id,
        stateVersion: row.state_version,
        waitingSince: row.waiting_since,
      };
    },

    async writeWaiting(workspaceId, conversationId, period, tx) {
      const row = await (tx ?? db)
        .updateTable('conversations')
        .set({ waiting_since: period.since, waiting_started_by: period.startedBy })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', conversationId)
        .where('status', '=', 'open')
        .where('waiting_since', 'is', null)
        .returning('id')
        .executeTakeFirst();
      return row !== undefined;
    },

    findByChat,

    async hasAny(workspaceId, tx) {
      const row = await (tx ?? db)
        .selectFrom('conversations')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .limit(1)
        .executeTakeFirst();
      return row !== undefined;
    },

    async lockState(workspaceId, conversationId, tx) {
      const row = await tx
        .selectFrom('conversations')
        .select([
          'status',
          'assignee_account_id',
          'state_version',
          'customer_message_seq',
          'last_activity_at',
          'last_message_received_at',
          'last_reply_sent_at',
        ])
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', conversationId)
        .forNoKeyUpdate()
        .executeTakeFirst();
      if (!row) return null;
      return {
        status: row.status as 'open' | 'closed',
        assigneeAccountId: row.assignee_account_id,
        stateVersion: row.state_version as number,
        customerMessageSeq: row.customer_message_seq as number,
        lastActivityAt: row.last_activity_at,
        waitingForReply:
          row.last_reply_sent_at === null ||
          row.last_message_received_at.getTime() > row.last_reply_sent_at.getTime(),
      };
    },

    async lockAssignedTo(workspaceId, accountId, tx) {
      const rows = await tx
        .selectFrom('conversations')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('assignee_account_id', '=', accountId)
        .orderBy('id')
        .forNoKeyUpdate()
        .execute();
      return rows.map((r) => r.id);
    },

    async writeState(workspaceId, conversationId, change, tx) {
      const row = await (tx ?? db)
        .updateTable('conversations')
        .set({
          ...(change.status !== undefined ? { status: change.status } : {}),
          ...(change.assigneeAccountId !== undefined
            ? { assignee_account_id: change.assigneeAccountId }
            : {}),
          ...(change.waiting !== undefined
            ? {
                waiting_since: change.waiting?.since ?? null,
                waiting_started_by: change.waiting?.startedBy ?? null,
              }
            : {}),
          state_version: sql<number>`state_version + 1`,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', conversationId)
        .returning('state_version')
        .executeTakeFirst();
      return row ? (row.state_version as number) : null;
    },

    async newestUnreadCustomerMessage(workspaceId, conversationId, accountId, activeSince, tx) {
      const exec = tx ?? db;
      const mark = await exec
        .selectFrom('read_marks')
        .select('read_through_at')
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('account_id', '=', accountId)
        .executeTakeFirst();
      const floor = unreadFloor(mark?.read_through_at ?? null, activeSince);
      const row = await exec
        .selectFrom('messages')
        .select(['id', 'received_at'])
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('received_at', '>', floor)
        .orderBy('received_at', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();
      return row ? { id: row.id, receivedAt: row.received_at } : null;
    },

    async latestReply(workspaceId, conversationId, tx) {
      const row = await (tx ?? db)
        .selectFrom('replies')
        .select(['id', 'state'])
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .orderBy('position_at', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();
      return row ? { id: row.id, state: row.state as LatestReply['state'] } : null;
    },
  };
}
