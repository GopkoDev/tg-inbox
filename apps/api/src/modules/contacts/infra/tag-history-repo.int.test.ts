import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertTagHistory, twoWorkspacesWithTags } from '../../../test/fixtures/tags.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createTagHistoryRepo } from './tag-history-repo.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);

describe('tag-history repository', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: ReturnType<typeof createTagHistoryRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    repo = createTagHistoryRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  type Ws = Awaited<ReturnType<typeof twoWorkspacesWithTags>>['a'];
  const entry = (ws: Ws, o: Partial<Parameters<typeof insertTagHistory>[1]> = {}) =>
    insertTagHistory(db, {
      workspaceId: ws.workspaceId,
      contactId: ws.otherContactId,
      tagId: ws.tagId,
      tagName: 'VIP',
      kind: 'added',
      actorAccountId: ws.operatorAccountId,
      createdAt: NOW,
      ...o,
    });

  describe('append (AC-06)', () => {
    it('writes one entry with a fresh id, the tag name at that moment and the source', async () => {
      const { a } = await twoWorkspacesWithTags(db);
      const id = await repo.append({
        workspaceId: a.workspaceId,
        contactId: a.otherContactId,
        tagId: a.tagId,
        tagName: 'VIP',
        kind: 'removed',
        actorAccountId: a.operatorAccountId,
        source: 'inbox',
        createdAt: NOW,
      });
      const row = await db
        .selectFrom('contact_tag_history')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        workspace_id: a.workspaceId,
        contact_id: a.otherContactId,
        tag_id: a.tagId,
        tag_name: 'VIP',
        kind: 'removed',
        source: 'inbox',
        merged_into_tag_id: null,
        merged_into_name: null,
        created_at: NOW,
      });
    });

    it('refuses an actor from another workspace (composite FK)', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      await expect(
        repo.append({
          workspaceId: a.workspaceId,
          contactId: a.otherContactId,
          tagId: a.tagId,
          tagName: 'VIP',
          kind: 'added',
          actorAccountId: b.operatorAccountId,
          source: 'profile',
          createdAt: NOW,
        }),
      ).rejects.toThrow();
    });
  });

  describe('page (AC-04)', () => {
    it('pages 50 at a time, newest first, with no repeat or skip across equal times', async () => {
      const { a } = await twoWorkspacesWithTags(db);
      const contactId = await insertContact(db, { workspaceId: a.workspaceId });
      const ids: string[] = [];
      // 120 entries over 40 distinct seconds: three entries share every timestamp.
      for (let i = 0; i < 120; i++) {
        ids.push(await entry(a, { contactId, createdAt: ago(1000 - Math.floor(i / 3)) }));
      }
      const seen: string[] = [];
      let after: { createdAt: Date; id: string } | undefined;
      const sizes: number[] = [];
      for (;;) {
        const page = await repo.page(a.workspaceId, contactId, after);
        sizes.push(page.entries.length);
        seen.push(...page.entries.map((e) => e.id));
        if (!page.hasNext) break;
        const last = page.entries.at(-1)!;
        after = { createdAt: last.createdAt, id: last.id };
      }
      expect(sizes).toEqual([50, 50, 20]);
      expect(new Set(seen).size).toBe(120);
      expect([...seen].sort()).toEqual([...ids].sort());
      const rows = await db
        .selectFrom('contact_tag_history')
        .select(['id', 'created_at'])
        .where('contact_id', '=', contactId)
        .execute();
      const expected = rows
        .sort((x, y) => y.created_at.getTime() - x.created_at.getTime() || (x.id < y.id ? 1 : -1))
        .map((r) => r.id);
      expect(seen).toEqual(expected);
    });

    it('maps a merge entry with its target and keeps the name of that moment', async () => {
      const { a } = await twoWorkspacesWithTags(db);
      const contactId = await insertContact(db, { workspaceId: a.workspaceId });
      await entry(a, {
        contactId,
        kind: 'merged',
        tagName: 'Loyal',
        actorAccountId: a.ownerAccountId,
        mergedInto: { tagId: a.tagId, name: 'VIP' },
      });
      const page = await repo.page(a.workspaceId, contactId);
      expect(page.hasNext).toBe(false);
      expect(page.entries).toEqual([
        {
          id: expect.any(String),
          tagId: a.tagId,
          tagName: 'Loyal',
          kind: 'merged',
          mergedInto: { tagId: a.tagId, name: 'VIP' },
          actorAccountId: a.ownerAccountId,
          source: 'settings',
          createdAt: NOW,
        },
      ]);
    });

    it("never shows another workspace's history", async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      await entry(b, { contactId: b.taggedContactId });
      expect((await repo.page(a.workspaceId, b.taggedContactId)).entries).toEqual([]);
      expect((await repo.page(b.workspaceId, b.taggedContactId)).entries.length).toBeGreaterThan(0);
    });
  });

  describe('memberChangesSince (AC-15)', () => {
    it('counts the member added / removed entries since the time, ignoring merged and deleted', async () => {
      const { a } = await twoWorkspacesWithTags(db);
      const contactId = await insertContact(db, { workspaceId: a.workspaceId });
      await entry(a, { contactId, createdAt: ago(61) }); // outside the window
      await entry(a, { contactId, createdAt: ago(50), kind: 'added' });
      await entry(a, { contactId, createdAt: ago(10), kind: 'removed' });
      for (const kind of ['merged', 'deleted'] as const) {
        await entry(a, {
          contactId,
          kind,
          createdAt: ago(55),
          actorAccountId: a.operatorAccountId,
          ...(kind === 'merged' && { mergedInto: { tagId: a.tagId, name: 'VIP' } }),
        });
      }
      expect(await repo.memberChangesSince(a.workspaceId, a.operatorAccountId, ago(60))).toEqual({
        count: 2,
        oldestAt: ago(50),
      });
    });

    it('is null and zero without entries, and counts per member and per workspace', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      const contactId = await insertContact(db, { workspaceId: a.workspaceId });
      await entry(a, { contactId, createdAt: ago(5), actorAccountId: a.operatorAccountId });
      await entry(a, { contactId, createdAt: ago(5), actorAccountId: a.ownerAccountId });
      expect(await repo.memberChangesSince(a.workspaceId, a.ownerAccountId, ago(60))).toEqual({
        count: 1,
        oldestAt: ago(5),
      });
      // Isolation: workspace B has seen nothing, even asking for A's member.
      expect(await repo.memberChangesSince(b.workspaceId, a.operatorAccountId, ago(60))).toEqual({
        count: 0,
        oldestAt: null,
      });
    });
  });

  describe('lockMemberChanges', () => {
    it('serialises one member in one workspace only', async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const taken = new Promise<void>((r) => (locked = r));
      const first = db.transaction().execute(async (tx) => {
        await repo.lockMemberChanges(a.workspaceId, a.operatorAccountId, tx);
        locked();
        await held;
      });
      await taken;
      let sameDone = false;
      const same = db
        .transaction()
        .execute((tx) => repo.lockMemberChanges(a.workspaceId, a.operatorAccountId, tx))
        .then(() => (sameDone = true));
      await db
        .transaction()
        .execute((tx) => repo.lockMemberChanges(a.workspaceId, a.ownerAccountId, tx));
      await db
        .transaction()
        .execute((tx) => repo.lockMemberChanges(b.workspaceId, a.operatorAccountId, tx));
      await new Promise((r) => setTimeout(r, 300));
      expect(sameDone).toBe(false);
      release();
      await first;
      await same;
      expect(sameDone).toBe(true);
    });
  });
});
