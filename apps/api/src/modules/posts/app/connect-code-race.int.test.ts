import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDeps } from '../../../deps.js';
import { createDb, type Db } from '../../../platform/db.js';
import { insertBot } from '../../../test/fixtures/bots.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, testConfig, type TestDatabase } from '../../../test/postgres.js';

describe('concurrent connect-code creation leaves one live code, the later one (AC-01)', () => {
  let database: TestDatabase;
  let deps: ReturnType<typeof buildDeps>;
  let db: Db;

  beforeAll(async () => {
    database = await startTestDatabase();
    deps = buildDeps(testConfig(database.url));
    db = createDb(database.url);
  }, 120_000);
  afterAll(async () => {
    await deps?.destroy();
    await db?.destroy();
    await database?.stop();
  });

  it('two parallel creates: exactly one waiting code, and it is the one with the later insert', async () => {
    const ws = await insertWorkspace(db, 'Acme Flowers');
    const { accountId } = await insertMembership(db, ws, { role: 'owner' });
    await insertBot(db, { workspaceId: ws });
    const actor = { accountId, role: 'owner' as const };
    const made = await Promise.all([
      deps.posts.destinations.createCode(ws, actor),
      deps.posts.destinations.createCode(ws, actor),
    ]);
    const rows = await sql<{ id: string; replaced_at: Date | null; created_at: Date }>`
      SELECT id, replaced_at, created_at FROM destination_codes WHERE workspace_id = ${ws}
      ORDER BY created_at, id`.execute(db);
    expect(rows.rows).toHaveLength(2);
    const live = rows.rows.filter((r) => r.replaced_at === null);
    expect(live).toHaveLength(1);
    const latest = [...rows.rows].sort(
      (a, b) => b.created_at.getTime() - a.created_at.getTime() || (a.id < b.id ? 1 : -1),
    )[0];
    expect(live[0]?.id).toBe(latest?.id);
    expect(made.map((m) => m.id)).toContain(live[0]?.id);
  });
});
