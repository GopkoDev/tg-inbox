import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { TAG_HISTORY_PAGE_SIZE } from '../domain/tags.js';
import type { TagHistoryRepo, TagHistoryRow } from '../app/ports.js';

export function createTagHistoryRepo(db: Db): TagHistoryRepo {
  return {
    async append(entry, tx) {
      const id = newId();
      await (tx ?? db)
        .insertInto('contact_tag_history')
        .values({
          id,
          workspace_id: entry.workspaceId,
          contact_id: entry.contactId,
          tag_id: entry.tagId,
          tag_name: entry.tagName,
          kind: entry.kind,
          merged_into_tag_id: null,
          merged_into_name: null,
          actor_account_id: entry.actorAccountId,
          source: entry.source,
          created_at: entry.createdAt,
        })
        .execute();
      return id;
    },

    async page(workspaceId, contactId, after, tx) {
      let q = (tx ?? db)
        .selectFrom('contact_tag_history')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('contact_id', '=', contactId);
      if (after) {
        // Row-value keyset on (created_at, id), the order of the index.
        q = q.where(sql<boolean>`(created_at, id) < (${after.createdAt}, ${after.id})`);
      }
      const rows = await q
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(TAG_HISTORY_PAGE_SIZE + 1)
        .execute();
      const entries = rows.slice(0, TAG_HISTORY_PAGE_SIZE).map((r): TagHistoryRow => ({
        id: r.id,
        tagId: r.tag_id,
        tagName: r.tag_name,
        kind: r.kind as TagHistoryRow['kind'],
        mergedInto:
          r.merged_into_tag_id !== null && r.merged_into_name !== null
            ? { tagId: r.merged_into_tag_id, name: r.merged_into_name }
            : null,
        actorAccountId: r.actor_account_id,
        source: r.source as TagHistoryRow['source'],
        createdAt: r.created_at,
      }));
      return { entries, hasNext: rows.length > TAG_HISTORY_PAGE_SIZE };
    },

    async memberChangesSince(workspaceId, accountId, since, tx) {
      // `kind IN (...)` matches the rate-limit index key, so an owner's merge entries are skipped.
      const row = await (tx ?? db)
        .selectFrom('contact_tag_history')
        .select([
          (eb) => eb.fn.countAll<string>().as('n'),
          (eb) => eb.fn.min<Date>('created_at').as('oldest'),
        ])
        .where('workspace_id', '=', workspaceId)
        .where('actor_account_id', '=', accountId)
        .where('kind', 'in', ['added', 'removed'])
        .where('created_at', '>', since)
        .executeTakeFirstOrThrow();
      return { count: Number(row.n), oldestAt: row.oldest };
    },

    async lockMemberChanges(workspaceId, accountId, tx) {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`tag-changes:${workspaceId}:${accountId}`}, 0))`.execute(
        tx,
      );
    },
  };
}
