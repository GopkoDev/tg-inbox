import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
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
      await sql`UPDATE conversations
        SET last_message_received_at = GREATEST(last_message_received_at, ${receivedAt}::timestamptz),
            last_activity_at = GREATEST(last_message_received_at, ${receivedAt}::timestamptz, last_reply_sent_at)
        WHERE id = ${conversationId} AND workspace_id = ${workspaceId}`.execute(tx ?? db);
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
  };
}
