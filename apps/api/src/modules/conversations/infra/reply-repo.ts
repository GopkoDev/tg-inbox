import { sql, type Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { Replies } from '../../../platform/db.types.gen.js';
import type { ReplyRepo, ReplyStateValue, ReplyView } from '../app/ports.js';

type ReplyRow = Selectable<Replies>;

export function toReplyView(row: ReplyRow): ReplyView {
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

export function createReplyRepo(db: Db): ReplyRepo {
  return {
    async findByClientKey(workspaceId, conversationId, clientKey, tx) {
      const row = await (tx ?? db)
        .selectFrom('replies')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('client_key', '=', clientKey)
        .executeTakeFirst();
      return row ? toReplyView(row) : null;
    },

    async findForUpdate(workspaceId, conversationId, replyId, tx) {
      const row = await (tx ?? db)
        .selectFrom('replies')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('id', '=', replyId)
        .forUpdate()
        .executeTakeFirst();
      return row ? toReplyView(row) : null;
    },

    async lockAndCountAttempts(workspaceId, accountId, since, tx) {
      const exec = tx ?? db;
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${accountId}`}, 0))`.execute(
        exec,
      );
      const row = await exec
        .selectFrom('reply_attempts')
        .select([
          sql<number>`count(*)::int`.as('n'),
          sql<Date | null>`min(created_at)`.as('oldest'),
        ])
        .where('workspace_id', '=', workspaceId)
        .where('initiated_by_account_id', '=', accountId)
        .where('created_at', '>', since)
        .executeTakeFirstOrThrow();
      return { count: row.n, oldest: row.oldest };
    },

    async newestTeammateReply(workspaceId, conversationId, accountId, afterReplyId, tx) {
      const exec = tx ?? db;
      const seen = afterReplyId
        ? await exec
            .selectFrom('replies')
            .select(['position_at', 'id'])
            .where('workspace_id', '=', workspaceId)
            .where('conversation_id', '=', conversationId)
            .where('id', '=', afterReplyId)
            .executeTakeFirst()
        : undefined;
      let query = exec
        .selectFrom('replies')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('author_account_id', '<>', accountId);
      if (seen) {
        query = query.where(sql<boolean>`(position_at, id) > (${seen.position_at}, ${seen.id})`);
      }
      const row = await query
        .orderBy('position_at', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();
      return row ? toReplyView(row) : null;
    },

    async insert(workspaceId, reply, tx) {
      const exec = tx ?? db;
      // Selecting from `conversations` keeps the row in the conversation's own workspace.
      const inserted = await exec
        .insertInto('replies')
        .columns([
          'id',
          'workspace_id',
          'conversation_id',
          'author_account_id',
          'client_key',
          'body',
          'state',
          'position_at',
          'created_at',
        ])
        .expression((eb) =>
          eb
            .selectFrom('conversations')
            .select([
              eb.val(reply.id).as('id'),
              'workspace_id',
              'id as conversation_id',
              eb.val(reply.authorAccountId).as('author_account_id'),
              eb.val(reply.clientKey).as('client_key'),
              eb.val(reply.body).as('body'),
              eb.val('sending').as('state'),
              eb.val(reply.positionAt).as('position_at'),
              eb.val(reply.positionAt).as('created_at'),
            ])
            .where('workspace_id', '=', workspaceId)
            .where('id', '=', reply.conversationId),
        )
        .onConflict((oc) => oc.columns(['conversation_id', 'client_key']).doNothing())
        .returningAll()
        .executeTakeFirst();
      return inserted ? toReplyView(inserted) : null;
    },

    async insertAttempt(workspaceId, attempt, tx) {
      await (tx ?? db)
        .insertInto('reply_attempts')
        .values({
          id: attempt.id,
          workspace_id: workspaceId,
          conversation_id: attempt.conversationId,
          reply_id: attempt.replyId,
          kind: attempt.kind,
          initiated_by_account_id: attempt.initiatedByAccountId,
          created_at: attempt.createdAt,
        })
        .execute();
    },

    async requeue(workspaceId, conversationId, replyId, positionAt, tx) {
      const row = await (tx ?? db)
        .updateTable('replies')
        .set({ state: 'sending', failure_reason: null, position_at: positionAt })
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('id', '=', replyId)
        .where('state', 'in', ['not_delivered', 'not_confirmed'])
        .returningAll()
        .executeTakeFirst();
      return row ? toReplyView(row) : null;
    },
  };
}
