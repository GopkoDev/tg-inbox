import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertContactTag, insertTag, twoWorkspacesWithTags } from '../../../test/fixtures/tags.js';
import { T0 } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createContactTagRepo } from './contact-tag-repo.js';

describe('contact-tag repository', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: ReturnType<typeof createContactTagRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    repo = createContactTagRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  type Ws = Awaited<ReturnType<typeof twoWorkspacesWithTags>>['a'];
  const tag = (ws: Ws, name: string) =>
    insertTag(db, { workspaceId: ws.workspaceId, createdByAccountId: ws.ownerAccountId, name });
  const link = (ws: Ws, contactId: string, tagId: string, addedAt = T0) =>
    insertContactTag(db, {
      workspaceId: ws.workspaceId,
      contactId,
      tagId,
      addedByAccountId: ws.operatorAccountId,
      addedAt,
    });

  describe('tagsOf (AC-04)', () => {
    it("returns a contact's tags in tag-list order with who added each and when", async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      const kyiv = await tag(a, 'Kyiv');
      const wholesale = await tag(a, 'wholesale');
      await link(a, a.otherContactId, wholesale, new Date('2026-03-02T00:00:00Z'));
      await link(a, a.otherContactId, kyiv, new Date('2026-03-03T00:00:00Z'));
      expect(await repo.tagsOf(a.workspaceId, a.otherContactId)).toEqual([
        {
          tagId: kyiv,
          name: 'Kyiv',
          addedByAccountId: a.operatorAccountId,
          addedAt: new Date('2026-03-03T00:00:00Z'),
        },
        {
          tagId: wholesale,
          name: 'wholesale',
          addedByAccountId: a.operatorAccountId,
          addedAt: new Date('2026-03-02T00:00:00Z'),
        },
      ]);
      // Isolation: A's contact asked in B's workspace, and B's contact in A's, show nothing.
      expect(await repo.tagsOf(b.workspaceId, a.otherContactId)).toEqual([]);
      expect(await repo.tagsOf(a.workspaceId, b.taggedContactId)).toEqual([]);
    });
  });

  describe('tagsOfMany (AC-01)', () => {
    it('returns the tags of a page of contacts in tag-list order, workspace only', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      const zeta = await tag(a, 'Zeta');
      const alpha = await tag(a, 'alpha');
      await link(a, a.taggedContactId, zeta);
      await link(a, a.taggedContactId, alpha);
      const many = await repo.tagsOfMany(a.workspaceId, [
        a.taggedContactId,
        a.otherContactId,
        b.taggedContactId,
      ]);
      expect(many.get(a.taggedContactId)?.map((t) => t.name)).toEqual(['alpha', 'VIP', 'Zeta']);
      expect(many.get(a.otherContactId)).toBeUndefined();
      // Isolation: B's contact is not answered through A's workspace.
      expect(many.has(b.taggedContactId)).toBe(false);
      expect(await repo.tagsOfMany(a.workspaceId, [])).toEqual(new Map());
    });
  });

  describe('carries and countFor (AC-06, AC-08)', () => {
    it('answers for the workspace only', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      expect(await repo.carries(a.workspaceId, a.taggedContactId, a.tagId)).toBe(true);
      expect(await repo.carries(a.workspaceId, a.otherContactId, a.tagId)).toBe(false);
      expect(await repo.carries(b.workspaceId, a.taggedContactId, a.tagId)).toBe(false);
      expect(await repo.countFor(a.workspaceId, a.taggedContactId)).toBe(1);
      expect(await repo.countFor(a.workspaceId, a.otherContactId)).toBe(0);
      expect(await repo.countFor(b.workspaceId, a.taggedContactId)).toBe(0);
    });
  });

  describe('insert and delete (AC-06, AC-12)', () => {
    it('inserts a link and deletes it, reporting whether a link was removed', async () => {
      const { a } = await twoWorkspacesWithTags(db);
      const kyiv = await tag(a, 'Kyiv');
      await repo.insert({
        workspaceId: a.workspaceId,
        contactId: a.otherContactId,
        tagId: kyiv,
        addedByAccountId: a.operatorAccountId,
        addedAt: T0,
      });
      expect(await repo.carries(a.workspaceId, a.otherContactId, kyiv)).toBe(true);
      expect(await repo.delete(a.workspaceId, a.otherContactId, kyiv)).toBe(true);
      expect(await repo.delete(a.workspaceId, a.otherContactId, kyiv)).toBe(false);
      expect(await repo.carries(a.workspaceId, a.otherContactId, kyiv)).toBe(false);
    });

    it('refuses a link to a tag of another workspace (composite FK) and a duplicate link', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      const input = {
        workspaceId: a.workspaceId,
        contactId: a.otherContactId,
        tagId: b.tagId,
        addedByAccountId: a.operatorAccountId,
        addedAt: T0,
      };
      await expect(repo.insert(input)).rejects.toThrow();
      await expect(
        repo.insert({ ...input, contactId: a.taggedContactId, tagId: a.tagId }),
      ).rejects.toThrow();
    });

    it("delete does not remove another workspace's link", async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      expect(await repo.delete(b.workspaceId, a.taggedContactId, a.tagId)).toBe(false);
      expect(await repo.delete(a.workspaceId, b.taggedContactId, b.tagId)).toBe(false);
      expect(await repo.carries(a.workspaceId, a.taggedContactId, a.tagId)).toBe(true);
      expect(await repo.carries(b.workspaceId, b.taggedContactId, b.tagId)).toBe(true);
    });
  });

  it('ignores an unknown contact id', async () => {
    const { a } = await twoWorkspacesWithTags(db);
    const ghost = newId();
    expect(await repo.tagsOf(a.workspaceId, ghost)).toEqual([]);
    expect(await repo.countFor(a.workspaceId, ghost)).toBe(0);
    await insertContact(db, { workspaceId: a.workspaceId });
  });
});
