import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../platform/ids.js';
import { startTestDatabase, type TestDatabase } from './postgres.js';

const TABLES = [
  'accounts',
  'sessions',
  'sign_in_failures',
  'password_reset_links',
  'workspaces',
  'memberships',
  'invitations',
];

describe('workspace-operators migrations', () => {
  let database: TestDatabase;
  let db: Kysely<unknown>;
  const now = new Date('2026-01-01T00:00:00Z');
  const weekLater = new Date('2026-01-08T00:00:00Z');

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

  async function insertWorkspace(): Promise<string> {
    const id = newId();
    await sql`INSERT INTO workspaces (id, name, created_at) VALUES (${id}, 'Acme', ${now})`.execute(
      db,
    );
    return id;
  }

  function insertInvitation(workspaceId: string, email: string, token: Buffer) {
    return sql`INSERT INTO invitations (id, workspace_id, email, role, token_hash, state, expires_at, created_at)
      VALUES (${newId()}, ${workspaceId}, ${email}, 'operator', ${token}, 'pending', ${weekLater}, ${now})`.execute(
      db,
    );
  }

  it('creates the seven tables', async () => {
    const { rows } = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`.execute(db);
    const names = rows.map((r) => r.table_name);
    for (const table of TABLES) expect(names).toContain(table);
  });

  it('rejects a non-normalised accounts.email', async () => {
    await expect(
      sql`INSERT INTO accounts (id, email, display_name, password_hash, created_at)
          VALUES (${newId()}, ' Bob@x.com', 'Bob', 'h', ${now})`.execute(db),
    ).rejects.toThrow(/accounts_email_normalised_check/);
  });

  it('rejects a second pending invitation for the same workspace and email', async () => {
    const ws = await insertWorkspace();
    await insertInvitation(ws, 'a@x.com', Buffer.alloc(32, 2));
    await expect(insertInvitation(ws, 'a@x.com', Buffer.alloc(32, 3))).rejects.toThrow(
      /invitations_workspace_id_email_pending_key/,
    );
  });

  it('rejects a token hash that is not 32 bytes', async () => {
    const ws = await insertWorkspace();
    await expect(insertInvitation(ws, 'b@x.com', Buffer.alloc(5))).rejects.toThrow(
      /invitations_token_hash_length_check/,
    );
  });

  it('rejects a second membership and an inconsistent deactivation', async () => {
    const ws = await insertWorkspace();
    const account = newId();
    await sql`INSERT INTO accounts (id, email, display_name, password_hash, created_at)
              VALUES (${account}, 'm@x.com', 'M', 'h', ${now})`.execute(db);
    const insert = (workspaceId: string, state: string) =>
      sql`INSERT INTO memberships (id, workspace_id, account_id, role, state, created_at)
          VALUES (${newId()}, ${workspaceId}, ${account}, 'operator', ${state}, ${now})`.execute(
        db,
      );
    await insert(ws, 'active');
    await expect(insert(ws, 'active')).rejects.toThrow(/memberships_workspace_id_account_id_key/);
    const ws2 = await insertWorkspace();
    await expect(insert(ws2, 'deactivated')).rejects.toThrow(/memberships_deactivated_at_check/);
  });

  it('accepts a sign-in failure for an email with no account', async () => {
    await sql`INSERT INTO sign_in_failures (id, email, failed_at)
              VALUES (${newId()}, 'ghost@x.com', ${now})`.execute(db);
  });
});
