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
      sql`INSERT INTO memberships (id, workspace_id, account_id, role, state, created_at, active_since)
          VALUES (${newId()}, ${workspaceId}, ${account}, 'operator', ${state}, ${now}, ${now})`.execute(
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
      const down = await migrator.migrateTo('1791681109978_create_invitations');
      expect(down.error).toBeUndefined();
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

const INBOX_TABLES = ['replies', 'reply_attempts', 'read_marks'];
const LAST_PRE_INBOX = '1791681109982_create_messages';

describe('shared-inbox migrations 01-08', () => {
  let database: TestDatabase;
  let db: Kysely<unknown>;
  const now = new Date('2026-01-01T00:00:00Z');
  const later = new Date('2026-01-02T00:00:00Z');

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

  async function seed(handle: Kysely<unknown>) {
    const ws = newId();
    const account = newId();
    const contact = newId();
    const conversation = newId();
    await sql`INSERT INTO workspaces (id, name, created_at) VALUES (${ws}, 'Acme', ${now})`.execute(
      handle,
    );
    await sql`INSERT INTO accounts (id, email, display_name, password_hash, created_at)
      VALUES (${account}, ${`${account}@example.test`}, 'Test User', 'h', ${now})`.execute(handle);
    await sql`INSERT INTO contacts (id, workspace_id, telegram_user_id, first_name, profile_seen_at, created_at)
      VALUES (${contact}, ${ws}, 1, 'Test User', ${now}, ${now})`.execute(handle);
    await sql`INSERT INTO conversations (id, workspace_id, contact_id, telegram_chat_id, created_at)
      VALUES (${conversation}, ${ws}, ${contact}, 1, ${now})`.execute(handle);
    return { ws, account, conversation };
  }

  async function columns(handle: Kysely<unknown>, table: string): Promise<string[]> {
    const { rows } = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}`.execute(handle);
    return rows.map((r) => r.column_name);
  }

  async function tables(handle: Kysely<unknown>): Promise<string[]> {
    const { rows } = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`.execute(
      handle,
    );
    return rows.map((r) => r.table_name);
  }

  function insertReply(
    s: { ws: string; account: string; conversation: string },
    o: {
      clientKey?: string;
      body?: string;
      state?: string;
      reason?: string | null;
      sentAt?: Date | null;
      tgId?: number | null;
    } = {},
  ) {
    const state = o.state ?? 'sending';
    return sql`INSERT INTO replies (id, workspace_id, conversation_id, author_account_id, client_key, body,
        state, failure_reason, position_at, sent_at, telegram_message_id, created_at)
      VALUES (${newId()}, ${s.ws}, ${s.conversation}, ${s.account}, ${o.clientKey ?? newId()},
        ${o.body ?? 'Hello'}, ${state}, ${o.reason ?? null}, ${now}, ${o.sentAt ?? null},
        ${o.tgId ?? null}, ${now})`.execute(db);
  }

  async function insertAttempt(
    s: { ws: string; account: string; conversation: string },
    kind: string,
    initiator: string | null,
  ) {
    const reply = newId();
    await sql`INSERT INTO replies (id, workspace_id, conversation_id, author_account_id, client_key, body,
        state, position_at, created_at)
      VALUES (${reply}, ${s.ws}, ${s.conversation}, ${s.account}, ${newId()}, 'Hello', 'sending', ${now}, ${now})`.execute(
      db,
    );
    return sql`INSERT INTO reply_attempts (id, workspace_id, conversation_id, reply_id, kind,
        initiated_by_account_id, created_at)
      VALUES (${newId()}, ${s.ws}, ${s.conversation}, ${reply}, ${kind}, ${initiator}, ${now})`.execute(
      db,
    );
  }

  it('adds the expand columns and the three new tables', async () => {
    expect(await columns(db, 'memberships')).toContain('active_since');
    const conv = await columns(db, 'conversations');
    for (const c of ['last_activity_at', 'last_message_received_at', 'last_reply_sent_at'])
      expect(conv).toContain(c);
    const names = await tables(db);
    for (const t of INBOX_TABLES) expect(names).toContain(t);
    const { rows } = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`.execute(db);
    const idx = rows.map((r) => r.indexname);
    for (const i of [
      'replies_pending_idx',
      'replies_conversation_id_position_at_idx',
      'replies_workspace_id_sent_at_idx',
      'replies_author_account_id_idx',
      'messages_conversation_id_received_at_idx',
      'messages_conversation_id_sent_at_idx',
    ])
      expect(idx).toContain(i);
  });

  it('rejects a second reply with the same client key in a conversation (AC-11)', async () => {
    const s = await seed(db);
    const clientKey = newId();
    await insertReply(s, { clientKey });
    await expect(insertReply(s, { clientKey })).rejects.toThrow(
      /replies_conversation_id_client_key_key/,
    );
    await insertReply(s, { body: 'Hello' });
    await insertReply(s, { body: 'Hello' });
  });

  it('rejects a blank and an over-long reply body', async () => {
    const s = await seed(db);
    await expect(insertReply(s, { body: '  \n' })).rejects.toThrow(/replies_body_check/);
    await expect(insertReply(s, { body: 'x'.repeat(4097) })).rejects.toThrow(/replies_body_check/);
    await insertReply(s, { body: 'x'.repeat(4096) });
  });

  it('rejects inconsistent reply state columns', async () => {
    const s = await seed(db);
    await expect(insertReply(s, { state: 'sent', tgId: 5 })).rejects.toThrow(
      /replies_sent_at_state_check/,
    );
    await expect(insertReply(s, { state: 'sent', sentAt: later })).rejects.toThrow(
      /replies_telegram_message_id_state_check/,
    );
    await expect(insertReply(s, { state: 'not_delivered' })).rejects.toThrow(
      /replies_failure_reason_state_check/,
    );
    await expect(insertReply(s, { state: 'sending', reason: 'customer_blocked' })).rejects.toThrow(
      /replies_failure_reason_state_check/,
    );
    await expect(insertReply(s, { state: 'dancing' })).rejects.toThrow(/replies_state_check/);
    await expect(insertReply(s, { state: 'not_delivered', reason: 'because' })).rejects.toThrow(
      /replies_failure_reason_check/,
    );
    await insertReply(s, { state: 'sent', sentAt: later, tgId: 5 });
    await insertReply(s, { state: 'not_delivered', reason: 'delivery_interrupted' });
  });

  it('ties reply_attempts.initiated_by_account_id to kind', async () => {
    const s = await seed(db);
    await expect(insertAttempt(s, 'retry', s.account)).rejects.toThrow(
      /reply_attempts_initiator_check/,
    );
    await expect(insertAttempt(s, 'send', null)).rejects.toThrow(/reply_attempts_initiator_check/);
    await insertAttempt(s, 'send', s.account);
    await insertAttempt(s, 'retry', null);
  });

  it('constrains reply_attempts outcome and skipped', async () => {
    const s = await seed(db);
    await insertAttempt(s, 'send', s.account);
    const { rows } = await sql<{
      id: string;
    }>`SELECT id FROM reply_attempts WHERE conversation_id = ${s.conversation}`.execute(db);
    const id = rows[0]!.id;
    await expect(
      sql`UPDATE reply_attempts SET outcome = 'bogus', finished_at = ${later} WHERE id = ${id}`.execute(
        db,
      ),
    ).rejects.toThrow(/reply_attempts_outcome_check/);
    await expect(
      sql`UPDATE reply_attempts SET outcome = 'accepted', finished_at = ${later} WHERE id = ${id}`.execute(
        db,
      ),
    ).rejects.toThrow(/reply_attempts_skipped_check/);
    await expect(
      sql`UPDATE reply_attempts SET outcome = 'skipped', started_at = ${now}, finished_at = ${later} WHERE id = ${id}`.execute(
        db,
      ),
    ).rejects.toThrow(/reply_attempts_skipped_check/);
    await sql`UPDATE reply_attempts SET outcome = 'skipped', finished_at = ${later} WHERE id = ${id}`.execute(
      db,
    );
  });

  it('rejects a second read mark for one conversation and account', async () => {
    const s = await seed(db);
    const insert = () =>
      sql`INSERT INTO read_marks (id, workspace_id, conversation_id, account_id, read_through_at, created_at)
        VALUES (${newId()}, ${s.ws}, ${s.conversation}, ${s.account}, ${now}, ${now})`.execute(db);
    await insert();
    await expect(insert()).rejects.toThrow(/read_marks_conversation_id_account_id_key/);
  });

  it('backfills active_since and the conversation list columns on existing rows', async () => {
    const fresh = await startTestDatabase({
      migrationFolder: resolve(import.meta.dirname, '../../migrations'),
    });
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
      const downTo = await migrator.migrateTo(LAST_PRE_INBOX);
      expect(downTo.error).toBeUndefined();
      expect(await columns(freshDb, 'memberships')).not.toContain('active_since');
      const s = await seed(freshDb);
      await sql`INSERT INTO memberships (id, workspace_id, account_id, role, state, created_at)
        VALUES (${newId()}, ${s.ws}, ${s.account}, 'operator', 'active', ${now})`.execute(freshDb);
      for (const [n, at] of [
        [1, now],
        [2, later],
      ] as const)
        await sql`INSERT INTO messages (id, workspace_id, conversation_id, telegram_message_id, kind, body,
            telegram_message, sent_at, received_at)
          VALUES (${newId()}, ${s.ws}, ${s.conversation}, ${n}, 'text', 'hi',
            ${JSON.stringify({ message_id: n })}::jsonb, ${at}, ${at})`.execute(freshDb);
      const up = await migrator.migrateToLatest();
      expect(up.error).toBeUndefined();
      const m = await sql<{ active_since: Date }>`SELECT active_since FROM memberships`.execute(
        freshDb,
      );
      expect(m.rows[0]?.active_since).toEqual(now);
      const c = await sql<{
        last_activity_at: Date;
        last_message_received_at: Date;
        last_reply_sent_at: Date | null;
      }>`SELECT last_activity_at, last_message_received_at, last_reply_sent_at FROM conversations`.execute(
        freshDb,
      );
      expect(c.rows[0]?.last_activity_at).toEqual(later);
      expect(c.rows[0]?.last_message_received_at).toEqual(later);
      expect(c.rows[0]?.last_reply_sent_at).toBeNull();
    } finally {
      await freshDb.destroy();
      await fresh.stop();
    }
  });

  it('reverts and re-applies the inbox migrations', async () => {
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
      const down = await migrator.migrateTo(LAST_PRE_INBOX);
      expect(down.error).toBeUndefined();
      const after = await tables(freshDb);
      for (const t of INBOX_TABLES) expect(after).not.toContain(t);
      expect(await columns(freshDb, 'memberships')).not.toContain('active_since');
      expect(await columns(freshDb, 'conversations')).not.toContain('last_activity_at');
      const up = await migrator.migrateToLatest();
      expect(up.error).toBeUndefined();
      for (const t of INBOX_TABLES) expect(await tables(freshDb)).toContain(t);
    } finally {
      await freshDb.destroy();
      await fresh.stop();
    }
  });
});
