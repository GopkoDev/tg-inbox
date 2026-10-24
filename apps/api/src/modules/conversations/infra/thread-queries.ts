import { sql, type Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type {
  BroadcastItems,
  ConversationActivities,
  Messages,
  Replies,
} from '../../../platform/db.types.gen.js';
import { toBroadcastItem } from './broadcast-item-repo.js';
import { isMessageKind, type MessageKind } from '../domain/message.js';
import { mediaFileOf, projectMessage } from '../domain/projection.js';
import { compareThreadPosition, type ThreadPosition } from '../domain/thread.js';
import type {
  ActivityView,
  MessageView,
  ReplyStateValue,
  ReplyView,
  ThreadEntry,
  ThreadReads,
} from '../app/ports.js';

type MessageRow = Selectable<Messages>;
type ReplyRow = Selectable<Replies>;
type ActivityRow = Selectable<ConversationActivities>;

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

function toActivity(row: ActivityRow): ActivityView {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    kind: row.kind as ActivityView['kind'],
    cause: row.cause as ActivityView['cause'],
    actorAccountId: row.actor_account_id,
    previousAssigneeAccountId: row.previous_assignee_account_id,
    newAssigneeAccountId: row.new_assignee_account_id,
    positionAt: row.position_at,
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

const broadcastEntry = (row: Selectable<BroadcastItems>): ThreadEntry => ({
  type: 'broadcast',
  position: { positionAt: row.position_at, kind: 'broadcast', id: row.id },
  broadcastItem: toBroadcastItem(row),
});

const activityEntry = (row: ActivityRow): ThreadEntry => ({
  type: 'activity',
  position: { positionAt: row.position_at, kind: 'activity', id: row.id },
  activity: toActivity(row),
});

/**
 * Keyset conditions of "strictly before / after the cursor" on each part of the union. Within the
 * same instant a message precedes a reply, a reply an activity entry and an activity entry a
 * broadcast item (compareThreadPosition), so the parts differ at that instant.
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
  if (c.kind === 'activity' || c.kind === 'broadcast') {
    // a reply precedes an activity entry and a broadcast item of the same instant
    return dir === 'before'
      ? sql<boolean>`position_at <= ${c.positionAt}::timestamptz`
      : sql<boolean>`position_at > ${c.positionAt}::timestamptz`;
  }
  return dir === 'before'
    ? sql<boolean>`position_at < ${c.positionAt}::timestamptz`
    : sql<boolean>`position_at >= ${c.positionAt}::timestamptz`;
}

function activityCondition(c: ThreadPosition, dir: 'before' | 'after') {
  if (c.kind === 'activity') {
    const op = dir === 'before' ? sql`<` : sql`>`;
    return sql<boolean>`(position_at, id) ${op} (${c.positionAt}::timestamptz, ${c.id}::uuid)`;
  }
  if (c.kind === 'broadcast') {
    // an activity entry precedes a broadcast item of the same instant
    return dir === 'before'
      ? sql<boolean>`position_at <= ${c.positionAt}::timestamptz`
      : sql<boolean>`position_at > ${c.positionAt}::timestamptz`;
  }
  // an activity entry follows a message and a reply of the same instant
  return dir === 'before'
    ? sql<boolean>`position_at < ${c.positionAt}::timestamptz`
    : sql<boolean>`position_at >= ${c.positionAt}::timestamptz`;
}

function broadcastCondition(c: ThreadPosition, dir: 'before' | 'after') {
  if (c.kind === 'broadcast') {
    const op = dir === 'before' ? sql`<` : sql`>`;
    return sql<boolean>`(position_at, id) ${op} (${c.positionAt}::timestamptz, ${c.id}::uuid)`;
  }
  // a broadcast item follows every other kind of the same instant (ADR-0010)
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
          let activities = trx
            .selectFrom('conversation_activities')
            .selectAll()
            .where('workspace_id', '=', workspaceId)
            .where('conversation_id', '=', conversationId);
          // The fourth keyset part (ADR-0010) on broadcast_items_conversation_position_at_idx.
          let broadcastItems = trx
            .selectFrom('broadcast_items')
            .selectAll()
            .where('workspace_id', '=', workspaceId)
            .where('conversation_id', '=', conversationId);
          if (cursor) {
            const dir = newer ? 'after' : 'before';
            messages = messages.where(messageCondition(cursor, dir));
            replies = replies.where(replyCondition(cursor, dir));
            activities = activities.where(activityCondition(cursor, dir));
            broadcastItems = broadcastItems.where(broadcastCondition(cursor, dir));
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
          const [messageRows, replyRows, activityRows, broadcastRows, newest] = await Promise.all([
            messages
              .orderBy('sent_at', order)
              .orderBy('telegram_message_id', order)
              .limit(take)
              .execute(),
            replies.orderBy('position_at', order).orderBy('id', order).limit(take).execute(),
            activities.orderBy('position_at', order).orderBy('id', order).limit(take).execute(),
            broadcastItems.orderBy('position_at', order).orderBy('id', order).limit(take).execute(),
            newestReply,
          ]);

          const merged = [
            ...messageRows.map(messageEntry),
            ...replyRows.map(replyEntry),
            ...activityRows.map(activityEntry),
            ...broadcastRows.map(broadcastEntry),
          ].sort((a, b) =>
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

    async activity(workspaceId, conversationId, activityId) {
      const row = await db
        .selectFrom('conversation_activities')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('id', '=', activityId)
        .executeTakeFirst();
      return row ? toActivity(row) : null;
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
