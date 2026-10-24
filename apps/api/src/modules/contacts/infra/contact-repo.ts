import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import type { ContactRepo } from '../app/ports.js';
import { contactSearchPredicate } from './contact-search.js';

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
      const predicate = contactSearchPredicate(query);
      if (predicate === null) return null;
      const rows = await db
        .selectFrom('contacts')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where(predicate)
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

    async lockContact(workspaceId, contactId, tx) {
      const row = await tx
        .selectFrom('contacts')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', contactId)
        .forNoKeyUpdate()
        .executeTakeFirst();
      return row !== undefined;
    },

    async idByTelegramUser(workspaceId, telegramUserId, tx) {
      const row = await (tx ?? db)
        .selectFrom('contacts')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('telegram_user_id', '=', String(telegramUserId))
        .executeTakeFirst();
      return row?.id ?? null;
    },

    async profile(workspaceId, contactId, telegramBotId = null) {
      const r = await db
        .selectFrom('contacts as c')
        .selectAll('c')
        // The current bot's mark by the reach key (contact_bot_reach_pkey); no bot = no mark.
        .$if(telegramBotId !== null, (q) =>
          q
            .leftJoin('contact_bot_reach as r', (j) =>
              j
                .onRef('r.workspace_id', '=', 'c.workspace_id')
                .onRef('r.contact_id', '=', 'c.id')
                .on('r.telegram_bot_id', '=', String(telegramBotId)),
            )
            .select('r.blocked_at'),
        )
        .where('c.workspace_id', '=', workspaceId)
        .where('c.id', '=', contactId)
        .executeTakeFirst();
      if (!r) return null;
      return {
        id: r.id,
        workspaceId: r.workspace_id,
        telegramUserId: BigInt(r.telegram_user_id),
        firstName: r.first_name,
        lastName: r.last_name,
        username: r.username,
        languageCode: r.language_code,
        profileSeenAt: r.profile_seen_at,
        createdAt: r.created_at,
        firstWroteAt: r.first_wrote_at,
        lastWroteAt: r.last_wrote_at,
        blockedSince: r.blocked_at ?? null,
      };
    },
  };
}
