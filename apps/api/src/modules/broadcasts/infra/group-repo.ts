import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { GroupRepo } from '../app/ports.js';

/**
 * `broadcast_group_contacts`: commutative set writes outside the draft version (ADR-0005) — an add
 * is `ON CONFLICT DO NOTHING`, a remove deletes one row by key.
 */
export function createGroupRepo(db: Db): GroupRepo {
  const ofGroup = (ex: Db, workspaceId: string, broadcastId: string) =>
    ex
      .selectFrom('broadcast_group_contacts')
      .where('workspace_id', '=', workspaceId)
      .where('broadcast_id', '=', broadcastId);

  return {
    async add(workspaceId, broadcastId, contactId, actorAccountId, at, tx) {
      const row = await (tx ?? db)
        .insertInto('broadcast_group_contacts')
        .values({
          workspace_id: workspaceId,
          broadcast_id: broadcastId,
          contact_id: contactId,
          added_by_account_id: actorAccountId,
          added_at: at,
        })
        .onConflict((oc) => oc.columns(['workspace_id', 'broadcast_id', 'contact_id']).doNothing())
        .returning('contact_id')
        .executeTakeFirst();
      return row !== undefined;
    },

    async addMany(workspaceId, broadcastId, contactIds, actorAccountId, at, tx) {
      if (contactIds.length === 0) return 0;
      const rows = await (tx ?? db)
        .insertInto('broadcast_group_contacts')
        .values(
          contactIds.map((contactId) => ({
            workspace_id: workspaceId,
            broadcast_id: broadcastId,
            contact_id: contactId,
            added_by_account_id: actorAccountId,
            added_at: at,
          })),
        )
        .onConflict((oc) => oc.columns(['workspace_id', 'broadcast_id', 'contact_id']).doNothing())
        .returning('contact_id')
        .execute();
      return rows.length;
    },

    async removeAll(workspaceId, broadcastId, tx) {
      const result = await tx
        .deleteFrom('broadcast_group_contacts')
        .where('workspace_id', '=', workspaceId)
        .where('broadcast_id', '=', broadcastId)
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },

    async remove(workspaceId, broadcastId, contactId, tx) {
      const result = await (tx ?? db)
        .deleteFrom('broadcast_group_contacts')
        .where('workspace_id', '=', workspaceId)
        .where('broadcast_id', '=', broadcastId)
        .where('contact_id', '=', contactId)
        .executeTakeFirst();
      return result.numDeletedRows > 0n;
    },

    async membership(workspaceId, broadcastId, contactIds, tx) {
      if (contactIds.length === 0) return [];
      const rows = await ofGroup(tx ?? db, workspaceId, broadcastId)
        .select('contact_id')
        .where('contact_id', 'in', [...contactIds])
        .execute();
      return rows.map((r) => r.contact_id);
    },

    async count(workspaceId, broadcastId, tx) {
      const { n } = await ofGroup(tx ?? db, workspaceId, broadcastId)
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow();
      return Number(n);
    },

    async ids(workspaceId, broadcastId, tx) {
      const rows = await ofGroup(tx ?? db, workspaceId, broadcastId)
        .select('contact_id')
        .orderBy('contact_id')
        .execute();
      return rows.map((r) => r.contact_id);
    },

    async page(workspaceId, broadcastId, after, limit) {
      let q = ofGroup(db, workspaceId, broadcastId).select([
        'contact_id',
        'added_by_account_id',
        'added_at',
      ]);
      if (after) {
        q = q.where(
          sql<boolean>`(added_at, contact_id) < (${after.addedAt}::timestamptz, ${after.contactId}::uuid)`,
        );
      }
      const rows = await q
        .orderBy('added_at', 'desc')
        .orderBy('contact_id', 'desc')
        .limit(limit + 1)
        .execute();
      return {
        rows: rows.slice(0, limit).map((r) => ({
          contactId: r.contact_id,
          addedByAccountId: r.added_by_account_id,
          addedAt: r.added_at,
        })),
        hasNext: rows.length > limit,
      };
    },
  };
}
