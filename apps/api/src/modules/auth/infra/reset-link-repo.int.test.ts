import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { hashToken } from '../../../platform/tokens.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { insertAccount, insertResetLink } from '../../../test/fixtures/auth.js';
import { createResetLinkRepo } from './reset-link-repo.js';

describe('reset link repo', () => {
  let database: TestDatabase;
  let db: Db;
  const repo = () => createResetLinkRepo(db);
  const now = new Date('2026-02-01T10:00:00Z');
  const later = (h: number) => new Date(now.getTime() + h * 3_600_000);

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const stateOf = async (tokenHash: Buffer) =>
    (
      await db
        .selectFrom('password_reset_links')
        .select('state')
        .where('token_hash', '=', tokenHash)
        .executeTakeFirstOrThrow()
    ).state;

  it('inserts a pending link', async () => {
    const acc = await insertAccount(db);
    const link = await repo().insert({
      accountId: acc.id,
      tokenHash: hashToken('t1'),
      expiresAt: later(24),
      now,
    });
    expect(link).toMatchObject({
      accountId: acc.id,
      state: 'pending',
      expiresAt: later(24),
      createdAt: now,
      closedAt: null,
    });
  });

  it('consume succeeds once, then returns undefined', async () => {
    const acc = await insertAccount(db);
    const l = await insertResetLink(db, acc.id, { createdAt: now });
    const first = await repo().consume(l.row.token_hash, now);
    expect(first).toMatchObject({ accountId: acc.id, state: 'used', closedAt: now });
    expect(await repo().consume(l.row.token_hash, now)).toBeUndefined();
  });

  it('consume refuses superseded, used and expired links without changing them', async () => {
    const acc = await insertAccount(db);
    const sup = await insertResetLink(db, acc.id, { state: 'superseded' });
    const used = await insertResetLink(db, acc.id, { state: 'used' });
    const expired = await insertResetLink(db, acc.id, {
      createdAt: later(-24),
      expiresAt: now,
    });
    for (const l of [sup, used, expired]) {
      expect(await repo().consume(l.row.token_hash, now)).toBeUndefined();
    }
    expect(await stateOf(sup.row.token_hash)).toBe('superseded');
    expect(await stateOf(used.row.token_hash)).toBe('used');
    expect(await stateOf(expired.row.token_hash)).toBe('pending');
    expect(await repo().consume(hashToken('missing'), now)).toBeUndefined();
  });

  it('concurrent consumes: exactly one wins', async () => {
    const acc = await insertAccount(db);
    const l = await insertResetLink(db, acc.id, { createdAt: now });
    const results = await Promise.all([
      repo().consume(l.row.token_hash, now),
      repo().consume(l.row.token_hash, now),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('supersedePending closes only pending links of that account', async () => {
    const a = await insertAccount(db);
    const b = await insertAccount(db);
    const a1 = await insertResetLink(db, a.id);
    const aUsed = await insertResetLink(db, a.id, { state: 'used' });
    const b1 = await insertResetLink(db, b.id);
    await repo().supersedePending(a.id, now);
    expect(await stateOf(a1.row.token_hash)).toBe('superseded');
    expect(await stateOf(aUsed.row.token_hash)).toBe('used');
    expect(await stateOf(b1.row.token_hash)).toBe('pending');
    const closed = await db
      .selectFrom('password_reset_links')
      .select('closed_at')
      .where('id', '=', a1.row.id)
      .executeTakeFirstOrThrow();
    expect(closed.closed_at).toEqual(now);
  });

  it('supersedePending is a no-op when nothing is pending', async () => {
    const acc = await insertAccount(db);
    await expect(repo().supersedePending(acc.id, now)).resolves.toBeUndefined();
  });
});
