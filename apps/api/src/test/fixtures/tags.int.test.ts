import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkTagName } from '@tg/shared';
import { createDb, type Db } from '../../platform/db.js';
import { startTestDatabase, type TestDatabase } from '../postgres.js';
import { insertContact } from './contacts.js';
import { insertContactTag, insertTag, insertTagHistory, twoWorkspacesWithTags } from './tags.js';
import { insertMembership, insertWorkspace } from './workspaces.js';

describe('tag fixtures', () => {
  let database: TestDatabase;
  let db: Db;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  it('insertTag tidies the name and computes the key through the shared function', async () => {
    const workspaceId = await insertWorkspace(db);
    const { accountId } = await insertMembership(db, workspaceId);
    const id = await insertTag(db, {
      workspaceId,
      createdByAccountId: accountId,
      name: '  Straße  Kyiv ',
    });
    const row = await db
      .selectFrom('tags')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    const expected = checkTagName('  Straße  Kyiv ');
    if (!expected.ok) throw new Error('invalid');
    expect(row).toMatchObject({
      name: 'Straße Kyiv',
      name_key: expected.key,
      workspace_id: workspaceId,
    });
    const plain = await insertTag(db, { workspaceId, createdByAccountId: accountId });
    const other = await db
      .selectFrom('tags')
      .select('name')
      .where('id', '=', plain)
      .executeTakeFirstOrThrow();
    expect(other.name).toMatch(/^Test tag \d+$/);
  });

  it('insertContactTag writes the link and by default its added entry from the profile', async () => {
    const workspaceId = await insertWorkspace(db);
    const { accountId } = await insertMembership(db, workspaceId);
    const contactId = await insertContact(db, { workspaceId });
    const tagId = await insertTag(db, { workspaceId, createdByAccountId: accountId, name: 'VIP' });
    await insertContactTag(db, { workspaceId, contactId, tagId, addedByAccountId: accountId });
    const links = await db
      .selectFrom('contact_tags')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .execute();
    const history = await db
      .selectFrom('contact_tag_history')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .execute();
    expect(links).toHaveLength(1);
    expect(history).toMatchObject([
      { kind: 'added', source: 'profile', tag_id: tagId, tag_name: 'VIP' },
    ]);
    const t2 = await insertTag(db, { workspaceId, createdByAccountId: accountId });
    await insertContactTag(db, {
      workspaceId,
      contactId,
      tagId: t2,
      addedByAccountId: accountId,
      history: false,
    });
    expect(
      await db
        .selectFrom('contact_tag_history')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .execute(),
    ).toHaveLength(1);
  });

  it('insertTagHistory defaults the source per kind', async () => {
    const workspaceId = await insertWorkspace(db);
    const { accountId } = await insertMembership(db, workspaceId);
    const contactId = await insertContact(db, { workspaceId });
    const tagId = await insertTag(db, { workspaceId, createdByAccountId: accountId });
    const base = { workspaceId, contactId, tagId, tagName: 'VIP', actorAccountId: accountId };
    await insertTagHistory(db, { ...base, kind: 'removed' });
    await insertTagHistory(db, { ...base, kind: 'deleted' });
    await insertTagHistory(db, { ...base, kind: 'merged', mergedInto: { tagId, name: 'Gold' } });
    const rows = await db
      .selectFrom('contact_tag_history')
      .select(['kind', 'source'])
      .where('workspace_id', '=', workspaceId)
      .orderBy('kind')
      .execute();
    expect(rows).toEqual([
      { kind: 'deleted', source: 'settings' },
      { kind: 'merged', source: 'settings' },
      { kind: 'removed', source: 'profile' },
    ]);
  });

  it('twoWorkspacesWithTags gives each workspace a VIP tag with the same key and its own link', async () => {
    const { a, b } = await twoWorkspacesWithTags(db);
    expect(a.tagId).not.toBe(b.tagId);
    const tags = await db
      .selectFrom('tags')
      .select(['workspace_id', 'name_key'])
      .where('workspace_id', 'in', [a.workspaceId, b.workspaceId])
      .execute();
    expect(tags.map((t) => t.name_key)).toEqual(['vip', 'vip']);
    for (const w of [a, b]) {
      const links = await db
        .selectFrom('contact_tags')
        .select('contact_id')
        .where('workspace_id', '=', w.workspaceId)
        .execute();
      expect(links).toEqual([{ contact_id: w.taggedContactId }]);
      expect(w.contactIds).toHaveLength(2);
      expect(w.ownerAccountId).toBeDefined();
      expect(w.operatorAccountId).toBeDefined();
    }
  });
});
