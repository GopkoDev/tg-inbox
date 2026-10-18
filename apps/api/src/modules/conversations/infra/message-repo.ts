import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { MessageRepo } from '../app/ports.js';

/** Newest `received_at` of a workspace — a backward scan of messages_workspace_id_received_at_idx. */
export function newestReceivedAtQuery(db: Db, workspaceId: string) {
  return db
    .selectFrom('messages')
    .select((eb) => eb.fn.max('received_at').as('newest'))
    .where('workspace_id', '=', workspaceId);
}

export function createMessageRepo(db: Db): MessageRepo {
  async function exists(ex: Db, workspaceId: string, conversationId: string, id: bigint) {
    const row = await ex
      .selectFrom('messages')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('conversation_id', '=', conversationId)
      .where('telegram_message_id', '=', String(id))
      .executeTakeFirst();
    return row !== undefined;
  }

  return {
    async insertOnce(workspaceId, m, receivedAt, tx) {
      const ex = tx ?? db;
      // INSERT … SELECT from the workspace's own conversation: a conversation of another
      // workspace yields no row to insert.
      const inserted = await ex
        .insertInto('messages')
        .columns([
          'id',
          'workspace_id',
          'conversation_id',
          'telegram_message_id',
          'kind',
          'body',
          'telegram_message',
          'sent_at',
          'received_at',
        ])
        .expression((eb) =>
          eb
            .selectFrom('conversations')
            .select([
              eb.val(m.id).as('id'),
              'workspace_id',
              'id as conversation_id',
              eb.val(String(m.telegramMessageId)).as('telegram_message_id'),
              eb.val(m.kind).as('kind'),
              eb.val(m.body).as('body'),
              sql`${JSON.stringify(m.telegramMessage)}::jsonb`.as('telegram_message'),
              eb.val(m.sentAt).as('sent_at'),
              eb.val(receivedAt).as('received_at'),
            ])
            .where('id', '=', m.conversationId)
            .where('workspace_id', '=', workspaceId),
        )
        .onConflict((oc) => oc.columns(['conversation_id', 'telegram_message_id']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (inserted) return 'captured';
      if (await exists(ex, workspaceId, m.conversationId, m.telegramMessageId)) {
        return 'already_present';
      }
      throw new Error('conversation not found in this workspace');
    },

    async applyEdit(workspaceId, e, tx) {
      const ex = tx ?? db;
      // The SQL form of isLaterEdit (conversations/domain/edit.ts): later edit time, or equal
      // time and a higher update id.
      const updated = await ex
        .updateTable('messages')
        .set({
          body: e.body,
          telegram_message: sql`${JSON.stringify(e.telegramMessage)}::jsonb`,
          edited_at: e.editedAt,
          edit_update_id: String(e.editUpdateId),
        })
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', e.conversationId)
        .where('telegram_message_id', '=', String(e.telegramMessageId))
        // A null body only clears a caption: a text message keeps its text.
        .$if(e.body === null, (qb) => qb.where('kind', '<>', 'text'))
        .where((eb) =>
          eb.or([
            eb('edited_at', 'is', null),
            sql<boolean>`(edited_at, edit_update_id) < (${e.editedAt}, ${String(e.editUpdateId)}::bigint)`,
          ]),
        )
        .executeTakeFirst();
      if (updated.numUpdatedRows > 0n) return 'applied';
      return (await exists(ex, workspaceId, e.conversationId, e.telegramMessageId))
        ? 'not_later'
        : 'not_found';
    },

    async findId(workspaceId, conversationId, telegramMessageId, tx) {
      const row = await (tx ?? db)
        .selectFrom('messages')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('telegram_message_id', '=', String(telegramMessageId))
        .executeTakeFirst();
      return row?.id ?? null;
    },

    async newestReceivedAt(workspaceId, tx) {
      const row = await newestReceivedAtQuery(tx ?? db, workspaceId).executeTakeFirst();
      return row?.newest ? new Date(row.newest) : null;
    },
  };
}
