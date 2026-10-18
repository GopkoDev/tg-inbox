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
      await (tx ?? db)
        .insertInto('conversation_activities')
        .values({
          id: a.id,
          workspace_id: workspaceId,
          conversation_id: a.conversationId,
          kind: a.kind,
          cause: a.cause,
          actor_account_id: a.actorAccountId,
          previous_assignee_account_id: a.previousAssigneeAccountId,
          new_assignee_account_id: a.newAssigneeAccountId,
          position_at: a.positionAt,
          created_at: a.createdAt,
        })
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
