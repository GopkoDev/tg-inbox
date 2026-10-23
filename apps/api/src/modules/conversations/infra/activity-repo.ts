import { sql, type Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { DB } from '../../../platform/db.types.gen.js';
import type { ActivityCause, ActivityKind } from '../domain/activity.js';
import type { ActivityRepo, ActivityView } from '../app/ports.js';

type Row = Selectable<DB['conversation_activities']>;

function toView(row: Row): ActivityView {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    kind: row.kind as ActivityKind,
    cause: row.cause as ActivityCause,
    actorAccountId: row.actor_account_id,
    previousAssigneeAccountId: row.previous_assignee_account_id,
    newAssigneeAccountId: row.new_assignee_account_id,
    positionAt: row.position_at,
    createdAt: row.created_at,
  };
}

export function createActivityRepo(db: Db): ActivityRepo {
  return {
    async insert(workspaceId, a, tx) {
      // Selecting from `conversations` keeps the entry in the conversation's own workspace: a
      // conversation of another workspace inserts nothing.
      await (tx ?? db)
        .insertInto('conversation_activities')
        .columns([
          'id',
          'workspace_id',
          'conversation_id',
          'kind',
          'cause',
          'actor_account_id',
          'previous_assignee_account_id',
          'new_assignee_account_id',
          'position_at',
          'created_at',
        ])
        .expression((eb) =>
          eb
            .selectFrom('conversations')
            .select([
              eb.val(a.id).as('id'),
              'workspace_id',
              'id as conversation_id',
              eb.val(a.kind).as('kind'),
              eb.val(a.cause).as('cause'),
              eb.val(a.actorAccountId).as('actor_account_id'),
              eb.val(a.previousAssigneeAccountId).as('previous_assignee_account_id'),
              eb.val(a.newAssigneeAccountId).as('new_assignee_account_id'),
              eb.val(a.positionAt).as('position_at'),
              eb.val(a.createdAt).as('created_at'),
            ])
            .where('workspace_id', '=', workspaceId)
            .where('id', '=', a.conversationId),
        )
        .execute();
    },

    async latestFor(workspaceId, conversationId, tx) {
      const row = await (tx ?? db)
        .selectFrom('conversation_activities')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('conversation_id', '=', conversationId)
        .orderBy('position_at', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();
      return row ? toView(row) : null;
    },

    async byId(workspaceId, activityId, tx) {
      const row = await (tx ?? db)
        .selectFrom('conversation_activities')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', activityId)
        .executeTakeFirst();
      return row ? toView(row) : null;
    },

    async countByActorSince(workspaceId, accountId, since, tx) {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`changes:${workspaceId}:${accountId}`}, 0))`.execute(
        tx,
      );
      const row = await tx
        .selectFrom('conversation_activities')
        .select([
          sql<number>`count(*)::int`.as('n'),
          sql<Date | null>`min(created_at)`.as('oldest'),
        ])
        .where('workspace_id', '=', workspaceId)
        .where('actor_account_id', '=', accountId)
        .where('created_at', '>', since)
        .executeTakeFirstOrThrow();
      return { count: row.n, oldestCreatedAt: row.oldest };
    },
  };
}
