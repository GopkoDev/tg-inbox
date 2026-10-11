import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { hashToken } from '../../../platform/tokens.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { insertAccount, insertSession } from '../../../test/fixtures/auth.js';
import { createSessionRepo } from './session-repo.js';

describe('session repo', () => {
  let database: TestDatabase;
  let db: Db;
  const repo = () => createSessionRepo(db);
  const now = new Date('2026-02-01T10:00:00Z');

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  it('inserts and finds by token hash', async () => {
    const acc = await insertAccount(db);
    const hash = hashToken('raw-1');
    const s = await repo().insert({ accountId: acc.id, tokenHash: hash, now });
    expect(s).toMatchObject({ accountId: acc.id, createdAt: now, lastSeenAt: now });
    expect(await repo().findByTokenHash(hash)).toEqual(s);
    expect(await repo().findByTokenHash(hashToken('other'))).toBeUndefined();
  });

  it('deleteByTokenHash removes only that session', async () => {
    const acc = await insertAccount(db);
    const s1 = await insertSession(db, acc.id);
    const s2 = await insertSession(db, acc.id);
    await repo().deleteByTokenHash(s1.row.token_hash);
    expect(await repo().findByTokenHash(s1.row.token_hash)).toBeUndefined();
    expect(await repo().findByTokenHash(s2.row.token_hash)).toBeDefined();
  });

  it('deleteByAccount ends every session of A, optionally sparing one, never touching B', async () => {
    const a = await insertAccount(db);
    const b = await insertAccount(db);
    const a1 = await insertSession(db, a.id);
    const a2 = await insertSession(db, a.id);
    const a3 = await insertSession(db, a.id);
    const b1 = await insertSession(db, b.id);

    expect(await repo().deleteByAccount(a.id, { exceptSessionId: a1.row.id })).toBe(2);
    expect(await repo().findByTokenHash(a1.row.token_hash)).toBeDefined();
    expect(await repo().findByTokenHash(a2.row.token_hash)).toBeUndefined();
    expect(await repo().findByTokenHash(a3.row.token_hash)).toBeUndefined();

    expect(await repo().deleteByAccount(a.id)).toBe(1);
    expect(await repo().findByTokenHash(b1.row.token_hash)).toBeDefined();
  });

  it('touch updates last_seen_at of that session only', async () => {
    const acc = await insertAccount(db);
    const s1 = await insertSession(db, acc.id);
    const s2 = await insertSession(db, acc.id);
    await repo().touch(s1.row.id, now);
    expect((await repo().findByTokenHash(s1.row.token_hash))?.lastSeenAt).toEqual(now);
    expect((await repo().findByTokenHash(s2.row.token_hash))?.lastSeenAt).toEqual(
      s2.row.last_seen_at,
    );
  });
});
