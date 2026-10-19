import { checkTagName } from '@tg/shared';
import type { Kysely } from 'kysely';
import type { DB } from '../../platform/db.types.gen.js';
import { newId } from '../../platform/ids.js';
import { insertContact } from './contacts.js';
import { insertMembership, insertWorkspace, T0 } from './workspaces.js';

let nextTag = 1;

/** A tag row; the name is tidied and `name_key` computed by the shared function the domain uses. Returns its id. */
export async function insertTag(
  db: Kysely<DB>,
  o: { workspaceId: string; createdByAccountId: string; name?: string; createdAt?: Date },
): Promise<string> {
  const checked = checkTagName(o.name ?? `Test tag ${nextTag++}`);
  if (!checked.ok) throw new Error('insertTag: invalid tag name');
  const id = newId();
  await db
    .insertInto('tags')
    .values({
      id,
      workspace_id: o.workspaceId,
      name: checked.name,
      name_key: checked.key,
      created_by_account_id: o.createdByAccountId,
      created_at: o.createdAt ?? T0,
    })
    .execute();
  return id;
}

export type TagHistoryKind = 'added' | 'removed' | 'merged' | 'deleted';
export type TagHistorySource = 'inbox' | 'profile' | 'settings';

const defaultSource = (kind: TagHistoryKind): TagHistorySource =>
  kind === 'merged' || kind === 'deleted' ? 'settings' : 'profile';

/** A history entry, for the rate-limit and keyset tests. `source` defaults per kind. */
export async function insertTagHistory(
  db: Kysely<DB>,
  o: {
    workspaceId: string;
    contactId: string;
    tagId: string;
    tagName: string;
    kind: TagHistoryKind;
    actorAccountId: string;
    source?: TagHistorySource;
    mergedInto?: { tagId: string; name: string };
    createdAt?: Date;
  },
): Promise<string> {
  const id = newId();
  await db
    .insertInto('contact_tag_history')
    .values({
      id,
      workspace_id: o.workspaceId,
      contact_id: o.contactId,
      tag_id: o.tagId,
      tag_name: o.tagName,
      kind: o.kind,
      merged_into_tag_id: o.mergedInto?.tagId ?? null,
      merged_into_name: o.mergedInto?.name ?? null,
      actor_account_id: o.actorAccountId,
      source: o.source ?? defaultSource(o.kind),
      created_at: o.createdAt ?? T0,
    })
    .execute();
  return id;
}

/** The link and, by default, its `added` entry (source `profile`), so the integrity query holds in every test. */
export async function insertContactTag(
  db: Kysely<DB>,
  o: {
    workspaceId: string;
    contactId: string;
    tagId: string;
    addedByAccountId: string;
    addedAt?: Date;
    history?: boolean;
  },
): Promise<void> {
  const addedAt = o.addedAt ?? T0;
  await db
    .insertInto('contact_tags')
    .values({
      workspace_id: o.workspaceId,
      contact_id: o.contactId,
      tag_id: o.tagId,
      added_by_account_id: o.addedByAccountId,
      added_at: addedAt,
    })
    .execute();
  if (o.history === false) return;
  const tag = await db
    .selectFrom('tags')
    .select('name')
    .where('workspace_id', '=', o.workspaceId)
    .where('id', '=', o.tagId)
    .executeTakeFirstOrThrow();
  await insertTagHistory(db, {
    workspaceId: o.workspaceId,
    contactId: o.contactId,
    tagId: o.tagId,
    tagName: tag.name,
    kind: 'added',
    actorAccountId: o.addedByAccountId,
    createdAt: addedAt,
  });
}

/**
 * Two workspaces, each with an owner and an operator, two contacts, a tag named `VIP` (same key,
 * different ids) and one link with its entry on the first contact: the base of every
 * cross-workspace isolation test of a tag repository method (CLAUDE.md, AC-12).
 */
export async function twoWorkspacesWithTags(db: Kysely<DB>) {
  async function build(name: string) {
    const workspaceId = await insertWorkspace(db, name);
    const owner = await insertMembership(db, workspaceId, { role: 'owner' });
    const operator = await insertMembership(db, workspaceId, { role: 'operator' });
    const taggedContactId = await insertContact(db, { workspaceId });
    const otherContactId = await insertContact(db, { workspaceId });
    const tagId = await insertTag(db, {
      workspaceId,
      createdByAccountId: owner.accountId,
      name: 'VIP',
    });
    await insertContactTag(db, {
      workspaceId,
      contactId: taggedContactId,
      tagId,
      addedByAccountId: operator.accountId,
    });
    return {
      workspaceId,
      ownerAccountId: owner.accountId,
      operatorAccountId: operator.accountId,
      contactIds: [taggedContactId, otherContactId],
      taggedContactId,
      otherContactId,
      tagId,
    };
  }
  return { a: await build('A'), b: await build('B') };
}
