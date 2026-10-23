import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { ContactTagRepo } from '../app/ports.js';

export function createContactTagRepo(db: Db): ContactTagRepo {
  return {
    async tagsOf(workspaceId, contactId, tx) {
      const rows = await (tx ?? db)
        .selectFrom('contact_tags as ct')
        .innerJoin('tags as t', (j) =>
          j.onRef('t.workspace_id', '=', 'ct.workspace_id').onRef('t.id', '=', 'ct.tag_id'),
        )
        .select(['ct.tag_id', 't.name', 'ct.added_by_account_id', 'ct.added_at'])
        .where('ct.workspace_id', '=', workspaceId)
        .where('ct.contact_id', '=', contactId)
        .orderBy(sql`t.name COLLATE "und-x-icu"`)
        .orderBy('t.name_key')
        .execute();
      return rows.map((r) => ({
        tagId: r.tag_id,
        name: r.name,
        addedByAccountId: r.added_by_account_id,
        addedAt: r.added_at,
      }));
    },

    async tagsOfMany(workspaceId, contactIds, tx) {
      const byContact = new Map<string, { id: string; name: string }[]>();
      if (contactIds.length === 0) return byContact;
      const rows = await (tx ?? db)
        .selectFrom('contact_tags as ct')
        .innerJoin('tags as t', (j) =>
          j.onRef('t.workspace_id', '=', 'ct.workspace_id').onRef('t.id', '=', 'ct.tag_id'),
        )
        .select(['ct.contact_id', 't.id', 't.name'])
        .where('ct.workspace_id', '=', workspaceId)
        .where('ct.contact_id', 'in', [...contactIds])
        .orderBy(sql`t.name COLLATE "und-x-icu"`)
        .orderBy('t.name_key')
        .execute();
      for (const r of rows) {
        const list = byContact.get(r.contact_id) ?? [];
        list.push({ id: r.id, name: r.name });
        byContact.set(r.contact_id, list);
      }
      return byContact;
    },

    async carries(workspaceId, contactId, tagId, tx) {
      const row = await (tx ?? db)
        .selectFrom('contact_tags')
        .select('tag_id')
        .where('workspace_id', '=', workspaceId)
        .where('contact_id', '=', contactId)
        .where('tag_id', '=', tagId)
        .executeTakeFirst();
      return row !== undefined;
    },

    async countFor(workspaceId, contactId, tx) {
      const { n } = await (tx ?? db)
        .selectFrom('contact_tags')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('workspace_id', '=', workspaceId)
        .where('contact_id', '=', contactId)
        .executeTakeFirstOrThrow();
      return Number(n);
    },

    async insert(link, tx) {
      await (tx ?? db)
        .insertInto('contact_tags')
        .values({
          workspace_id: link.workspaceId,
          contact_id: link.contactId,
          tag_id: link.tagId,
          added_by_account_id: link.addedByAccountId,
          added_at: link.addedAt,
        })
        .execute();
    },

    async delete(workspaceId, contactId, tagId, tx) {
      const result = await (tx ?? db)
        .deleteFrom('contact_tags')
        .where('workspace_id', '=', workspaceId)
        .where('contact_id', '=', contactId)
        .where('tag_id', '=', tagId)
        .executeTakeFirst();
      return result.numDeletedRows > 0n;
    },

    async mergeInto(workspaceId, fromTagId, toTagId, tx) {
      if (fromTagId === toTagId) throw new Error('mergeInto: a tag cannot be merged into itself');
      // 0. Lock the links of both tags. A member removal in flight is waited for and its row is
      //    skipped; member adds of either tag already wait on the tag rows locked by the caller, so
      //    from here on the set of links the merge works on is fixed (ADR-0004, step 5).
      const locked = await sql<{ tag_id: string }>`
        SELECT tag_id FROM contact_tags
        WHERE workspace_id = ${workspaceId} AND tag_id IN (${fromTagId}, ${toTagId})
        ORDER BY contact_id, tag_id
        FOR UPDATE`.execute(tx);
      if (!locked.rows.some((r) => r.tag_id === fromTagId)) return [];
      // 1. Contacts that carry both: the target link takes the strictly earlier addition.
      await sql`
        UPDATE contact_tags AS t
        SET added_at = f.added_at, added_by_account_id = f.added_by_account_id
        FROM contact_tags AS f
        WHERE t.workspace_id = ${workspaceId} AND t.tag_id = ${toTagId}
          AND f.workspace_id = t.workspace_id AND f.tag_id = ${fromTagId}
          AND f.contact_id = t.contact_id AND f.added_at < t.added_at`.execute(tx);
      // 2. ...and their now-duplicate links of the merged tag go.
      const dropped = await sql<{ contact_id: string }>`
        DELETE FROM contact_tags AS f
        WHERE f.workspace_id = ${workspaceId} AND f.tag_id = ${fromTagId}
          AND EXISTS (
            SELECT 1 FROM contact_tags AS t
            WHERE t.workspace_id = f.workspace_id AND t.tag_id = ${toTagId}
              AND t.contact_id = f.contact_id)
        RETURNING f.contact_id`.execute(tx);
      // 3. The rest move to the target with their adder and time.
      const moved = await sql<{ contact_id: string }>`
        UPDATE contact_tags SET tag_id = ${toTagId}
        WHERE workspace_id = ${workspaceId} AND tag_id = ${fromTagId}
        RETURNING contact_id`.execute(tx);
      // The carriers are the links actually merged, not a read taken before the writes.
      return [...dropped.rows, ...moved.rows].map((r) => r.contact_id);
    },

    async deleteLinksReturning(workspaceId, tagId, tx) {
      const rows = await tx
        .deleteFrom('contact_tags')
        .where('workspace_id', '=', workspaceId)
        .where('tag_id', '=', tagId)
        .returning('contact_id')
        .execute();
      return rows.map((r) => r.contact_id);
    },
  };
}
