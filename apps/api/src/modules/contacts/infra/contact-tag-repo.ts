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
  };
}
