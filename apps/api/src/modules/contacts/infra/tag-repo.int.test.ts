import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertContactTag, insertTag, twoWorkspacesWithTags } from '../../../test/fixtures/tags.js';
import { insertMembership, insertWorkspace, T0 } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createTagRepo } from './tag-repo.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when `p` is still pending after `ms`. */
async function stillPending(p: Promise<unknown>, ms = 300): Promise<boolean> {
  let settled = false;
  void p.then(
    () => (settled = true),
    () => (settled = true),
  );
  await sleep(ms);
  return !settled;
}

describe('tag repository', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: ReturnType<typeof createTagRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    repo = createTagRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  async function workspaceWithOwner() {
    const workspaceId = await insertWorkspace(db);
    const owner = await insertMembership(db, workspaceId, { role: 'owner' });
    return { workspaceId, ownerAccountId: owner.accountId };
  }

  describe('findByKey, insert and count (AC-08)', () => {
    it('inserts a tag and finds it by its name key, in its own workspace only', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      const id = newId();
      const created = await repo.insert(a.workspaceId, {
        id,
        name: 'Kyiv',
        key: 'kyiv',
        createdBy: a.ownerAccountId,
        createdAt: T0,
      });
      expect(created).toEqual({
        id,
        workspaceId: a.workspaceId,
        name: 'Kyiv',
        key: 'kyiv',
        createdByAccountId: a.ownerAccountId,
        createdAt: T0,
      });
      expect(await repo.findByKey(a.workspaceId, 'kyiv')).toEqual(created);
      // Isolation: the key of workspace A is not a tag of B, while B's own VIP is found by its own id.
      expect(await repo.findByKey(b.workspaceId, 'kyiv')).toBeNull();
      expect((await repo.findByKey(b.workspaceId, 'vip'))?.id).toBe(b.tagId);
      expect((await repo.findByKey(a.workspaceId, 'vip'))?.id).toBe(a.tagId);
      expect(await repo.findByKey(a.workspaceId, 'missing')).toBeNull();
    });

    it('refuses a second tag with the same name key in a workspace but allows it in another', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      await expect(
        repo.insert(a.workspaceId, {
          id: newId(),
          name: 'vip',
          key: 'vip',
          createdBy: a.ownerAccountId,
          createdAt: T0,
        }),
      ).rejects.toThrow(/tags_workspace_id_name_key_key/);
      // Same key in B is B's own VIP: no conflict in a fresh workspace.
      const w = await workspaceWithOwner();
      await expect(
        repo.insert(w.workspaceId, {
          id: newId(),
          name: 'VIP',
          key: 'vip',
          createdBy: w.ownerAccountId,
          createdAt: T0,
        }),
      ).resolves.toBeDefined();
      expect(b.workspaceId).not.toBe(w.workspaceId);
    });

    it('refuses a creator who is not a member of the workspace (composite FK)', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      await expect(
        repo.insert(a.workspaceId, {
          id: newId(),
          name: 'Alien',
          key: 'alien',
          createdBy: b.ownerAccountId,
          createdAt: T0,
        }),
      ).rejects.toThrow();
    });

    it('counts the tags of one workspace only', async () => {
      const w = await workspaceWithOwner();
      expect(await repo.count(w.workspaceId)).toBe(0);
      for (const name of ['One', 'Two', 'Three']) {
        await insertTag(db, {
          workspaceId: w.workspaceId,
          createdByAccountId: w.ownerAccountId,
          name,
        });
      }
      const { a } = await twoWorkspacesWithTags(db);
      expect(await repo.count(w.workspaceId)).toBe(3);
      expect(await repo.count(a.workspaceId)).toBe(1);
    });
  });

  describe('listWithCounts (AC-10)', () => {
    it('lists every tag with its contact count in ICU tag-list order, zero counts included', async () => {
      const w = await workspaceWithOwner();
      const names = ['Яблуко', 'Zebra', 'apple pie', 'Ёлка', 'Apple', 'ábaco'];
      const ids = new Map<string, string>();
      for (const name of names) {
        ids.set(
          name,
          await insertTag(db, {
            workspaceId: w.workspaceId,
            createdByAccountId: w.ownerAccountId,
            name,
          }),
        );
      }
      const c1 = await insertContact(db, { workspaceId: w.workspaceId });
      const c2 = await insertContact(db, { workspaceId: w.workspaceId });
      for (const [contactId, name] of [
        [c1, 'Apple'],
        [c2, 'Apple'],
        [c1, 'Zebra'],
      ] as const) {
        await insertContactTag(db, {
          workspaceId: w.workspaceId,
          contactId,
          tagId: ids.get(name)!,
          addedByAccountId: w.ownerAccountId,
        });
      }
      const list = await repo.listWithCounts(w.workspaceId);
      expect(list.map((t) => [t.name, t.contactCount])).toEqual([
        ['ábaco', 0],
        ['Apple', 2],
        ['apple pie', 0],
        ['Zebra', 1],
        ['Ёлка', 0],
        ['Яблуко', 0],
      ]);
      expect(list[1]!.id).toBe(ids.get('Apple'));
    });

    it('breaks a collation tie by the name key and counts only its own workspace', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      const extra = await insertContact(db, { workspaceId: b.workspaceId });
      await insertContactTag(db, {
        workspaceId: b.workspaceId,
        contactId: extra,
        tagId: b.tagId,
        addedByAccountId: b.operatorAccountId,
      });
      expect(await repo.listWithCounts(a.workspaceId)).toEqual([
        { id: a.tagId, name: 'VIP', contactCount: 1 },
      ]);
      expect(await repo.listWithCounts(b.workspaceId)).toEqual([
        { id: b.tagId, name: 'VIP', contactCount: 2 },
      ]);
    });

    it('countFor counts one tag, and 0 for another workspace', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      expect(await repo.countFor(a.workspaceId, a.tagId)).toBe(1);
      expect(await repo.countFor(b.workspaceId, a.tagId)).toBe(0);
    });
  });

  describe('resolveIds (AC-12)', () => {
    it('keeps only the ids that are tags of the workspace', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      const unknown = newId();
      expect(await repo.resolveIds(a.workspaceId, [a.tagId, b.tagId, unknown])).toEqual([a.tagId]);
      expect(await repo.resolveIds(b.workspaceId, [a.tagId])).toEqual([]);
      expect(await repo.resolveIds(a.workspaceId, [])).toEqual([]);
    });
  });

  describe('row locks (AC-14, ADR-0004)', () => {
    it('lockForKeyShare returns the row, or null for a foreign, unknown or deleted tag', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      const w = await workspaceWithOwner();
      const gone = await insertTag(db, {
        workspaceId: w.workspaceId,
        createdByAccountId: w.ownerAccountId,
        name: 'Old promo',
      });
      await repo.delete(w.workspaceId, gone);
      await db.transaction().execute(async (tx) => {
        expect((await repo.lockForKeyShare(a.workspaceId, a.tagId, tx))?.name).toBe('VIP');
        expect(await repo.lockForKeyShare(b.workspaceId, a.tagId, tx)).toBeNull();
        expect(await repo.lockForKeyShare(a.workspaceId, newId(), tx)).toBeNull();
        expect(await repo.lockForKeyShare(w.workspaceId, gone, tx)).toBeNull();
      });
    });

    it('lockForUpdate returns the workspace rows in id order and drops foreign ids', async () => {
      const w = await workspaceWithOwner();
      const ids: string[] = [];
      for (const name of ['P', 'Q', 'R']) {
        ids.push(
          await insertTag(db, {
            workspaceId: w.workspaceId,
            createdByAccountId: w.ownerAccountId,
            name,
          }),
        );
      }
      const { b } = await twoWorkspacesWithTags(db);
      const sorted = [...ids].sort();
      const rows = await db
        .transaction()
        .execute((tx) =>
          repo.lockForUpdate(w.workspaceId, [sorted[2]!, b.tagId, sorted[0]!, sorted[1]!], tx),
        );
      expect(rows.map((r) => r.id)).toEqual(sorted);
    });

    it('an owner FOR UPDATE makes a member FOR KEY SHARE wait, and the share finds the tag gone after a delete', async () => {
      const w = await workspaceWithOwner();
      const tagId = await insertTag(db, {
        workspaceId: w.workspaceId,
        createdByAccountId: w.ownerAccountId,
        name: 'Doomed',
      });
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const lockTaken = new Promise<void>((r) => (locked = r));
      const owner = db.transaction().execute(async (tx) => {
        await repo.lockForUpdate(w.workspaceId, [tagId], tx);
        locked();
        await held;
        await repo.delete(w.workspaceId, tagId, tx);
      });
      await lockTaken;
      const member = db
        .transaction()
        .execute((tx) => repo.lockForKeyShare(w.workspaceId, tagId, tx));
      expect(await stillPending(member)).toBe(true);
      release();
      await owner;
      expect(await member).toBeNull();
    });

    it('lockWorkspaceTags serialises one workspace and leaves another alone', async () => {
      const w1 = await workspaceWithOwner();
      const w2 = await workspaceWithOwner();
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const lockTaken = new Promise<void>((r) => (locked = r));
      const first = db.transaction().execute(async (tx) => {
        await repo.lockWorkspaceTags(w1.workspaceId, tx);
        locked();
        await held;
      });
      await lockTaken;
      const same = db.transaction().execute((tx) => repo.lockWorkspaceTags(w1.workspaceId, tx));
      const other = db.transaction().execute((tx) => repo.lockWorkspaceTags(w2.workspaceId, tx));
      await other;
      expect(await stillPending(same)).toBe(true);
      release();
      await first;
      await same;
    });
  });

  describe('rename and delete', () => {
    it('renames in place, keeping the id, and never touches another workspace', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      await repo.rename(a.workspaceId, a.tagId, 'vip', 'vip');
      expect((await repo.findByKey(a.workspaceId, 'vip'))?.name).toBe('vip');
      expect((await repo.findByKey(b.workspaceId, 'vip'))?.name).toBe('VIP');
      // A foreign id renames nothing.
      await repo.rename(b.workspaceId, a.tagId, 'Hijacked', 'hijacked');
      expect((await repo.findByKey(a.workspaceId, 'vip'))?.name).toBe('vip');
      expect(await repo.findByKey(b.workspaceId, 'hijacked')).toBeNull();
    });

    it('reports whether the rename and the delete changed a row', async () => {
      const w = await workspaceWithOwner();
      const id = await insertTag(db, {
        workspaceId: w.workspaceId,
        createdByAccountId: w.ownerAccountId,
        name: 'Temp',
      });
      expect(await repo.rename(w.workspaceId, id, 'Temp 2', 'temp 2')).toBe(true);
      expect(await repo.rename(w.workspaceId, newId(), 'X', 'x')).toBe(false);
      expect(await repo.delete(w.workspaceId, id)).toBe(true);
      expect(await repo.delete(w.workspaceId, id)).toBe(false);
    });

    it('delete never removes a tag of another workspace, and is refused while links exist', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      expect(await repo.delete(b.workspaceId, a.tagId)).toBe(false);
      expect(await repo.count(a.workspaceId)).toBe(1);
      await expect(repo.delete(a.workspaceId, a.tagId)).rejects.toThrow();
    });
  });
});
