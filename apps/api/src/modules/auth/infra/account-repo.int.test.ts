import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { insertAccount } from '../../../test/fixtures/auth.js';
import { createAccountRepo } from './account-repo.js';

describe('account repo', () => {
  let database: TestDatabase;
  let db: Db;
  const repo = () => createAccountRepo(db);
  const now = new Date('2026-02-01T10:00:00Z');

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  it('inserts and finds by email and id', async () => {
    const a = await repo().insert({
      email: 'ann@example.test',
      displayName: 'Ann',
      passwordHash: 'h1',
      now,
    });
    expect(a).toMatchObject({ email: 'ann@example.test', displayName: 'Ann', createdAt: now });
    expect(await repo().findByEmail('ann@example.test')).toEqual(a);
    expect(await repo().findById(a.id)).toEqual(a);
    expect(await repo().findByEmail('nobody@example.test')).toBeUndefined();
  });

  it('surfaces a unique violation for a duplicate email, even concurrently', async () => {
    const input = { email: 'dup@example.test', displayName: 'D', passwordHash: 'h', now };
    const results = await Promise.allSettled([repo().insert(input), repo().insert(input)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((failed.reason as { code?: string }).code).toBe('23505');
  });

  it('findByIds returns only the requested accounts', async () => {
    const a = await insertAccount(db);
    const b = await insertAccount(db);
    await insertAccount(db);
    const found = await repo().findByIds([a.id, b.id]);
    expect(found.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(await repo().findByIds([])).toEqual([]);
  });

  it('updatePasswordHash changes only that account', async () => {
    const a = await insertAccount(db);
    const b = await insertAccount(db);
    await repo().updatePasswordHash(a.id, 'new-hash');
    expect((await repo().findById(a.id))?.passwordHash).toBe('new-hash');
    expect((await repo().findById(b.id))?.passwordHash).toBe(b.password_hash);
  });

  it('participates in a caller transaction (rolls back with it)', async () => {
    await expect(
      db.transaction().execute(async (tx) => {
        await repo().insert(
          { email: 'tx@example.test', displayName: 'T', passwordHash: 'h', now },
          tx,
        );
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await repo().findByEmail('tx@example.test')).toBeUndefined();
  });
});
