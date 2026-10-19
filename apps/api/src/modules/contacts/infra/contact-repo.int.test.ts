import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertWorkspace, twoWorkspaces } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import type { ContactProfile } from '../app/ports.js';
import { createContactRepo } from './contact-repo.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
let nextUserId = 1000n;

const profile = (o: Partial<ContactProfile> = {}): ContactProfile => ({
  telegramUserId: nextUserId++,
  firstName: 'Test User',
  lastName: null,
  username: 'test_user_1',
  languageCode: 'en',
  ...o,
});

describe('contact repository', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: ReturnType<typeof createContactRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    repo = createContactRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const rowsOf = (workspaceId: string) =>
    db.selectFrom('contacts').selectAll().where('workspace_id', '=', workspaceId).execute();

  it('inserts a new contact under the given workspace with every profile field', async () => {
    const w = await insertWorkspace(db);
    const p = profile({ lastName: 'Tester', languageCode: 'uk' });
    const result = await repo.upsertFromProfile(w, p, at(1), at(100));
    expect(result.created).toBe(true);
    expect(await rowsOf(w)).toEqual([
      {
        id: result.contactId,
        workspace_id: w,
        telegram_user_id: String(p.telegramUserId),
        first_name: 'Test User',
        last_name: 'Tester',
        username: 'test_user_1',
        language_code: 'uk',
        profile_seen_at: at(1),
        created_at: at(100),
        first_wrote_at: at(1),
        last_wrote_at: at(1),
      },
    ]);
  });

  describe('first and last wrote (ADR-0005, AC-01)', () => {
    const wrote = async (w: string) => {
      const [row] = await rowsOf(w);
      return { first: row!.first_wrote_at, last: row!.last_wrote_at, name: row!.first_name };
    };

    it('widens last wrote on a newer message and keeps first wrote', async () => {
      const w = await insertWorkspace(db);
      const p = profile();
      await repo.upsertFromProfile(w, p, at(10), at(100));
      await repo.upsertFromProfile(w, { ...p, firstName: 'Newer' }, at(20), at(101));
      expect(await wrote(w)).toEqual({ first: at(10), last: at(20), name: 'Newer' });
    });

    it('lowers first wrote for an older message delivered after a newer one, leaving the profile', async () => {
      const w = await insertWorkspace(db);
      const p = profile();
      await repo.upsertFromProfile(w, p, at(20), at(100));
      const older = await repo.upsertFromProfile(w, { ...p, firstName: 'Older' }, at(5), at(101));
      expect(older.created).toBe(false);
      expect(await wrote(w)).toEqual({ first: at(5), last: at(20), name: 'Test User' });
      const [row] = await rowsOf(w);
      expect(row!.profile_seen_at).toEqual(at(20));
    });

    it('a message between the two times changes nothing; a redelivered duplicate changes nothing', async () => {
      const w = await insertWorkspace(db);
      const p = profile();
      await repo.upsertFromProfile(w, p, at(10), at(100));
      await repo.upsertFromProfile(w, p, at(30), at(101));
      await repo.upsertFromProfile(w, { ...p, firstName: 'Mid' }, at(20), at(102));
      await repo.upsertFromProfile(w, { ...p, firstName: 'Dup' }, at(30), at(103));
      await repo.upsertFromProfile(w, p, at(10), at(104));
      expect(await wrote(w)).toEqual({ first: at(10), last: at(30), name: 'Test User' });
    });

    it('isolation: the same Telegram user in another workspace keeps its own times', async () => {
      const { a, b } = await twoWorkspaces(db);
      const p = profile();
      await repo.upsertFromProfile(a, p, at(10), at(100));
      await repo.upsertFromProfile(b, p, at(50), at(100));
      await repo.upsertFromProfile(a, p, at(5), at(101));
      expect(await wrote(a)).toMatchObject({ first: at(5), last: at(10) });
      expect(await wrote(b)).toMatchObject({ first: at(50), last: at(50) });
    });
  });

  it('refreshes only from a newer message and returns the existing id otherwise (AC-08)', async () => {
    const w = await insertWorkspace(db);
    const p = profile();
    const first = await repo.upsertFromProfile(w, p, at(5), at(100));
    const newer = await repo.upsertFromProfile(
      w,
      { ...p, firstName: 'Renamed', username: null, languageCode: null },
      at(6),
      at(101),
    );
    expect(newer).toEqual({ contactId: first.contactId, created: false });
    expect(await rowsOf(w)).toMatchObject([
      {
        first_name: 'Renamed',
        username: null,
        language_code: null,
        profile_seen_at: at(6),
        created_at: at(100),
      },
    ]);
    const older = await repo.upsertFromProfile(w, { ...p, firstName: 'Old' }, at(2), at(102));
    const same = await repo.upsertFromProfile(
      w,
      { ...p, firstName: 'Same second' },
      at(6),
      at(103),
    );
    expect(older).toEqual({ contactId: first.contactId, created: false });
    expect(same).toEqual({ contactId: first.contactId, created: false });
    expect(await rowsOf(w)).toMatchObject([{ first_name: 'Renamed', profile_seen_at: at(6) }]);
  });

  it('isolation: upsert never returns or changes the other workspace’s contact (AC-13)', async () => {
    const { a, b } = await twoWorkspaces(db);
    const p = profile();
    const inA = await insertContact(db, {
      workspaceId: a,
      telegramUserId: p.telegramUserId,
      profileSeenAt: at(1),
    });
    const inB = await repo.upsertFromProfile(b, { ...p, firstName: 'Only B' }, at(9), at(100));
    expect(inB.created).toBe(true);
    expect(inB.contactId).not.toBe(inA);
    expect(await rowsOf(a)).toMatchObject([
      { id: inA, first_name: 'Test User', profile_seen_at: at(1) },
    ]);
    expect(await rowsOf(b)).toMatchObject([{ id: inB.contactId, first_name: 'Only B' }]);
  });

  it('isolation: count is per workspace (AC-13, AC-15)', async () => {
    const { a, b } = await twoWorkspaces(db);
    const shared = profile();
    await repo.upsertFromProfile(a, shared, at(1), at(1));
    await repo.upsertFromProfile(a, profile(), at(1), at(1));
    await repo.upsertFromProfile(b, shared, at(1), at(1));
    expect(await repo.count(a)).toBe(2);
    expect(await repo.count(b)).toBe(1);
    expect(await repo.count(await insertWorkspace(db))).toBe(0);
  });

  it('two concurrent first upserts produce one row and the same id', async () => {
    const w = await insertWorkspace(db);
    const p = profile();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => repo.upsertFromProfile(w, p, at(i % 2), at(100))),
    );
    expect(await rowsOf(w)).toHaveLength(1);
    expect(new Set(results.map((r) => r.contactId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it('joins a caller transaction and rolls back with it', async () => {
    const w = await insertWorkspace(db);
    await expect(
      db.transaction().execute(async (tx) => {
        await repo.upsertFromProfile(w, profile(), at(1), at(1), tx);
        expect(await repo.count(w, tx)).toBe(1);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await repo.count(w)).toBe(0);
  });
  describe('search and lookup (AC-02)', () => {
    const add = (w: string, firstName: string, lastName: string | null, username: string | null) =>
      repo
        .upsertFromProfile(w, profile({ firstName, lastName, username }), at(1), at(1))
        .then((r) => r.contactId);

    it('trims, drops one leading @ and matches name or username', async () => {
      const w = await insertWorkspace(db);
      const olena = await add(w, 'Olena', 'Kravets', 'olena_k');
      await add(w, 'Petro', null, 'petro');
      expect(await repo.searchContactIds(w, '  @Olena ')).toEqual([olena]);
      expect(await repo.searchContactIds(w, 'OLENA_K')).toEqual([olena]);
      expect(await repo.searchContactIds(w, '@@olena')).toEqual([]);
    });

    it('folds case in Cyrillic as well as Latin', async () => {
      const w = await insertWorkspace(db);
      const id = await add(w, 'Олена', 'Коваль', null);
      expect(await repo.searchContactIds(w, 'олена')).toEqual([id]);
      expect(await repo.searchContactIds(w, 'КОВАЛЬ')).toEqual([id]);
    });

    it('matches across first and last name and anywhere in the text', async () => {
      const w = await insertWorkspace(db);
      const id = await add(w, 'Olena', 'Kravets', null);
      const noLast = await add(w, 'Ivan', null, null);
      expect(await repo.searchContactIds(w, 'Olena Kr')).toEqual([id]);
      expect(await repo.searchContactIds(w, 'ena kra')).toEqual([id]);
      expect(await repo.searchContactIds(w, 'Ivan')).toEqual([noLast]);
    });

    it('treats % _ and \\ literally', async () => {
      const w = await insertWorkspace(db);
      const pct = await add(w, '50% Off', null, null);
      const us = await add(w, 'a_b', null, null);
      await add(w, 'axb', null, null);
      await add(w, 'Other', null, null);
      expect(await repo.searchContactIds(w, '%')).toEqual([pct]);
      expect(await repo.searchContactIds(w, 'a_b')).toEqual([us]);
      expect(await repo.searchContactIds(w, '\\')).toEqual([]);
    });

    it('returns null (no filter) for an empty query, "@" or spaces', async () => {
      const w = await insertWorkspace(db);
      await add(w, 'Olena', null, null);
      expect(await repo.searchContactIds(w, '')).toBeNull();
      expect(await repo.searchContactIds(w, '  @ ')).toBeNull();
    });

    it('isolation: search and lookup never cross workspaces', async () => {
      const { a, b } = await twoWorkspaces(db);
      const inA = await add(a, 'Olena', 'Kravets', 'olena_k');
      const inB = await add(b, 'Olena', 'Kravets', 'olena_k');
      expect(await repo.searchContactIds(a, 'olena')).toEqual([inA]);
      expect(await repo.searchContactIds(b, 'olena')).toEqual([inB]);
      expect(await repo.contactsByIds(a, [inA, inB])).toEqual([
        { id: inA, firstName: 'Olena', lastName: 'Kravets', username: 'olena_k' },
      ]);
    });

    it('contactsByIds returns summaries and tolerates empty or unknown ids', async () => {
      const w = await insertWorkspace(db);
      const id = await add(w, 'Ivan', null, null);
      expect(await repo.contactsByIds(w, [])).toEqual([]);
      expect(await repo.contactsByIds(w, [id, '0199ffff-ffff-7fff-8fff-ffffffffffff'])).toEqual([
        { id, firstName: 'Ivan', lastName: null, username: null },
      ]);
    });
  });

  describe('lockContact (ADR-0004 step 2, AC-12)', () => {
    it('finds a contact of the workspace and not one of another', async () => {
      const { a, b } = await twoWorkspaces(db);
      const inA = await insertContact(db, { workspaceId: a });
      await db.transaction().execute(async (tx) => {
        expect(await repo.lockContact(a, inA, tx)).toBe(true);
        expect(await repo.lockContact(b, inA, tx)).toBe(false);
        expect(await repo.lockContact(a, '0199ffff-ffff-7fff-8fff-ffffffffffff', tx)).toBe(false);
      });
    });

    it('holds FOR NO KEY UPDATE: a second lock waits, a different contact does not', async () => {
      const w = await insertWorkspace(db);
      const one = await insertContact(db, { workspaceId: w });
      const two = await insertContact(db, { workspaceId: w });
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const taken = new Promise<void>((r) => (locked = r));
      const first = db.transaction().execute(async (tx) => {
        await repo.lockContact(w, one, tx);
        locked();
        await held;
      });
      await taken;
      let waiting = true;
      const same = db
        .transaction()
        .execute((tx) => repo.lockContact(w, one, tx))
        .then(() => (waiting = false));
      await db.transaction().execute((tx) => repo.lockContact(w, two, tx));
      await new Promise((r) => setTimeout(r, 300));
      expect(waiting).toBe(true);
      release();
      await first;
      await same;
      expect(waiting).toBe(false);
    });
  });

  describe('profile (AC-04, AC-12)', () => {
    it('reads the contact with its first and last wrote, and nothing of another workspace', async () => {
      const { a, b } = await twoWorkspaces(db);
      const p = profile({ lastName: 'Tester', languageCode: null, username: null });
      const { contactId } = await repo.upsertFromProfile(a, p, at(5), at(100));
      await repo.upsertFromProfile(a, p, at(9), at(101));
      expect(await repo.profile(a, contactId)).toEqual({
        id: contactId,
        workspaceId: a,
        telegramUserId: p.telegramUserId,
        firstName: 'Test User',
        lastName: 'Tester',
        username: null,
        languageCode: null,
        profileSeenAt: at(9),
        createdAt: at(100),
        firstWroteAt: at(5),
        lastWroteAt: at(9),
      });
      expect(await repo.profile(b, contactId)).toBeNull();
      expect(await repo.profile(a, '0199ffff-ffff-7fff-8fff-ffffffffffff')).toBeNull();
    });
  });
});
