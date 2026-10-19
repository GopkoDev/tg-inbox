import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDb, type Db } from '../../../platform/db.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertContactTag, insertTag, twoWorkspacesWithTags } from '../../../test/fixtures/tags.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import type { ContactListPosition } from '../app/ports.js';
import { createContactListQuery, listPageQuery, matchingCountQuery } from './contact-list-query.js';

const T0 = new Date('2026-09-01T10:00:00.000Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const none = { q: null, mode: 'any', tagIds: [] } as const;

describe('contacts list query', () => {
  let database: TestDatabase;
  let db: Db;
  let list: ReturnType<typeof createContactListQuery>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    list = createContactListQuery(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  async function workspace() {
    const workspaceId = await insertWorkspace(db);
    const owner = await insertMembership(db, workspaceId, { role: 'owner' });
    return { workspaceId, accountId: owner.accountId };
  }
  type W = Awaited<ReturnType<typeof workspace>>;
  const mkTag = (w: W, name: string) =>
    insertTag(db, { workspaceId: w.workspaceId, createdByAccountId: w.accountId, name });
  const link = (w: W, contactId: string, tagId: string) =>
    insertContactTag(db, {
      workspaceId: w.workspaceId,
      contactId,
      tagId,
      addedByAccountId: w.accountId,
      history: false,
    });

  async function walk(workspaceId: string, filter: Parameters<typeof list.listPage>[1] = none) {
    const pages: string[][] = [];
    let after: ContactListPosition | undefined;
    for (;;) {
      const page = await list.listPage(workspaceId, { ...filter, ...(after && { after }) });
      pages.push(page.rows.map((r) => r.id));
      if (!page.hasNext) return pages;
      const last = page.rows.at(-1)!;
      after = { lastWroteAt: last.lastWroteAt, id: last.id };
    }
  }

  describe('ordering and keyset (AC-01)', () => {
    it('orders by last wrote newest first, ties by id, the NULL tail last, and continues strictly', async () => {
      const w = await workspace();
      const ids: string[] = [];
      // 40 distinct dates, 12 sharing one date (the 50-row page boundary falls inside them), 60 never wrote.
      for (let i = 0; i < 40; i++) {
        ids.push(
          await insertContact(db, {
            workspaceId: w.workspaceId,
            firstWroteAt: at(i),
            lastWroteAt: at(1000 + i),
          }),
        );
      }
      for (let i = 0; i < 12; i++) {
        ids.push(
          await insertContact(db, {
            workspaceId: w.workspaceId,
            firstWroteAt: at(0),
            lastWroteAt: at(500),
          }),
        );
      }
      for (let i = 0; i < 60; i++)
        ids.push(await insertContact(db, { workspaceId: w.workspaceId }));

      const rows = await db
        .selectFrom('contacts')
        .select(['id', 'last_wrote_at'])
        .where('workspace_id', '=', w.workspaceId)
        .execute();
      const expected = rows
        .sort((x, y) => {
          if (x.last_wrote_at === null || y.last_wrote_at === null) {
            if (x.last_wrote_at !== y.last_wrote_at) return x.last_wrote_at === null ? 1 : -1;
          } else if (x.last_wrote_at.getTime() !== y.last_wrote_at.getTime()) {
            return y.last_wrote_at.getTime() - x.last_wrote_at.getTime();
          }
          return x.id < y.id ? 1 : -1;
        })
        .map((r) => r.id);

      const pages = await walk(w.workspaceId);
      expect(pages.map((p) => p.length)).toEqual([50, 50, 12]);
      expect(pages.flat()).toEqual(expected);
      expect(new Set(pages.flat()).size).toBe(112);
      expect(new Set(ids)).toEqual(new Set(expected));
    });

    it('returns the contact facts of a row with first and last wrote and null language', async () => {
      const w = await workspace();
      const id = await insertContact(db, {
        workspaceId: w.workspaceId,
        firstName: 'Olena',
        username: null,
        languageCode: null,
        firstWroteAt: at(1),
        lastWroteAt: at(2),
      });
      const page = await list.listPage(w.workspaceId, none);
      expect(page.rows).toEqual([
        {
          id,
          firstName: 'Olena',
          lastName: null,
          username: null,
          languageCode: null,
          firstWroteAt: at(1),
          lastWroteAt: at(2),
          tags: [],
        },
      ]);
      expect(page.hasNext).toBe(false);
    });

    it("shows each row's tags in tag-list order", async () => {
      const w = await workspace();
      const c = await insertContact(db, {
        workspaceId: w.workspaceId,
        firstWroteAt: at(-1),
        lastWroteAt: at(1),
      });
      const z = await mkTag(w, 'Zeta');
      const a = await mkTag(w, 'alpha');
      await link(w, c, z);
      await link(w, c, a);
      const page = await list.listPage(w.workspaceId, none);
      expect(page.rows[0]!.tags).toEqual([
        { id: a, name: 'alpha' },
        { id: z, name: 'Zeta' },
      ]);
    });
  });

  describe('search (AC-02)', () => {
    it('matches anywhere in the full name or username, ignoring case, "@" and spaces', async () => {
      const w = await workspace();
      const byName = await insertContact(db, {
        workspaceId: w.workspaceId,
        firstName: 'Anna TEST',
        firstWroteAt: at(-1),
        lastWroteAt: at(1),
      });
      const byUser = await insertContact(db, {
        workspaceId: w.workspaceId,
        firstName: 'Bo',
        username: 'a_tEsT_b',
        firstWroteAt: at(-1),
        lastWroteAt: at(2),
      });
      const cyr = await insertContact(db, {
        workspaceId: w.workspaceId,
        firstName: 'ОЛЕНА',
        firstWroteAt: at(-1),
        lastWroteAt: at(3),
      });
      await insertContact(db, {
        workspaceId: w.workspaceId,
        firstName: 'Other',
        firstWroteAt: at(-1),
        lastWroteAt: at(4),
      });
      const ids = async (q: string) =>
        (await list.listPage(w.workspaceId, { ...none, q })).rows.map((r) => r.id);
      expect(await ids('@Test ')).toEqual([byUser, byName]);
      expect(await ids('олена')).toEqual([cyr]);
      expect(await ids('%')).toEqual([]);
      expect(await list.matchingCount(w.workspaceId, { ...none, q: 'test' })).toBe(2);
      expect(await list.totalCount(w.workspaceId)).toBe(4);
    });
  });

  describe('any / all / none (AC-02)', () => {
    async function seeded() {
      const w = await workspace();
      const t1 = await mkTag(w, 'One');
      const t2 = await mkTag(w, 'Two');
      const t3 = await mkTag(w, 'Three');
      const c = async (n: number) =>
        insertContact(db, {
          workspaceId: w.workspaceId,
          firstName: `C${n}`,
          firstWroteAt: at(-1),
          lastWroteAt: at(n),
        });
      const both = await c(1);
      const onlyOne = await c(2);
      const onlyTwo = await c(3);
      const three = await c(4);
      const bare = await c(5);
      await link(w, both, t1);
      await link(w, both, t2);
      await link(w, onlyOne, t1);
      await link(w, onlyTwo, t2);
      await link(w, three, t3);
      return { w, t1, t2, t3, both, onlyOne, onlyTwo, three, bare };
    }
    const idsOf = async (w: string, f: Parameters<typeof list.listPage>[1]) =>
      (await list.listPage(w, f)).rows.map((r) => r.id);

    it('any keeps contacts carrying at least one chosen tag', async () => {
      const s = await seeded();
      const f = { q: null, mode: 'any', tagIds: [s.t1, s.t2] } as const;
      expect(await idsOf(s.w.workspaceId, f)).toEqual([s.onlyTwo, s.onlyOne, s.both]);
      expect(await list.matchingCount(s.w.workspaceId, f)).toBe(3);
      expect(await list.totalCount(s.w.workspaceId)).toBe(5);
    });

    it('all keeps contacts carrying every chosen tag, and one tag is the same as any', async () => {
      const s = await seeded();
      const f = { q: null, mode: 'all', tagIds: [s.t1, s.t2] } as const;
      expect(await idsOf(s.w.workspaceId, f)).toEqual([s.both]);
      expect(await list.matchingCount(s.w.workspaceId, f)).toBe(1);
      const one = { q: null, mode: 'all', tagIds: [s.t1] } as const;
      expect(await idsOf(s.w.workspaceId, one)).toEqual([s.onlyOne, s.both]);
      // A repeated id still means one tag.
      expect(await idsOf(s.w.workspaceId, { ...f, tagIds: [s.t1, s.t1, s.t2] })).toEqual([s.both]);
    });

    it('none keeps contacts with no tag at all', async () => {
      const s = await seeded();
      const f = { q: null, mode: 'none', tagIds: [] } as const;
      expect(await idsOf(s.w.workspaceId, f)).toEqual([s.bare]);
      expect(await list.matchingCount(s.w.workspaceId, f)).toBe(1);
    });

    it('any and all with no tag chosen filter nothing; search and tags combine', async () => {
      const s = await seeded();
      for (const mode of ['any', 'all'] as const) {
        const f = { q: null, mode, tagIds: [] };
        expect(await list.matchingCount(s.w.workspaceId, f)).toBe(5);
        expect((await idsOf(s.w.workspaceId, f)).length).toBe(5);
      }
      const combined = { q: 'c2', mode: 'any', tagIds: [s.t1, s.t2] } as const;
      expect(await idsOf(s.w.workspaceId, combined)).toEqual([s.onlyOne]);
      expect(await list.matchingCount(s.w.workspaceId, combined)).toBe(1);
      expect(
        await list.matchingCount(s.w.workspaceId, { ...combined, mode: 'none', tagIds: [] }),
      ).toBe(0);
    });

    it('paginates a filtered list with the keyset and counts all matches', async () => {
      const w = await workspace();
      const t = await mkTag(w, 'Many');
      for (let i = 0; i < 70; i++) {
        const c = await insertContact(db, {
          workspaceId: w.workspaceId,
          firstWroteAt: at(-1),
          lastWroteAt: at(i % 7),
        });
        if (i % 2 === 0) await link(w, c, t);
      }
      const f = { q: null, mode: 'any', tagIds: [t] } as const;
      expect((await walk(w.workspaceId, f)).map((p) => p.length)).toEqual([35]);
      expect(await list.matchingCount(w.workspaceId, f)).toBe(35);
      const nonef = { q: null, mode: 'none', tagIds: [] } as const;
      expect((await walk(w.workspaceId, nonef)).map((p) => p.length)).toEqual([35]);
    });
  });

  describe('workspace isolation (AC-12)', () => {
    it("never lists, filters or counts another workspace's contacts or tags", async () => {
      const { a, b } = await twoWorkspacesWithTags(db);
      const aPage = await list.listPage(a.workspaceId, none);
      expect(aPage.rows.map((r) => r.id).sort()).toEqual([...a.contactIds].sort());
      expect(await list.totalCount(a.workspaceId)).toBe(2);
      // B's tag id used in A's workspace matches nothing, in every mode.
      for (const mode of ['any', 'all'] as const) {
        const f = { q: null, mode, tagIds: [b.tagId] };
        expect(await list.listPage(a.workspaceId, f)).toEqual({ rows: [], hasNext: false });
        expect(await list.matchingCount(a.workspaceId, f)).toBe(0);
      }
      // A's own tag in A finds exactly the tagged contact; in B it finds nothing.
      const own = { q: null, mode: 'any', tagIds: [a.tagId] } as const;
      expect((await list.listPage(a.workspaceId, own)).rows.map((r) => r.id)).toEqual([
        a.taggedContactId,
      ]);
      expect(await list.matchingCount(b.workspaceId, own)).toBe(0);
      // "No tags" in B counts B's untagged contact only.
      expect(await list.matchingCount(b.workspaceId, { q: null, mode: 'none', tagIds: [] })).toBe(
        1,
      );
      // A contact of A is not found through B's search; tags on rows are the workspace's own.
      expect(
        (await list.listPage(b.workspaceId, none)).rows.every((r) => b.contactIds.includes(r.id)),
      ).toBe(true);
    });
  });

  describe('plans (QG-3, data-model assumption 10)', () => {
    const planText = async (build: (tx: Db) => { explain: (f: 'json') => Promise<unknown[]> }) =>
      db.transaction().execute(async (tx) => {
        // On a small table the planner prefers sequential scans; check the plan it can use.
        await sql`SET LOCAL enable_seqscan = off`.execute(tx);
        const rows = await build(tx).explain('json');
        return JSON.stringify(rows);
      });

    async function bigWorkspace() {
      const w = await workspace();
      const t1 = await mkTag(w, 'P');
      const t2 = await mkTag(w, 'Q');
      for (let i = 0; i < 300; i++) {
        const c = await insertContact(db, {
          workspaceId: w.workspaceId,
          firstWroteAt: at(-1),
          lastWroteAt: at(i),
        });
        if (i % 2 === 0) await link(w, c, t1);
        if (i % 3 === 0) await link(w, c, t2);
      }
      await sql`ANALYZE contacts, contact_tags`.execute(db);
      return { w, t1, t2 };
    }

    it('the first page and a continued page use the keyset index', async () => {
      const { w } = await bigWorkspace();
      const first = await planText((tx) => listPageQuery(tx, w.workspaceId, none));
      expect(first).toContain('contacts_workspace_id_last_wrote_at_id_idx');
      const next = await planText((tx) =>
        listPageQuery(tx, w.workspaceId, {
          ...none,
          after: { lastWroteAt: at(100), id: '0199ffff-ffff-7fff-8fff-ffffffffffff' },
        }),
      );
      expect(next).toContain('contacts_workspace_id_last_wrote_at_id_idx');
    });

    it('all-of runs as the grouped semi-join, not a correlated count per contact', async () => {
      const { w, t1, t2 } = await bigWorkspace();
      const plan = await planText((tx) =>
        matchingCountQuery(tx, w.workspaceId, { q: null, mode: 'all', tagIds: [t1, t2] }),
      );
      // One grouped pass over the workspace's links (Aggregate on contact_id with the count filter),
      // joined to contacts by its key; never a SubPlan probed once per contact.
      expect(plan).toMatch(/"Node Type":"Aggregate"/);
      expect(plan).toMatch(/"Group Key":\["contact_tags\.contact_id"\]/);
      expect(plan).toMatch(/"Filter":"\(count\(\*\) = /);
      expect(plan).not.toContain('"Parent Relationship":"SubPlan"');
      const page = await planText((tx) =>
        listPageQuery(tx, w.workspaceId, { q: null, mode: 'all', tagIds: [t1, t2] }),
      );
      expect(page).toMatch(/"Group Key":\["contact_tags\.contact_id"\]/);
      expect(page).not.toContain('"Parent Relationship":"SubPlan"');
      // The semantics hold at this size too: multiples of 6 carry both tags.
      const ids = await list.listPage(w.workspaceId, { q: null, mode: 'all', tagIds: [t1, t2] });
      expect(ids.rows).toHaveLength(50);
      expect(
        await list.matchingCount(w.workspaceId, { q: null, mode: 'all', tagIds: [t1, t2] }),
      ).toBe(50);
    });
  });
});
