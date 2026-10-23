import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { AudienceTagKind } from '../domain/audience.js';
import type { AudienceTagRepo } from '../app/ports.js';

/** `broadcast_audience_tags`: the chosen and left-out tags of a tag audience (no FK to tags). */
export function createAudienceTagRepo(db: Db): AudienceTagRepo {
  return {
    async list(workspaceId, broadcastId, tx) {
      const rows = await (tx ?? db)
        .selectFrom('broadcast_audience_tags')
        .select(['tag_id', 'tag_name', 'kind'])
        .where('workspace_id', '=', workspaceId)
        .where('broadcast_id', '=', broadcastId)
        .orderBy('kind')
        .orderBy('tag_name')
        .orderBy('tag_id')
        .execute();
      return rows.map((r) => ({
        tagId: r.tag_id,
        name: r.tag_name,
        kind: r.kind as AudienceTagKind,
      }));
    },

    async replace(workspaceId, broadcastId, rows, tx) {
      await tx
        .deleteFrom('broadcast_audience_tags')
        .where('workspace_id', '=', workspaceId)
        .where('broadcast_id', '=', broadcastId)
        .execute();
      if (rows.length === 0) return;
      await tx
        .insertInto('broadcast_audience_tags')
        .values(
          rows.map((r) => ({
            workspace_id: workspaceId,
            broadcast_id: broadcastId,
            tag_id: r.tagId,
            kind: r.kind,
            tag_name: r.name,
          })),
        )
        .execute();
    },

    async copy(workspaceId, fromId, toId, tx) {
      await tx
        .insertInto('broadcast_audience_tags')
        .columns(['workspace_id', 'broadcast_id', 'tag_id', 'kind', 'tag_name'])
        .expression((eb) =>
          eb
            .selectFrom('broadcast_audience_tags')
            .select([
              'workspace_id',
              sql<string>`${toId}::uuid`.as('broadcast_id'),
              'tag_id',
              'kind',
              'tag_name',
            ])
            .where('workspace_id', '=', workspaceId)
            .where('broadcast_id', '=', fromId),
        )
        .execute();
    },
  };
}
