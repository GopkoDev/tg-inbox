import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './postgres.js';

const COLUMNS: Record<string, string[]> = {
  destinations: [
    'id',
    'workspace_id',
    'telegram_bot_id',
    'chat_id',
    'kind',
    'title',
    'availability',
    'connected_by_account_id',
  ],
  destination_codes: [
    'id',
    'workspace_id',
    'account_id',
    'code_hash',
    'expires_at',
    'used_at',
    'destination_id',
  ],
  posts: [
    'id',
    'workspace_id',
    'destination_id',
    'text',
    'silent',
    'state',
    'version',
    'author_account_id',
    'scheduled_for',
    'needs_attention',
  ],
};

describe('group-posts migrations (AC-04 tenancy schema)', () => {
  let database: TestDatabase;
  let db: Kysely<unknown>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = new Kysely<unknown>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: database.url }) }),
    });
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  async function columns(table: string): Promise<string[]> {
    const { rows } = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}`.execute(db);
    return rows.map((r) => r.column_name);
  }

  async function constraints(): Promise<string[]> {
    const { rows } = await sql<{ conname: string }>`SELECT conname FROM pg_constraint`.execute(db);
    return rows.map((r) => r.conname);
  }

  it('adds workspaces.time_zone', async () => {
    expect(await columns('workspaces')).toContain('time_zone');
  });

  for (const [table, cols] of Object.entries(COLUMNS)) {
    it(`creates ${table} with a non-null workspace_id`, async () => {
      const got = await columns(table);
      for (const c of cols) expect(got).toContain(c);
      const { rows } = await sql<{ is_nullable: string }>`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_name = ${table} AND column_name = 'workspace_id'`.execute(db);
      expect(rows[0]?.is_nullable).toBe('NO');
    });
  }

  it('has the tenancy key constraints', async () => {
    const names = await constraints();
    for (const n of [
      'destinations_workspace_id_id_key',
      'destinations_workspace_id_chat_id_key',
      'destination_codes_workspace_id_code_hash_key',
      'posts_workspace_id_id_key',
      'posts_destination_fkey',
      'posts_author_membership_fkey',
      'posts_state_check',
    ])
      expect(names).toContain(n);
  });
});
