import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertContactTag, insertTag, twoWorkspacesWithTags } from '../../../test/fixtures/tags.js';
import { T0 } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createContactTagRepo } from './contact-tag-repo.js';
import { createTagHistoryRepo } from './tag-history-repo.js';
import { createTagRepo } from './tag-repo.js';

describe('contact-tag repository', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: ReturnType<typeof createContactTagRepo>;
  let history: ReturnType<typeof createTagHistoryRepo>;
  let tags: ReturnType<typeof createTagRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    repo = createContactTagRepo(db);
    history = createTagHistoryRepo(db);
    tags = createTagRepo(db);
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

  // The AC-09 seed: "VIP" on 12 contacts, "vip-clients" on 3 (one of them also carries "VIP"),
  // "Old promo" on 40. Every link has its own adder and time.
  describe('owner merge and delete statements (AC-09)', () => {
    const OWNER_TIME = new Date('2026-10-19T09:00:00Z');
    const day = (n: number) => new Date(Date.UTC(2026, 5, n));

    async function seed(opts: { mergedLinkEarlier: boolean } = { mergedLinkEarlier: true }) {
      const { a, b } = await twoWorkspacesWithTags(db);
      const vip = a.tagId;
      const clients = await tag(a, 'vip-clients');
      const promo = await tag(a, 'Old promo');
      const vipContacts: string[] = [];
      for (let i = 0; i < 11; i++) {
        const c = await insertContact(db, { workspaceId: a.workspaceId });
        vipContacts.push(c);
        // The fixture already links a.taggedContactId to VIP: 11 new contacts make 12.
        await insertContactTag(db, {
          workspaceId: a.workspaceId,
          contactId: c,
          tagId: vip,
          addedByAccountId: a.operatorAccountId,
          addedAt: day(10 + i),
        });
      }
      const onlyClients = [
        await insertContact(db, { workspaceId: a.workspaceId }),
        await insertContact(db, { workspaceId: a.workspaceId }),
      ];
      const both = vipContacts[0]!; // VIP added on day 10
      for (const [i, c] of [...onlyClients, both].entries()) {
        await insertContactTag(db, {
          workspaceId: a.workspaceId,
          contactId: c,
          tagId: clients,
          addedByAccountId: a.ownerAccountId,
          // the overlap's merged link is earlier (day 5) or later (day 28) than its VIP link (day 10)
          addedAt: c === both ? (opts.mergedLinkEarlier ? day(5) : day(28)) : day(20 + i),
        });
      }
      const carriers: string[] = [];
      for (let i = 0; i < 40; i++) {
        const c = await insertContact(db, { workspaceId: a.workspaceId });
        carriers.push(c);
        await insertContactTag(db, {
          workspaceId: a.workspaceId,
          contactId: c,
          tagId: promo,
          addedByAccountId: a.operatorAccountId,
          addedAt: day(1),
        });
      }
      return { a, b, vip, clients, promo, vipContacts, onlyClients, both, carriers };
    }

    const linksOf = async (workspaceId: string, tagId: string) =>
      (
        await db
          .selectFrom('contact_tags')
          .selectAll()
          .where('workspace_id', '=', workspaceId)
          .where('tag_id', '=', tagId)
          .execute()
      ).map((r) => [r.contact_id, r.added_by_account_id, r.added_at.getTime()] as const);

    it("merge leaves 14 contacts on VIP, keeping each contact's original or earlier adder and time", async () => {
      const s = await seed();
      const before = new Map((await linksOf(s.a.workspaceId, s.clients)).map((l) => [l[0], l]));
      const vipBefore = new Map((await linksOf(s.a.workspaceId, s.vip)).map((l) => [l[0], l]));
      const carriers = await db
        .transaction()
        .execute((tx) => repo.mergeInto(s.a.workspaceId, s.clients, s.vip, tx));
      expect([...carriers].sort()).toEqual([...s.onlyClients, s.both].sort());
      const after = new Map((await linksOf(s.a.workspaceId, s.vip)).map((l) => [l[0], l]));
      expect(vipBefore.size).toBe(12);
      expect(after.size).toBe(14);
      expect(await linksOf(s.a.workspaceId, s.clients)).toEqual([]);
      for (const c of s.onlyClients) expect(after.get(c)).toEqual([c, ...before.get(c)!.slice(1)]);
      // The overlap carried both: the merged link (day 5, owner) is earlier than the VIP link (day 10).
      expect(after.get(s.both)).toEqual([s.both, s.a.ownerAccountId, day(5).getTime()]);
      // Contacts that carried only VIP are untouched.
      for (const c of s.vipContacts.slice(1)) expect(after.get(c)).toEqual(vipBefore.get(c));
      expect(await tags.countFor(s.a.workspaceId, s.vip)).toBe(14);
    });

    it('merge keeps the target link on a contact that carried both when it is the earlier one', async () => {
      const s = await seed({ mergedLinkEarlier: false });
      await db.transaction().execute((tx) => repo.mergeInto(s.a.workspaceId, s.clients, s.vip, tx));
      const after = new Map((await linksOf(s.a.workspaceId, s.vip)).map((l) => [l[0], l]));
      expect(after.get(s.both)).toEqual([s.both, s.a.operatorAccountId, day(10).getTime()]);
    });

    it('merge of a tag no contact carries changes nothing, and the merged tag can then be deleted', async () => {
      const s = await seed();
      const empty = await tag(s.a, 'Empty');
      const carriers = await db
        .transaction()
        .execute((tx) => repo.mergeInto(s.a.workspaceId, empty, s.vip, tx));
      expect(carriers).toEqual([]);
      expect(await tags.countFor(s.a.workspaceId, s.vip)).toBe(12);
      await db.transaction().execute((tx) => repo.mergeInto(s.a.workspaceId, s.clients, s.vip, tx));
      expect(await tags.delete(s.a.workspaceId, s.clients)).toBe(true);
    });

    it('merge refuses to merge a tag into itself', async () => {
      const s = await seed();
      await expect(
        db.transaction().execute((tx) => repo.mergeInto(s.a.workspaceId, s.vip, s.vip, tx)),
      ).rejects.toThrow();
      expect(await tags.countFor(s.a.workspaceId, s.vip)).toBe(12);
    });

    it('writes exactly one merged entry on each carrier of the merged tag and none on target-only contacts', async () => {
      const s = await seed();
      const carriers = await db.transaction().execute(async (tx) => {
        const ids = await repo.mergeInto(s.a.workspaceId, s.clients, s.vip, tx);
        await history.appendMerged(
          s.a.workspaceId,
          ids,
          { id: s.clients, name: 'vip-clients' },
          { id: s.vip, name: 'VIP' },
          s.a.ownerAccountId,
          OWNER_TIME,
          tx,
        );
        return ids;
      });
      const entries = await db
        .selectFrom('contact_tag_history')
        .selectAll()
        .where('workspace_id', '=', s.a.workspaceId)
        .where('kind', '=', 'merged')
        .execute();
      expect(entries.map((e) => e.contact_id).sort()).toEqual([...carriers].sort());
      expect(entries).toHaveLength(3);
      for (const e of entries) {
        expect(e).toMatchObject({
          tag_id: s.clients,
          tag_name: 'vip-clients',
          merged_into_tag_id: s.vip,
          merged_into_name: 'VIP',
          actor_account_id: s.a.ownerAccountId,
          source: 'settings',
          created_at: OWNER_TIME,
        });
      }
      expect(new Set(entries.map((e) => e.id)).size).toBe(3);
      // A target-only contact has no merged entry; its own added entry stays.
      const targetOnly = s.vipContacts[5]!;
      expect(entries.some((e) => e.contact_id === targetOnly)).toBe(false);
    });

    it('delete returns exactly the 40 carriers and the deleted entries cover them', async () => {
      const s = await seed();
      const removed = await db.transaction().execute(async (tx) => {
        const ids = await repo.deleteLinksReturning(s.a.workspaceId, s.promo, tx);
        await history.appendDeleted(
          s.a.workspaceId,
          ids,
          { id: s.promo, name: 'Old promo' },
          s.a.ownerAccountId,
          OWNER_TIME,
          tx,
        );
        return ids;
      });
      expect([...removed].sort()).toEqual([...s.carriers].sort());
      const entries = await db
        .selectFrom('contact_tag_history')
        .selectAll()
        .where('workspace_id', '=', s.a.workspaceId)
        .where('kind', '=', 'deleted')
        .execute();
      expect(entries.map((e) => e.contact_id).sort()).toEqual([...s.carriers].sort());
      expect(entries.every((e) => e.tag_name === 'Old promo' && e.source === 'settings')).toBe(
        true,
      );
      expect(entries.every((e) => e.merged_into_tag_id === null)).toBe(true);
      expect(await tags.countFor(s.a.workspaceId, s.promo)).toBe(0);
      expect(await tags.delete(s.a.workspaceId, s.promo)).toBe(true);
    });

    it('delete and merge do nothing for an empty carrier list', async () => {
      const s = await seed();
      await db
        .transaction()
        .execute((tx) =>
          history.appendDeleted(
            s.a.workspaceId,
            [],
            { id: s.promo, name: 'Old promo' },
            s.a.ownerAccountId,
            OWNER_TIME,
            tx,
          ),
        );
      expect(
        await db
          .selectFrom('contact_tag_history')
          .select('id')
          .where('workspace_id', '=', s.a.workspaceId)
          .where('kind', '=', 'deleted')
          .execute(),
      ).toEqual([]);
    });

    it('touches nothing in another workspace (AC-12)', async () => {
      const s = await seed();
      const bLinks = await linksOf(s.b.workspaceId, s.b.tagId);
      // Workspace B asked about workspace A's tags: no carriers, nothing changes.
      expect(
        await db
          .transaction()
          .execute((tx) => repo.mergeInto(s.b.workspaceId, s.clients, s.vip, tx)),
      ).toEqual([]);
      expect(
        await db
          .transaction()
          .execute((tx) => repo.deleteLinksReturning(s.b.workspaceId, s.promo, tx)),
      ).toEqual([]);
      expect(await linksOf(s.a.workspaceId, s.clients)).toHaveLength(3);
      expect(await tags.countFor(s.a.workspaceId, s.promo)).toBe(40);
      // And a merge in A leaves B's same-named VIP links alone.
      await db.transaction().execute((tx) => repo.mergeInto(s.a.workspaceId, s.clients, s.vip, tx));
      expect(await linksOf(s.b.workspaceId, s.b.tagId)).toEqual(bLinks);
    });

    it('refuses history entries for contacts of another workspace (composite FK) and writes none', async () => {
      const s = await seed();
      await expect(
        db
          .transaction()
          .execute((tx) =>
            history.appendDeleted(
              s.a.workspaceId,
              [s.b.taggedContactId],
              { id: s.promo, name: 'Old promo' },
              s.a.ownerAccountId,
              OWNER_TIME,
              tx,
            ),
          ),
      ).rejects.toThrow();
      expect(
        await db
          .selectFrom('contact_tag_history')
          .select('id')
          .where('contact_id', '=', s.b.taggedContactId)
          .where('kind', '=', 'deleted')
          .execute(),
      ).toEqual([]);
    });
  });
});
