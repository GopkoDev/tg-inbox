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
      },
    ]);
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
});
