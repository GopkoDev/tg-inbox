import { sql, type Expression, type SqlBool } from 'kysely';
import type { Db } from '../../../platform/db.js';
import { CONTACTS_PAGE_SIZE } from '../domain/tags.js';
import type { ContactListFilter, ContactListPosition, ContactListQuery } from '../app/ports.js';
import { contactSearchPredicate } from './contact-search.js';
import { createContactTagRepo } from './contact-tag-repo.js';

const uuidArray = (ids: readonly string[]) => sql`${[...new Set(ids)]}::uuid[]`;

/**
 * "All of": contact ids carrying every chosen tag, as a grouped semi-join over the tag links
 * (data-model assumption 10: a correlated count per contact took 466 ms at 10 000 contacts, this
 * form 4 ms). `ids` are distinct tag ids of the workspace.
 */
function carryingAll(db: Db, workspaceId: string, ids: readonly string[]) {
  return db
    .selectFrom('contact_tags')
    .select('contact_id')
    .where('workspace_id', '=', workspaceId)
    .where(sql<boolean>`tag_id = ANY(${uuidArray(ids)})`)
    .groupBy('contact_id')
    .having(sql<boolean>`count(*) = ${ids.length}`);
}

/** The workspace's contacts with the search and the tag filter applied. */
function filtered(db: Db, workspaceId: string, f: ContactListFilter) {
  const ids = [...new Set(f.tagIds)];
  let q = db.selectFrom('contacts as c').where('c.workspace_id', '=', workspaceId);
  const search = contactSearchPredicate(f.q ?? '');
  if (search !== null) q = q.where(search);
  if (f.mode === 'none') {
    q = q.where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('contact_tags as ct')
            .select('ct.tag_id')
            .whereRef('ct.workspace_id', '=', 'c.workspace_id')
            .whereRef('ct.contact_id', '=', 'c.id'),
        ),
      ),
    );
  } else if (ids.length > 0 && f.mode === 'any') {
    q = q.where(({ exists, selectFrom }) =>
      exists(
        selectFrom('contact_tags as ct')
          .select('ct.tag_id')
          .whereRef('ct.workspace_id', '=', 'c.workspace_id')
          .whereRef('ct.contact_id', '=', 'c.id')
          .where(sql<boolean>`ct.tag_id = ANY(${uuidArray(ids)})`),
      ),
    );
  } else if (ids.length > 0) {
    // all
    q = q.where('c.id', 'in', carryingAll(db, workspaceId, ids));
  }
  return q;
}

/** `after` continues from the last contact shown: the dated part, or the NULL tail (second shape). */
function afterPredicate(after: ContactListPosition): Expression<SqlBool> {
  return after.lastWroteAt === null
    ? sql<boolean>`(c.last_wrote_at IS NULL AND c.id < ${after.id})`
    : sql<boolean>`(c.last_wrote_at < ${after.lastWroteAt}
        OR (c.last_wrote_at = ${after.lastWroteAt} AND c.id < ${after.id})
        OR c.last_wrote_at IS NULL)`;
}

/** One page plus one row (to know `hasNext`), by `contacts_workspace_id_last_wrote_at_id_idx`. */
export function listPageQuery(
  db: Db,
  workspaceId: string,
  f: ContactListFilter & { after?: ContactListPosition },
) {
  let q = filtered(db, workspaceId, f);
  if (f.after) q = q.where(afterPredicate(f.after));
  return q
    .select([
      'c.id',
      'c.first_name',
      'c.last_name',
      'c.username',
      'c.language_code',
      'c.first_wrote_at',
      'c.last_wrote_at',
    ])
    .orderBy(sql`c.last_wrote_at DESC NULLS LAST`)
    .orderBy('c.id', 'desc')
    .limit(CONTACTS_PAGE_SIZE + 1);
}

/** The matching count: the same predicates as the page. */
export function matchingCountQuery(db: Db, workspaceId: string, f: ContactListFilter) {
  return filtered(db, workspaceId, f).select((eb) => eb.fn.countAll<string>().as('n'));
}

export function createContactListQuery(db: Db): ContactListQuery {
  const contactTags = createContactTagRepo(db);
  return {
    async listPage(workspaceId, filter) {
      const rows = await listPageQuery(db, workspaceId, filter).execute();
      const page = rows.slice(0, CONTACTS_PAGE_SIZE);
      const tags = await contactTags.tagsOfMany(
        workspaceId,
        page.map((r) => r.id),
      );
      return {
        rows: page.map((r) => ({
          id: r.id,
          firstName: r.first_name,
          lastName: r.last_name,
          username: r.username,
          languageCode: r.language_code,
          firstWroteAt: r.first_wrote_at,
          lastWroteAt: r.last_wrote_at,
          tags: tags.get(r.id) ?? [],
        })),
        hasNext: rows.length > CONTACTS_PAGE_SIZE,
      };
    },

    async matchingCount(workspaceId, filter) {
      const { n } = await matchingCountQuery(db, workspaceId, filter).executeTakeFirstOrThrow();
      return Number(n);
    },

    async totalCount(workspaceId) {
      const { n } = await db
        .selectFrom('contacts')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('workspace_id', '=', workspaceId)
        .executeTakeFirstOrThrow();
      return Number(n);
    },
  };
}
