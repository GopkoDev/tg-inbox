import { sql, type Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { Messages, Replies } from '../../../platform/db.types.gen.js';
import { isMessageKind, type MessageKind } from '../domain/message.js';
import { mediaFileOf, projectMessage } from '../domain/projection.js';
import { compareThreadPosition, type ThreadPosition } from '../domain/thread.js';
import type {
  MessageView,
  ReplyStateValue,
  ReplyView,
  ThreadEntry,
  ThreadReads,
} from '../app/ports.js';

type MessageRow = Selectable<Messages>;
type ReplyRow = Selectable<Replies>;

const kindOf = (row: MessageRow): MessageKind => (isMessageKind(row.kind) ? row.kind : 'other');
const rawOf = (row: MessageRow): Record<string, unknown> =>
  typeof row.telegram_message === 'object' && row.telegram_message !== null
    ? (row.telegram_message as Record<string, unknown>)
    : {};

function toMessage(row: MessageRow): MessageView {
  const kind = kindOf(row);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    kind,
    body: row.body,
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    editedAt: row.edited_at,
    ...projectMessage(kind, rawOf(row)),
  };
}

function toReply(row: ReplyRow): ReplyView {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    clientKey: row.client_key,
    body: row.body,
    authorAccountId: row.author_account_id,
    state: row.state as ReplyStateValue,
    failureReason: row.failure_reason,
    positionAt: row.position_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

const messageEntry = (row: MessageRow): ThreadEntry => ({
  type: 'message',
  position: { positionAt: row.sent_at, kind: 'message', id: BigInt(row.telegram_message_id) },
  message: toMessage(row),
});

const replyEntry = (row: ReplyRow): ThreadEntry => ({
  type: 'reply',
  position: { positionAt: row.position_at, kind: 'reply', id: row.id },
  reply: toReply(row),
});

/**
 * Keyset conditions of "strictly before / after the cursor" on each half of the union. Within the same
 * instant a message precedes a reply (compareThreadPosition), so the halves differ at that instant.
 */
function messageCondition(c: ThreadPosition, dir: 'before' | 'after') {
  if (c.kind === 'message') {
    const op = dir === 'before' ? sql`<` : sql`>`;
    return sql<boolean>`(sent_at, telegram_message_id) ${op} (${c.positionAt}::timestamptz, ${String(c.id)}::bigint)`;
  }
  return dir === 'before'
    ? sql<boolean>`sent_at <= ${c.positionAt}::timestamptz`
    : sql<boolean>`sent_at > ${c.positionAt}::timestamptz`;
}

function replyCondition(c: ThreadPosition, dir: 'before' | 'after') {
  if (c.kind === 'reply') {
    const op = dir === 'before' ? sql`<` : sql`>`;
    return sql<boolean>`(position_at, id) ${op} (${c.positionAt}::timestamptz, ${c.id}::uuid)`;
  }
  return dir === 'before'
    ? sql<boolean>`position_at < ${c.positionAt}::timestamptz`
    : sql<boolean>`position_at >= ${c.positionAt}::timestamptz`;
}

export function createThreadQueries(db: Db): ThreadReads {
  async function findMessage(workspaceId: string, conversationId: string, messageId: string) {
    return db
      .selectFrom('messages')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('conversation_id', '=', conversationId)
      .where('id', '=', messageId)
      .executeTakeFirst();
  }

  return {
    page(workspaceId, conversationId, q) {
      // One snapshot, so read_through_at agrees with the items shown (ADR-0005).
      return db
        .transaction()
        .setIsolationLevel('repeatable read')
        .execute(async (trx) => {
          const conversation = await trx
            .selectFrom('conversations')
            .select('last_message_received_at')
            .where('workspace_id', '=', workspaceId)
            .where('id', '=', conversationId)
            .executeTakeFirst();
          if (!conversation) return null;

          const newer = q.after !== null;
          const cursor = q.after ?? q.before;
          const take = q.limit + 1;

          let messages = trx
            .selectFrom('messages')
            .selectAll()
            .where('workspace_id', '=', workspaceId)
            .where('conversation_id', '=', conversationId);
          let replies = trx
            .selectFrom('replies')
            .selectAll()
            .where('workspace_id', '=', workspaceId)
            .where('conversation_id', '=', conversationId);
          if (cursor) {
            const dir = newer ? 'after' : 'before';
            messages = messages.where(messageCondition(cursor, dir));
            replies = replies.where(replyCondition(cursor, dir));
          }
          const order = newer ? 'asc' : 'desc';
          const newestReply = trx
            .selectFrom('replies')
            .select('id')
            .where('workspace_id', '=', workspaceId)
            .where('conversation_id', '=', conversationId)
            .orderBy('position_at', 'desc')
            .orderBy('id', 'desc')
            .limit(1)
            .executeTakeFirst();
          const [messageRows, replyRows, newest] = await Promise.all([
            messages
              .orderBy('sent_at', order)
              .orderBy('telegram_message_id', order)
              .limit(take)
              .execute(),
            replies.orderBy('position_at', order).orderBy('id', order).limit(take).execute(),
            newestReply,
          ]);

          const merged = [...messageRows.map(messageEntry), ...replyRows.map(replyEntry)].sort(
            (a, b) =>
              newer
                ? compareThreadPosition(a.position, b.position)
                : compareThreadPosition(b.position, a.position),
          );
          const more = merged.length > q.limit;
          const entries = merged.slice(0, q.limit);
          if (!newer) entries.reverse();

          return {
            entries,
            // A cursor means the item it names exists on the other side.
            hasPrev: newer ? true : more,
            hasNext: newer ? more : cursor !== null,
            readThroughAt: cursor === null ? conversation.last_message_received_at : null,
            newestReplyId: newest?.id ?? null,
          };
        });
    },

    async message(workspaceId, conversationId, messageId) {
      const row = await findMessage(workspaceId, conversationId, messageId);
      return row ? toMessage(row) : null;
    },

    async reply(workspaceId, conversationId, replyId) {
      const row = await db
        .selectFrom('replies')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('id', '=', replyId)
        .executeTakeFirst();
      return row ? toReply(row) : null;
    },

    async mediaReference(workspaceId, conversationId, messageId) {
      const row = await findMessage(workspaceId, conversationId, messageId);
      if (!row) return null;
      const kind = kindOf(row);
      const file = mediaFileOf(kind, rawOf(row));
      return file ? { ...file, kind } : null;
    },
  };
}
