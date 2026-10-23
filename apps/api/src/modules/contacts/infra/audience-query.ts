import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { AudienceQuery, AudienceSpec } from '../app/ports.js';
import { createContactTagRepo } from './contact-tag-repo.js';
import { filteredContacts, uuidArray } from './contact-list-query.js';

/**
 * The audience's contacts (`c`): a tag audience through the Contacts filter with the left-out tags
 * removed, or the given ids of the workspace (ADR-0004).
 */
function audienceContacts(db: Db, workspaceId: string, audience: AudienceSpec) {
  if (audience.kind === 'ids') {
    return db
      .selectFrom('contacts as c')
      .where('c.workspace_id', '=', workspaceId)
      .where(sql<boolean>`c.id = ANY(${uuidArray(audience.contactIds)})`);
  }
  let q = filteredContacts(db, workspaceId, {
    q: null,
    mode: audience.mode,
    tagIds: audience.include,
  });
  if (audience.exclude.length > 0) {
    q = q.where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('contact_tags as xt')
            .select('xt.tag_id')
            .whereRef('xt.workspace_id', '=', 'c.workspace_id')
            .whereRef('xt.contact_id', '=', 'c.id')
            .where(sql<boolean>`xt.tag_id = ANY(${uuidArray(audience.exclude)})`),
        ),
      ),
    );
  }
  return q;
}

/** The audience joined to the reach row of one Telegram bot (`r`, by `contact_bot_reach_pkey`). */
function withReach(db: Db, workspaceId: string, audience: AudienceSpec, telegramBotId: bigint) {
  return audienceContacts(db, workspaceId, audience).leftJoin('contact_bot_reach as r', (join) =>
    join
      .onRef('r.workspace_id', '=', 'c.workspace_id')
      .onRef('r.contact_id', '=', 'c.id')
      .on('r.telegram_bot_id', '=', String(telegramBotId)),
  );
}

export function createAudienceQuery(db: Db): AudienceQuery {
  const contactTags = createContactTagRepo(db);
  return {
    async breakdown(workspaceId, audience, telegramBotId) {
      if (telegramBotId === null) {
        const { n } = await audienceContacts(db, workspaceId, audience)
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .executeTakeFirstOrThrow();
        return { audienceSize: Number(n), reach: null };
      }
      // Partition: blocked (whatever wrote says), then never wrote, then reachable.
      const row = await withReach(db, workspaceId, audience, telegramBotId)
        .select([
          (eb) => eb.fn.countAll<string>().as('total'),
          sql<string>`count(*) FILTER (WHERE r.blocked_at IS NOT NULL)`.as('blocked'),
          sql<string>`count(*) FILTER (WHERE r.blocked_at IS NULL AND r.wrote_at IS NULL)`.as(
            'never_wrote',
          ),
        ])
        .executeTakeFirstOrThrow();
      const total = Number(row.total);
      const blocked = Number(row.blocked);
      const neverWrote = Number(row.never_wrote);
      return {
        audienceSize: total,
        reach: { blocked, neverWrote, reachable: total - blocked - neverWrote },
      };
    },

    async reachable(workspaceId, audience, telegramBotId, limit) {
      const rows = await withReach(db, workspaceId, audience, telegramBotId)
        .where('r.blocked_at', 'is', null)
        .where('r.wrote_at', 'is not', null)
        .select(['c.id', 'c.telegram_user_id'])
        .orderBy('c.id')
        .limit(limit)
        .execute();
      return rows.map((r) => ({ id: r.id, telegramUserId: BigInt(r.telegram_user_id) }));
    },

    async matchingIds(workspaceId, filter) {
      const rows = await filteredContacts(db, workspaceId, filter)
        .select('c.id')
        .orderBy('c.id')
        .execute();
      return rows.map((r) => r.id);
    },

    async cards(workspaceId, contactIds, telegramBotId) {
      const base = audienceContacts(db, workspaceId, { kind: 'ids', contactIds });
      const rows =
        telegramBotId === null
          ? (
              await base.select(['c.id', 'c.first_name', 'c.last_name', 'c.username']).execute()
            ).map((r) => ({ ...r, blocked_at: null as Date | null }))
          : await withReach(db, workspaceId, { kind: 'ids', contactIds }, telegramBotId)
              .select(['c.id', 'c.first_name', 'c.last_name', 'c.username', 'r.blocked_at'])
              .execute();
      const byId = new Map(rows.map((r) => [r.id, r]));
      const tags = await contactTags.tagsOfMany(
        workspaceId,
        rows.map((r) => r.id),
      );
      return [...new Set(contactIds)].flatMap((id) => {
        const r = byId.get(id);
        if (!r) return [];
        return [
          {
            id,
            firstName: r.first_name,
            lastName: r.last_name,
            username: r.username,
            tags: tags.get(id) ?? [],
            blockedSince: r.blocked_at,
          },
        ];
      });
    },

    async isBlocked(workspaceId, contactId, telegramBotId) {
      const row = await db
        .selectFrom('contact_bot_reach')
        .select('blocked_at')
        .where('workspace_id', '=', workspaceId)
        .where('contact_id', '=', contactId)
        .where('telegram_bot_id', '=', String(telegramBotId))
        .executeTakeFirst();
      return row?.blocked_at != null;
    },
  };
}
