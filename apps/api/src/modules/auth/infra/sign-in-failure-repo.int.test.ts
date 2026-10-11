import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { insertSignInFailures } from '../../../test/fixtures/auth.js';
import { createSignInFailureRepo } from './sign-in-failure-repo.js';

describe('sign-in failure repo', () => {
  let database: TestDatabase;
  let db: Db;
  const repo = () => createSignInFailureRepo(db);
  const now = new Date('2026-02-01T10:00:00Z');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  it('records a failure and lists those of the last 30 minutes only', async () => {
    await repo().record('a@example.test', ago(1));
    await insertSignInFailures(db, 'a@example.test', [ago(29), ago(31), ago(120)]);
    const times = await repo().listRecent('a@example.test', now);
    expect(times.map((d) => d.getTime()).sort()).toEqual(
      [ago(29), ago(1)].map((d) => d.getTime()).sort(),
    );
  });

  it('never returns the failures of another email', async () => {
    await insertSignInFailures(db, 'b@example.test', [ago(2)]);
    await insertSignInFailures(db, 'c@example.test', [ago(3), ago(4)]);
    expect(await repo().listRecent('b@example.test', now)).toHaveLength(1);
    expect(await repo().listRecent('unknown@example.test', now)).toEqual([]);
  });

  it('clear deletes all failures of that email only', async () => {
    await insertSignInFailures(db, 'd@example.test', [ago(2), ago(60)]);
    await insertSignInFailures(db, 'e@example.test', [ago(2)]);
    await repo().clear('d@example.test');
    expect(await repo().listRecent('d@example.test', now)).toEqual([]);
    expect(await repo().listRecent('e@example.test', now)).toHaveLength(1);
  });
});
