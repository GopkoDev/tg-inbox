import { sql, type Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { BroadcastItems as BroadcastItemsTable } from '../../../platform/db.types.gen.js';
import type { BroadcastItemRepo, BroadcastItemState, BroadcastItemView } from '../app/ports.js';

type BroadcastItemRow = Selectable<BroadcastItemsTable>;

export function toBroadcastItem(row: BroadcastItemRow): BroadcastItemView {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    broadcastId: row.broadcast_id,
    state: row.state as BroadcastItemState,
    positionAt: row.position_at,
    telegramMessageId: row.telegram_message_id === null ? null : BigInt(row.telegram_message_id),
    createdAt: row.created_at,
  };
}

/** `broadcast_items` (ADR-0010). Never writes a `conversations` column. */
export function createBroadcastItemRepo(db: Db): BroadcastItemRepo {
  return {
    async insert(item, tx) {
      // The contact's one conversation (conversations_contact_id_key) in this workspace; the
      // composite foreign keys hold the conversation and the broadcast to the same workspace.
      const row = await tx
        .insertInto('broadcast_items')
        .columns([
          'id',
          'workspace_id',
          'conversation_id',
          'broadcast_id',
          'state',
          'position_at',
          'telegram_message_id',
          'created_at',
        ])
        .expression((eb) =>
          eb
            .selectFrom('conversations')
            .select([
              sql<string>`${item.id}::uuid`.as('id'),
              'workspace_id',
              'id as conversation_id',
              sql<string>`${item.broadcastId}::uuid`.as('broadcast_id'),
              sql<string>`${item.state}::text`.as('state'),
              sql<Date>`${item.positionAt}::timestamptz`.as('position_at'),
              sql<
                string | null
              >`${item.telegramMessageId === null ? null : String(item.telegramMessageId)}::bigint`.as(
                'telegram_message_id',
              ),
              sql<Date>`${item.createdAt}::timestamptz`.as('created_at'),
            ])
            .where('workspace_id', '=', item.workspaceId)
            .where('contact_id', '=', item.contactId),
        )
        .returning('conversation_id')
        .executeTakeFirst();
      return row ? { conversationId: row.conversation_id } : null;
    },

    async byId(workspaceId, conversationId, itemId) {
      const row = await db
        .selectFrom('broadcast_items')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('id', '=', itemId)
        .executeTakeFirst();
      return row ? toBroadcastItem(row) : null;
    },
  };
}
