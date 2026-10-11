import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { T0, twoWorkspaces } from '../../../test/fixtures/workspaces.js';
import { KyselyWorkspaceRepo } from './workspace-repo.js';

describe('KyselyWorkspaceRepo', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: KyselyWorkspaceRepo;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    repo = new KyselyWorkspaceRepo(db);
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  it('inserts and finds a workspace', async () => {
    const id = newId();
    await repo.insert({ id, name: 'Bolt Bikes', createdAt: T0 });
    expect(await repo.findById(id)).toEqual({ id, name: 'Bolt Bikes', createdAt: T0 });
  });

  it('isolation: findById returns only the requested workspace, none for an unknown id', async () => {
    const { a, b } = await twoWorkspaces(db);
    expect((await repo.findById(a))?.name).toBe('A');
    expect((await repo.findById(b))?.name).toBe('B');
    expect(await repo.findById(newId())).toBeNull();
  });

  it('isolation: lockForUpdate reports only the given workspace', async () => {
    const { a } = await twoWorkspaces(db);
    expect(
      await db.transaction().execute((trx) => new KyselyWorkspaceRepo(trx).lockForUpdate(a)),
    ).toBe(true);
    expect(
      await db.transaction().execute((trx) => new KyselyWorkspaceRepo(trx).lockForUpdate(newId())),
    ).toBe(false);
  });
});
