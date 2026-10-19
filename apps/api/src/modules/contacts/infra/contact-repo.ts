import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { normalizeSearchQuery, type ContactRepo } from '../app/ports.js';

export function createContactRepo(db: Db): ContactRepo {
  return {
    async upsertFromProfile(workspaceId, profile, seenAt, now, tx) {
      const ex = tx ?? db;
      // The profile fields follow shouldRefreshProfile (contacts/domain/profile.ts): only a strictly
      // newer message refreshes them. First and last wrote widen on every message (ADR-0005), so an
      // older message delivered late still lowers first_wrote_at; `seenAt` is the message's send time.
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
          first_wrote_at: seenAt,
          last_wrote_at: seenAt,
        })
        .onConflict((oc) =>
          oc
            .columns(['workspace_id', 'telegram_user_id'])
            .doUpdateSet(() => {
              const newer = sql<boolean>`contacts.profile_seen_at < excluded.profile_seen_at`;
              const pick = <T>(column: 'first_name' | 'last_name' | 'username' | 'language_code') =>
                sql<T>`CASE WHEN ${newer} THEN excluded.${sql.ref(column)} ELSE contacts.${sql.ref(column)} END`;
              return {
                first_name: pick<string>('first_name'),
                last_name: pick<string | null>('last_name'),
                username: pick<string | null>('username'),
                language_code: pick<string | null>('language_code'),
                profile_seen_at: sql<Date>`GREATEST(contacts.profile_seen_at, excluded.profile_seen_at)`,
                first_wrote_at: sql<Date>`LEAST(contacts.first_wrote_at, excluded.first_wrote_at)`,
                last_wrote_at: sql<Date>`GREATEST(contacts.last_wrote_at, excluded.last_wrote_at)`,
              };
            })
            .where((eb) =>
              eb.or([
                eb('contacts.profile_seen_at', '<', eb.ref('excluded.profile_seen_at')),
                sql<boolean>`contacts.first_wrote_at IS DISTINCT FROM LEAST(contacts.first_wrote_at, excluded.first_wrote_at)`,
                sql<boolean>`contacts.last_wrote_at IS DISTINCT FROM GREATEST(contacts.last_wrote_at, excluded.last_wrote_at)`,
              ]),
            ),
        )
        // xmax = 0 only on a freshly inserted row version.
        .returning(['id', sql<boolean>`(xmax = 0)`.as('created')])
        .executeTakeFirst();
      if (row) return { contactId: row.id, created: row.created };

      // Nothing changed (profile as new or newer, range already covers the message): read the id.
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
