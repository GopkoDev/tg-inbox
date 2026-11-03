import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { TimeZoneInvalidError } from '../../../platform/errors.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { createWorkspaceTimeZone } from './time-zone.js';

describe('workspace time zone (Postgres)', () => {
  let database: TestDatabase;
  let db: Db;
  let zones: ReturnType<typeof createWorkspaceTimeZone>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    zones = createWorkspaceTimeZone({ db });
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  it('a new workspace has no time zone; setTimeZone stores it and timeZone reads it (AC-09)', async () => {
    const ws = await insertWorkspace(db);
    expect(await zones.timeZone(ws)).toBeNull();
    await db.transaction().execute((tx) => zones.setTimeZone(tx, ws, 'Europe/Kyiv'));
    expect(await zones.timeZone(ws)).toBe('Europe/Kyiv');
  });

  it('the zone can be changed to another valid zone', async () => {
    const ws = await insertWorkspace(db);
    await db.transaction().execute((tx) => zones.setTimeZone(tx, ws, 'Europe/Kyiv'));
    await db.transaction().execute((tx) => zones.setTimeZone(tx, ws, 'America/New_York'));
    expect(await zones.timeZone(ws)).toBe('America/New_York');
  });

  it('an invalid zone is refused with TimeZoneInvalidError and nothing is written', async () => {
    const ws = await insertWorkspace(db);
    await db.transaction().execute((tx) => zones.setTimeZone(tx, ws, 'Europe/Kyiv'));
    await expect(
      db.transaction().execute((tx) => zones.setTimeZone(tx, ws, 'Mars/Base')),
    ).rejects.toBeInstanceOf(TimeZoneInvalidError);
    expect(await zones.timeZone(ws)).toBe('Europe/Kyiv');
  });

  it('setting the same zone is not a write', async () => {
    const ws = await insertWorkspace(db);
    await db.transaction().execute((tx) => zones.setTimeZone(tx, ws, 'Europe/Kyiv'));
    // a trigger-free probe: the row's xmin changes on any UPDATE
    const xmin = async () =>
      (
        await db
          .selectFrom('workspaces')
          .select(sql<string>`xmin::text`.as('x'))
          .where('id', '=', ws)
          .executeTakeFirstOrThrow()
      ).x;
    const before = await xmin();
    await db.transaction().execute((tx) => zones.setTimeZone(tx, ws, 'Europe/Kyiv'));
    expect(await xmin()).toBe(before);
  });

  it('is isolated by workspace: setting one workspace leaves another untouched', async () => {
    const a = await insertWorkspace(db, 'A');
    const b = await insertWorkspace(db, 'B');
    await db.transaction().execute((tx) => zones.setTimeZone(tx, a, 'Europe/Kyiv'));
    expect(await zones.timeZone(b)).toBeNull();
    expect(await zones.timeZone(a)).toBe('Europe/Kyiv');
  });
});
