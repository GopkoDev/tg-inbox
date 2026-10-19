import { sql, type Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { Replies } from '../../../platform/db.types.gen.js';
import type { ReplyRepo, ReplySettlement, ReplyStateValue, ReplyView } from '../app/ports.js';

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

/** `sending` -> a final state; with `idleOnly`, not while an attempt of the reply is in flight. */
async function settle(
  exec: Db,
  workspaceId: string,
  conversationId: string,
  replyId: string,
  settlement: ReplySettlement,
  idleOnly: boolean,
): Promise<ReplyView | null> {
  const values =
    settlement.state === 'sent'
      ? {
          state: 'sent',
          failure_reason: null,
          sent_at: settlement.sentAt,
          telegram_message_id: settlement.telegramMessageId,
        }
      : {
          state: settlement.state,
          failure_reason: settlement.state === 'not_delivered' ? settlement.failureReason : null,
        };
  const row = await exec
    .updateTable('replies')
    .set(values)
    .where('workspace_id', '=', workspaceId)
    .where('conversation_id', '=', conversationId)
    .where('id', '=', replyId)
    .where('state', '=', 'sending')
    .$if(idleOnly, (qb) =>
      qb.where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('reply_attempts')
              .select('reply_attempts.id')
              .where('reply_attempts.workspace_id', '=', workspaceId)
              .where('reply_attempts.reply_id', '=', replyId)
              .where('reply_attempts.started_at', 'is not', null)
              .where('reply_attempts.finished_at', 'is', null),
          ),
        ),
      ),
    )
    .returningAll()
    .executeTakeFirst();
  return row ? toReplyView(row) : null;
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

    async lockDrain(workspaceId, conversationId, tx) {
      // A key space of its own: the member limit lock hashes `${workspace}:${account}`.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`drain:${workspaceId}:${conversationId}`}, 0))`.execute(
        tx,
      );
    },

    async hasNotAcceptedAttempt(workspaceId, conversationId, replyId, since, tx) {
      const row = await (tx ?? db)
        .selectFrom('reply_attempts')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('reply_id', '=', replyId)
        .where('outcome', '=', 'not_accepted')
        .where('created_at', '>=', since)
        .limit(1)
        .executeTakeFirst();
      return row !== undefined;
    },

    async pendingReplies(workspaceId, conversationId, tx) {
      const rows = await (tx ?? db)
        .selectFrom('replies')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('state', '=', 'sending')
        .orderBy('position_at')
        .orderBy('id')
        .execute();
      return rows.map(toReplyView);
    },

    async chatIdOf(workspaceId, conversationId, tx) {
      const row = await (tx ?? db)
        .selectFrom('conversations')
        .select('telegram_chat_id')
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', conversationId)
        .executeTakeFirst();
      return row ? BigInt(row.telegram_chat_id) : null;
    },

    async lastStartedAt(workspaceId, conversationId, tx) {
      const row = await (tx ?? db)
        .selectFrom('reply_attempts')
        .select('started_at')
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('started_at', 'is not', null)
        .orderBy('started_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      return row?.started_at ?? null;
    },

    async startAttempt(workspaceId, conversationId, replyId, attemptId, startedAt, tx) {
      const exec = tx ?? db;
      const reply = await exec
        .selectFrom('replies')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('id', '=', replyId)
        .where('state', '=', 'sending')
        .forUpdate()
        .executeTakeFirst();
      if (!reply) return null;
      // A started attempt without an outcome may have reached Telegram: never start another (ADR-0004).
      const inFlight = await exec
        .selectFrom('reply_attempts')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('reply_id', '=', replyId)
        .where('started_at', 'is not', null)
        .where('finished_at', 'is', null)
        .limit(1)
        .executeTakeFirst();
      if (inFlight) return null;
      const unstarted = await exec
        .updateTable('reply_attempts')
        .set({ started_at: startedAt })
        .where('id', '=', (eb) =>
          eb
            .selectFrom('reply_attempts')
            .select('id')
            .where('workspace_id', '=', workspaceId)
            .where('conversation_id', '=', conversationId)
            .where('reply_id', '=', replyId)
            .where('started_at', 'is', null)
            .where('finished_at', 'is', null)
            .orderBy('created_at')
            .orderBy('id')
            .limit(1),
        )
        .where('workspace_id', '=', workspaceId)
        .returning('id')
        .executeTakeFirst();
      if (unstarted) return unstarted.id;
      await exec
        .insertInto('reply_attempts')
        .values({
          id: attemptId,
          workspace_id: workspaceId,
          conversation_id: conversationId,
          reply_id: replyId,
          kind: 'retry',
          initiated_by_account_id: null,
          created_at: startedAt,
          started_at: startedAt,
        })
        .execute();
      return attemptId;
    },

    async finishAttempt(workspaceId, conversationId, attemptId, outcome, finishedAt, tx) {
      const row = await (tx ?? db)
        .updateTable('reply_attempts')
        .set({ outcome, finished_at: finishedAt })
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('id', '=', attemptId)
        .where('finished_at', 'is', null)
        .returning('reply_id')
        .executeTakeFirst();
      return row ? { replyId: row.reply_id } : null;
    },

    async settleReply(workspaceId, conversationId, replyId, settlement, tx) {
      return settle(tx ?? db, workspaceId, conversationId, replyId, settlement, false);
    },

    async settleIdleReply(workspaceId, conversationId, replyId, settlement, tx) {
      const exec = tx ?? db;
      // The row lock waits for a `startAttempt` holding it; the UPDATE below, a later statement,
      // then sees the attempt it committed (READ COMMITTED takes a snapshot per statement).
      await exec
        .selectFrom('replies')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('id', '=', replyId)
        .forUpdate()
        .executeTakeFirst();
      return settle(exec, workspaceId, conversationId, replyId, settlement, true);
    },

    async raiseReplySent(workspaceId, conversationId, sentAt, tx) {
      // One UPDATE: every right-hand side reads the old row, so activity includes the new sent time itself.
      await (tx ?? db)
        .updateTable('conversations')
        .set({
          last_reply_sent_at: sql`GREATEST(last_reply_sent_at, ${sentAt}::timestamptz)`,
          last_activity_at: sql`GREATEST(last_message_received_at, last_reply_sent_at, ${sentAt}::timestamptz)`,
          // A sent reply ends the waiting period (AC-08). When a customer message arrived after it,
          // the customer is still waiting, but on a new period: it began with the first message after
          // the reply (started by 'message'), so the old period's ledger never mutes the new wait and
          // the team's 30 minutes count from the new message (AC-09). The fallback to the newest
          // arrival only covers a row without its message rows.
          waiting_since: sql`CASE WHEN last_message_received_at > GREATEST(last_reply_sent_at, ${sentAt}::timestamptz)
            THEN COALESCE(
              (SELECT min(m.received_at) FROM messages m
                WHERE m.workspace_id = ${workspaceId} AND m.conversation_id = ${conversationId}
                  AND m.received_at > GREATEST(conversations.last_reply_sent_at, ${sentAt}::timestamptz)),
              last_message_received_at) END`,
          waiting_started_by: sql`CASE WHEN last_message_received_at > GREATEST(last_reply_sent_at, ${sentAt}::timestamptz)
            THEN 'message' END`,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', conversationId)
        .execute();
    },

    async skipAttempt(workspaceId, conversationId, replyId, attemptId, finishedAt, tx) {
      const exec = tx ?? db;
      const closed = await exec
        .updateTable('reply_attempts')
        .set({ outcome: 'skipped', finished_at: finishedAt })
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('reply_id', '=', replyId)
        .where('started_at', 'is', null)
        .where('finished_at', 'is', null)
        .returning('id')
        .execute();
      if (closed.length > 0) return;
      await exec
        .insertInto('reply_attempts')
        .values({
          id: attemptId,
          workspace_id: workspaceId,
          conversation_id: conversationId,
          reply_id: replyId,
          kind: 'retry',
          initiated_by_account_id: null,
          created_at: finishedAt,
          outcome: 'skipped',
          finished_at: finishedAt,
        })
        .execute();
    },

    async oldestInFlightStart(workspaceId, conversationId, tx) {
      const row = await (tx ?? db)
        .selectFrom('reply_attempts')
        .select('started_at')
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('started_at', 'is not', null)
        .where('finished_at', 'is', null)
        .orderBy('started_at')
        .limit(1)
        .executeTakeFirst();
      return row?.started_at ?? null;
    },

    async inFlightAttempts(workspaceId, conversationId, olderThan, tx) {
      let query = (tx ?? db)
        .selectFrom('reply_attempts')
        .select(['id', 'reply_id'])
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .where('started_at', 'is not', null)
        .where('finished_at', 'is', null);
      if (olderThan) query = query.where('started_at', '<', olderThan);
      const rows = await query.orderBy('started_at').forUpdate().execute();
      return rows.map((r) => ({ id: r.id, replyId: r.reply_id }));
    },
  };
}
