import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { normalizeSearchQuery, type ContactRepo } from '../app/ports.js';

export function createContactRepo(db: Db): ContactRepo {
  return {
    async upsertFromProfile(workspaceId, profile, seenAt, now, tx) {
      const ex = tx ?? db;
      // The guarded DO UPDATE is the SQL form of shouldRefreshProfile (contacts/domain/profile.ts).
      const row = await ex
        .insertInto('contacts')
        .values({
          id: newId(),
          workspace_id: workspaceId,
          telegram_user_id: profile.telegramUserId,
          first_name: profile.firstName,
          last_name: profile.lastName,
          username: profile.username,
          language_code: profile.languageCode,
          profile_seen_at: seenAt,
          created_at: now,
        })
        .onConflict((oc) =>
          oc
            .columns(['workspace_id', 'telegram_user_id'])
            .doUpdateSet((eb) => ({
              first_name: eb.ref('excluded.first_name'),
              last_name: eb.ref('excluded.last_name'),
              username: eb.ref('excluded.username'),
              language_code: eb.ref('excluded.language_code'),
              profile_seen_at: eb.ref('excluded.profile_seen_at'),
            }))
            .where('contacts.profile_seen_at', '<', (eb) => eb.ref('excluded.profile_seen_at')),
        )
        // xmax = 0 only on a freshly inserted row version.
        .returning(['id', sql<boolean>`(xmax = 0)`.as('created')])
        .executeTakeFirst();
      if (row) return { contactId: row.id, created: row.created };

      // The stored profile is as new or newer: nothing changed, read the id.
      const existing = await ex
        .selectFrom('contacts')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('telegram_user_id', '=', String(profile.telegramUserId))
        .executeTakeFirstOrThrow();
      return { contactId: existing.id, created: false };
    },

    async count(workspaceId, tx) {
      const { n } = await (tx ?? db)
        .selectFrom('contacts')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('workspace_id', '=', workspaceId)
        .executeTakeFirstOrThrow();
      return Number(n);
    },

    async searchContactIds(workspaceId, query) {
      const q = normalizeSearchQuery(query);
      if (q === null) return null;
      // Escape the LIKE metacharacters so the text is matched literally; Postgres lower() folds
      // case for Cyrillic and Latin alike.
      const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      const rows = await db
        .selectFrom('contacts')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where(
          sql<boolean>`(lower(first_name || ' ' || coalesce(last_name, '')) like lower(${pattern})
            or lower(username) like lower(${pattern}))`,
        )
        .orderBy('id')
        .execute();
      return rows.map((r) => r.id);
    },

    async contactsByIds(workspaceId, ids) {
      if (ids.length === 0) return [];
      const rows = await db
        .selectFrom('contacts')
        .select(['id', 'first_name', 'last_name', 'username'])
        .where('workspace_id', '=', workspaceId)
        .where('id', 'in', [...ids])
        .execute();
      return rows.map((r) => ({
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        username: r.username,
      }));
    },
  };
}
