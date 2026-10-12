import { resolve } from 'node:path';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import { TSFileMigrationProvider } from 'kysely-ctl';
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

const BOT_CONNECTION_TABLES = ['bots', 'contacts', 'conversations', 'messages'];

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

describe('bot-connection migrations', () => {
  let database: TestDatabase;
  let db: Kysely<unknown>;
  const now = new Date('2026-01-01T00:00:00Z');
  const token = Buffer.alloc(40, 1);
  const secretHash = Buffer.alloc(32, 2);
  let botId = 100;

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

  function insertBot(
    workspaceId: string,
    telegramBotId: number,
    state = 'connected',
    tokenEncrypted: Buffer | null = token,
  ) {
    return sql`INSERT INTO bots (id, workspace_id, telegram_bot_id, name, username, state,
        token_encrypted, webhook_secret_hash, connected_at, last_checked_at, created_at)
      VALUES (${newId()}, ${workspaceId}, ${telegramBotId}, 'Test Bot', 'test_bot', ${state},
        ${tokenEncrypted}, ${secretHash}, ${now}, ${now}, ${now})`.execute(db);
  }

  async function insertConversation(workspaceId: string): Promise<string> {
    const contactId = newId();
    const conversationId = newId();
    await sql`INSERT INTO contacts (id, workspace_id, telegram_user_id, first_name, profile_seen_at, created_at)
      VALUES (${contactId}, ${workspaceId}, 1, 'Test User', ${now}, ${now})`.execute(db);
    await sql`INSERT INTO conversations (id, workspace_id, contact_id, telegram_chat_id, created_at)
      VALUES (${conversationId}, ${workspaceId}, ${contactId}, 1, ${now})`.execute(db);
    return conversationId;
  }

  function insertMessage(
    workspaceId: string,
    conversationId: string,
    telegramMessageId: number,
    kind = 'text',
    body: string | null = 'hi',
  ) {
    return sql`INSERT INTO messages (id, workspace_id, conversation_id, telegram_message_id, kind, body,
        telegram_message, sent_at, received_at)
      VALUES (${newId()}, ${workspaceId}, ${conversationId}, ${telegramMessageId}, ${kind}, ${body},
        ${JSON.stringify({ message_id: telegramMessageId })}::jsonb, ${now}, ${now})`.execute(db);
  }

  it('creates the four tables', async () => {
    const { rows } = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`.execute(db);
    const names = rows.map((r) => r.table_name);
    for (const table of BOT_CONNECTION_TABLES) expect(names).toContain(table);
  });

  it('rejects a second bot for one workspace (AC-05)', async () => {
    const ws = await insertWorkspace();
    await insertBot(ws, ++botId);
    await expect(insertBot(ws, ++botId)).rejects.toThrow(/bots_workspace_id_key/);
  });

  it('rejects one telegram bot for a second workspace (AC-04)', async () => {
    const shared = ++botId;
    await insertBot(await insertWorkspace(), shared);
    await expect(insertBot(await insertWorkspace(), shared)).rejects.toThrow(
      /bots_telegram_bot_id_key/,
    );
  });

  it('rejects a connected bot without a token', async () => {
    const ws = await insertWorkspace();
    await expect(insertBot(ws, ++botId, 'connected', null)).rejects.toThrow(
      /bots_token_encrypted_state_check/,
    );
  });

  it('rejects a disconnected bot that still holds a token', async () => {
    const ws = await insertWorkspace();
    await expect(insertBot(ws, ++botId, 'disconnected')).rejects.toThrow(/bots_.*_state_check/);
  });

  it('rejects a duplicate message per conversation (AC-11)', async () => {
    const ws = await insertWorkspace();
    const conversation = await insertConversation(ws);
    await insertMessage(ws, conversation, 7);
    await expect(insertMessage(ws, conversation, 7)).rejects.toThrow(
      /messages_conversation_id_telegram_message_id_key/,
    );
  });

  it('rejects an unknown kind and a text message without body', async () => {
    const ws = await insertWorkspace();
    const conversation = await insertConversation(ws);
    await expect(insertMessage(ws, conversation, 1, 'hologram')).rejects.toThrow(
      /messages_kind_check/,
    );
    await expect(insertMessage(ws, conversation, 2, 'text', null)).rejects.toThrow(
      /messages_body_text_check/,
    );
  });

  it('accepts a very long body (no length checks on Telegram strings)', async () => {
    const ws = await insertWorkspace();
    const conversation = await insertConversation(ws);
    await insertMessage(ws, conversation, 3, 'text', 'x'.repeat(20_000));
  });

  it('reverts and re-applies the four bot-connection migrations', async () => {
    const fresh = await startTestDatabase();
    const freshDb = new Kysely<unknown>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: fresh.url }) }),
    });
    try {
      const migrator = new Migrator({
        db: freshDb,
        provider: new TSFileMigrationProvider({
          migrationFolder: resolve(import.meta.dirname, '../../migrations'),
        }),
      });
      const tables = async () =>
        (
          await sql<{ table_name: string }>`
            SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`.execute(
            freshDb,
          )
        ).rows.map((r) => r.table_name);
      for (let i = 0; i < 4; i++) {
        const { error } = await migrator.migrateDown();
        expect(error).toBeUndefined();
      }
      const after = await tables();
      for (const table of BOT_CONNECTION_TABLES) expect(after).not.toContain(table);
      expect(after).toContain('invitations');
      const { error } = await migrator.migrateToLatest();
      expect(error).toBeUndefined();
      const reapplied = await tables();
      for (const table of BOT_CONNECTION_TABLES) expect(reapplied).toContain(table);
    } finally {
      await freshDb.destroy();
      await fresh.stop();
    }
  });
});
