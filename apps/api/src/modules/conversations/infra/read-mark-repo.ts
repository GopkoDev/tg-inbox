import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import type { ReadMarkRepo } from '../app/ports.js';
import { raise, unreadFloor } from '../domain/read-state.js';

export function createReadMarkRepo(db: Db): ReadMarkRepo {
  return {
    async markRead(workspaceId, input, tx) {
      const exec = tx ?? db;
      const conversation = await exec
        .selectFrom('conversations')
        .select('last_message_received_at')
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', input.conversationId)
        .executeTakeFirst();
      if (!conversation) return null;
      const current = await exec
        .selectFrom('read_marks')
        .select('read_through_at')
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', input.conversationId)
        .where('account_id', '=', input.accountId)
        .executeTakeFirst();
      const target = raise(
        current?.read_through_at ?? null,
        input.proposed,
        conversation.last_message_received_at,
      );
      // GREATEST keeps the watermark monotonic even when two requests race.
      const written = await exec
        .insertInto('read_marks')
        .values({
          id: newId(),
          workspace_id: workspaceId,
          conversation_id: input.conversationId,
          account_id: input.accountId,
          read_through_at: target,
          created_at: input.now,
        })
        .onConflict((oc) =>
          oc.columns(['conversation_id', 'account_id']).doUpdateSet({
            read_through_at: sql`GREATEST(read_marks.read_through_at, excluded.read_through_at)`,
          }),
        )
        .returning('read_through_at')
        .executeTakeFirstOrThrow();
      const floor = unreadFloor(written.read_through_at, input.activeSince);
      const unread = await exec
        .selectFrom('messages')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', input.conversationId)
        .where('received_at', '>', floor)
        .executeTakeFirstOrThrow();
      return { readThroughAt: written.read_through_at, unreadCount: unread.n };
    },
  };
}
