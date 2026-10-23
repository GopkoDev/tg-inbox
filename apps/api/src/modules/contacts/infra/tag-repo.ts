import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { Tags } from '../../../platform/db.types.gen.js';
import type { Selectable } from 'kysely';
import type { TagRecord, TagRepo } from '../app/ports.js';

const toRecord = (r: Selectable<Tags>): TagRecord => ({
  id: r.id,
  workspaceId: r.workspace_id,
  name: r.name,
  key: r.name_key,
  createdByAccountId: r.created_by_account_id,
  createdAt: r.created_at,
});

export function createTagRepo(db: Db): TagRepo {
  return {
    async lockWorkspaceTags(workspaceId, tx) {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'tags:' + workspaceId}, 0))`.execute(
        tx,
      );
    },

    async findByKey(workspaceId, key, tx) {
      const row = await (tx ?? db)
        .selectFrom('tags')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('name_key', '=', key)
        .executeTakeFirst();
      return row ? toRecord(row) : null;
    },

    async count(workspaceId, tx) {
      const { n } = await (tx ?? db)
        .selectFrom('tags')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('workspace_id', '=', workspaceId)
        .executeTakeFirstOrThrow();
      return Number(n);
    },

    async insert(workspaceId, tag, tx) {
      const row = await (tx ?? db)
        .insertInto('tags')
        .values({
          id: tag.id,
          workspace_id: workspaceId,
          name: tag.name,
          name_key: tag.key,
          created_by_account_id: tag.createdBy,
          created_at: tag.createdAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toRecord(row);
    },

    async listWithCounts(workspaceId, tx) {
      // At most 100 tags: sorted in the query, ICU dictionary order with the key as tiebreak.
      const rows = await (tx ?? db)
        .selectFrom('tags as t')
        .select([
          't.id',
          't.name',
          (eb) =>
            eb
              .selectFrom('contact_tags as ct')
              .select((e) => e.fn.countAll<string>().as('n'))
              .whereRef('ct.workspace_id', '=', 't.workspace_id')
              .whereRef('ct.tag_id', '=', 't.id')
              .as('n'),
        ])
        .where('t.workspace_id', '=', workspaceId)
        .orderBy(sql`t.name COLLATE "und-x-icu"`)
        .orderBy('t.name_key')
        .execute();
      return rows.map((r) => ({ id: r.id, name: r.name, contactCount: Number(r.n ?? 0) }));
    },

    async countFor(workspaceId, tagId, tx) {
      const { n } = await (tx ?? db)
        .selectFrom('contact_tags')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('workspace_id', '=', workspaceId)
        .where('tag_id', '=', tagId)
        .executeTakeFirstOrThrow();
      return Number(n);
    },

    async resolveIds(workspaceId, ids, tx) {
      if (ids.length === 0) return [];
      const rows = await (tx ?? db)
        .selectFrom('tags')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('id', 'in', [...ids])
        .execute();
      return rows.map((r) => r.id);
    },

    async lockForKeyShare(workspaceId, tagId, tx) {
      const row = await tx
        .selectFrom('tags')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', tagId)
        .forKeyShare()
        .executeTakeFirst();
      return row ? toRecord(row) : null;
    },

    async lockForUpdate(workspaceId, ids, tx) {
      if (ids.length === 0) return [];
      const rows = await tx
        .selectFrom('tags')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('id', 'in', [...ids])
        .orderBy('id')
        .forUpdate()
        .execute();
      return rows.map(toRecord);
    },

    async rename(workspaceId, id, name, key, tx) {
      const result = await (tx ?? db)
        .updateTable('tags')
        .set({ name, name_key: key })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },

    async delete(workspaceId, id, tx) {
      const result = await (tx ?? db)
        .deleteFrom('tags')
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .executeTakeFirst();
      return result.numDeletedRows > 0n;
    },
  };
}
