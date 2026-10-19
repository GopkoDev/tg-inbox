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
    await sql`INSERT INTO conversations (id, workspace_id, contact_id, telegram_chat_id, created_at,
        last_activity_at, last_message_received_at, status, state_version, customer_message_seq)
      VALUES (${conversationId}, ${workspaceId}, ${contactId}, 1, ${now}, ${now}, ${now}, 'open', 0, 0)`.execute(
      db,
    );
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

  /** `listColumns: false` seeds a database migrated down before the list columns exist. */
  async function seed(handle: Kysely<unknown>, listColumns = true) {
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
    if (listColumns) {
      await sql`INSERT INTO conversations (id, workspace_id, contact_id, telegram_chat_id, created_at,
          last_activity_at, last_message_received_at, status, state_version, customer_message_seq)
        VALUES (${conversation}, ${ws}, ${contact}, 1, ${now}, ${now}, ${now}, 'open', 0, 0)`.execute(
        handle,
      );
    } else {
      await sql`INSERT INTO conversations (id, workspace_id, contact_id, telegram_chat_id, created_at)
        VALUES (${conversation}, ${ws}, ${contact}, 1, ${now})`.execute(handle);
    }
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
      const s = await seed(freshDb, false);
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

const LAST_PRE_ASSIGNMENT = '1791681109992_contract_conversations_list_columns';

describe('assignment-statuses migrations 01-04', () => {
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

  async function member(handle: Kysely<unknown>, ws: string): Promise<string> {
    const account = newId();
    await sql`INSERT INTO accounts (id, email, display_name, password_hash, created_at)
      VALUES (${account}, ${`${account}@example.test`}, 'Test User', 'h', ${now})`.execute(handle);
    await sql`INSERT INTO memberships (id, workspace_id, account_id, role, state, created_at, active_since)
      VALUES (${newId()}, ${ws}, ${account}, 'operator', 'active', ${now}, ${now})`.execute(handle);
    return account;
  }

  async function workspace(handle: Kysely<unknown>): Promise<string> {
    const ws = newId();
    await sql`INSERT INTO workspaces (id, name, created_at) VALUES (${ws}, 'Acme', ${now})`.execute(
      handle,
    );
    return ws;
  }

  async function conversation(
    handle: Kysely<unknown>,
    ws: string,
    o: {
      status?: string | null;
      version?: number | null;
      seq?: number | null;
      assignee?: string;
    } = {},
  ): Promise<string> {
    const contact = newId();
    const id = newId();
    const tg = Math.floor(Math.random() * 1e9);
    await sql`INSERT INTO contacts (id, workspace_id, telegram_user_id, first_name, profile_seen_at, created_at)
      VALUES (${contact}, ${ws}, ${tg}, 'Test User', ${now}, ${now})`.execute(handle);
    await sql`INSERT INTO conversations (id, workspace_id, contact_id, telegram_chat_id, created_at,
        last_activity_at, last_message_received_at, status, state_version, customer_message_seq,
        assignee_account_id)
      VALUES (${id}, ${ws}, ${contact}, ${tg}, ${now}, ${now}, ${now}, ${o.status === undefined ? 'open' : o.status},
        ${o.version === undefined ? 0 : o.version}, ${o.seq === undefined ? 0 : o.seq},
        ${o.assignee ?? null})`.execute(handle);
    return id;
  }

  function activity(
    s: { ws: string; conv: string },
    o: {
      kind: string;
      cause?: string;
      actor?: string | null;
      previous?: string | null;
      next?: string | null;
    },
  ) {
    return sql`INSERT INTO conversation_activities (id, workspace_id, conversation_id, kind, cause,
        actor_account_id, previous_assignee_account_id, new_assignee_account_id, position_at, created_at)
      VALUES (${newId()}, ${s.ws}, ${s.conv}, ${o.kind}, ${o.cause ?? 'member'}, ${o.actor ?? null},
        ${o.previous ?? null}, ${o.next ?? null}, ${now}, ${now})`.execute(db);
  }

  async function columns(handle: Kysely<unknown>, table: string): Promise<string[]> {
    const { rows } = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}`.execute(handle);
    return rows.map((r) => r.column_name);
  }

  async function indexes(handle: Kysely<unknown>): Promise<string[]> {
    const { rows } = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`.execute(handle);
    return rows.map((r) => r.indexname);
  }

  it('adds the state columns, the activity table and the lens indexes', async () => {
    const conv = await columns(db, 'conversations');
    for (const c of ['status', 'assignee_account_id', 'state_version', 'customer_message_seq'])
      expect(conv).toContain(c);
    expect(await columns(db, 'conversation_activities')).toEqual(
      expect.arrayContaining(['kind', 'cause', 'actor_account_id', 'position_at']),
    );
    const idx = await indexes(db);
    for (const i of [
      'conversations_workspace_id_status_idx',
      'conversations_workspace_id_assignee_status_idx',
      'conversation_activities_conversation_id_position_at_idx',
      'conversation_activities_workspace_id_actor_created_at_idx',
    ])
      expect(idx).toContain(i);
  });

  it('rejects a bad conversation status, a negative version or counter (AC-04)', async () => {
    const ws = await workspace(db);
    await expect(conversation(db, ws, { status: 'archived' })).rejects.toThrow(
      /conversations_status_check/,
    );
    await expect(conversation(db, ws, { version: -1 })).rejects.toThrow(
      /conversations_state_version_check/,
    );
    await expect(conversation(db, ws, { seq: -1 })).rejects.toThrow(
      /conversations_customer_message_seq_check/,
    );
    await conversation(db, ws, { status: 'closed', version: 3, seq: 2 });
  });

  it('contract 05: a null status, version or counter is rejected (AC-06)', async () => {
    const ws = await workspace(db);
    await expect(conversation(db, ws, { status: null })).rejects.toThrow(/not-null constraint/);
    await expect(conversation(db, ws, { version: null })).rejects.toThrow(/not-null constraint/);
    await expect(conversation(db, ws, { seq: null })).rejects.toThrow(/not-null constraint/);
    await conversation(db, ws);
  });

  it('contract 05 reverts alone to nullable columns and re-applies', async () => {
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
      const nullable = async () =>
        (
          await sql<{ column_name: string; is_nullable: string }>`
            SELECT column_name, is_nullable FROM information_schema.columns
            WHERE table_name = 'conversations'
              AND column_name IN ('status', 'state_version', 'customer_message_seq')`.execute(
            freshDb,
          )
        ).rows.map((r) => r.is_nullable);
      expect(await nullable()).toEqual(['NO', 'NO', 'NO']);
      // Later features' migrations sit above the contract: step them off first.
      for (const name of [
        'add_contacts_list_indexes',
        'backfill_contacts_wrote_times',
        'add_contacts_wrote_times',
        'add_conversations_waiting_index',
        'backfill_conversations_waiting_period',
        'add_conversations_waiting_period',
        'create_pings',
        'create_tab_presences',
        'create_connect_links',
        'create_telegram_links',
        'add_bots_send_paused_until',
      ]) {
        const later = await migrator.migrateDown();
        expect(later.error).toBeUndefined();
        expect(later.results?.[0]?.migrationName).toContain(name);
      }
      const down = await migrator.migrateDown();
      expect(down.error).toBeUndefined();
      expect(await nullable()).toEqual(['YES', 'YES', 'YES']);
      const up = await migrator.migrateToLatest();
      expect(up.error).toBeUndefined();
      expect(await nullable()).toEqual(['NO', 'NO', 'NO']);
    } finally {
      await freshDb.destroy();
      await fresh.stop();
    }
  });

  it('accepts only a member of the same workspace as assignee (AC-04)', async () => {
    const ws = await workspace(db);
    const other = await workspace(db);
    const mine = await member(db, ws);
    const foreign = await member(db, other);
    await expect(conversation(db, ws, { assignee: foreign })).rejects.toThrow(
      /conversations_workspace_id_assignee_account_id_fkey/,
    );
    await conversation(db, ws, { assignee: mine });
  });

  it('rejects activity entries that break the kind, cause, actor and assignee rules (AC-09)', async () => {
    const ws = await workspace(db);
    const other = await workspace(db);
    const a = await member(db, ws);
    const b = await member(db, ws);
    const foreign = await member(db, other);
    const s = { ws, conv: await conversation(db, ws) };
    await expect(activity(s, { kind: 'archived', actor: a })).rejects.toThrow(
      // Postgres reports the first failing CHECK by name; an unknown kind also fails the assignee pair
      /conversation_activities_(assignees|kind)_check/,
    );
    await expect(activity(s, { kind: 'closed', cause: 'bogus' })).rejects.toThrow(
      /conversation_activities_cause_check/,
    );
    await expect(activity(s, { kind: 'closed', cause: 'customer_wrote' })).rejects.toThrow(
      /conversation_activities_kind_cause_check/,
    );
    await expect(
      activity(s, { kind: 'assigned', cause: 'member_deactivated', next: a }),
    ).rejects.toThrow(/conversation_activities_kind_cause_check/);
    await expect(activity(s, { kind: 'closed' })).rejects.toThrow(
      /conversation_activities_actor_cause_check/,
    );
    await expect(
      activity(s, { kind: 'reopened', cause: 'customer_wrote', actor: a }),
    ).rejects.toThrow(/conversation_activities_actor_cause_check/);
    await expect(
      activity(s, { kind: 'reassigned', actor: a, previous: a, next: a }),
    ).rejects.toThrow(/conversation_activities_assignees_check/);
    await expect(activity(s, { kind: 'closed', actor: a, previous: b })).rejects.toThrow(
      /conversation_activities_assignees_check/,
    );
    await expect(activity(s, { kind: 'assigned', actor: foreign, next: a })).rejects.toThrow(
      /conversation_activities_actor_fkey/,
    );
    await expect(activity(s, { kind: 'assigned', actor: a, next: foreign })).rejects.toThrow(
      /conversation_activities_new_assignee_fkey/,
    );
    await activity(s, { kind: 'assigned', actor: a, next: a });
    await activity(s, { kind: 'reassigned', actor: a, previous: a, next: b });
    await activity(s, { kind: 'unassigned', actor: a, previous: b });
    await activity(s, { kind: 'unassigned', cause: 'member_deactivated', previous: b });
    await activity(s, { kind: 'closed', actor: a });
    await activity(s, { kind: 'reopened', cause: 'reply_not_delivered' });
  });

  it('backfills existing conversations to open, version 0, counter = message count', async () => {
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
      const down = await migrator.migrateTo(LAST_PRE_ASSIGNMENT);
      expect(down.error).toBeUndefined();
      const ws = await workspace(freshDb);
      const contact = newId();
      const conv = newId();
      await sql`INSERT INTO contacts (id, workspace_id, telegram_user_id, first_name, profile_seen_at, created_at)
        VALUES (${contact}, ${ws}, 1, 'Test User', ${now}, ${now})`.execute(freshDb);
      await sql`INSERT INTO conversations (id, workspace_id, contact_id, telegram_chat_id, created_at,
          last_activity_at, last_message_received_at)
        VALUES (${conv}, ${ws}, ${contact}, 1, ${now}, ${later}, ${later})`.execute(freshDb);
      for (const n of [1, 2, 3])
        await sql`INSERT INTO messages (id, workspace_id, conversation_id, telegram_message_id, kind, body,
            telegram_message, sent_at, received_at)
          VALUES (${newId()}, ${ws}, ${conv}, ${n}, 'text', 'hi',
            ${JSON.stringify({ message_id: n })}::jsonb, ${now}, ${now})`.execute(freshDb);
      const up = await migrator.migrateToLatest();
      expect(up.error).toBeUndefined();
      const { rows } = await sql<{
        status: string;
        assignee_account_id: string | null;
        state_version: number;
        customer_message_seq: number;
      }>`SELECT status, assignee_account_id, state_version, customer_message_seq FROM conversations`.execute(
        freshDb,
      );
      expect(rows[0]).toEqual({
        status: 'open',
        assignee_account_id: null,
        state_version: 0,
        customer_message_seq: 3,
      });
    } finally {
      await freshDb.destroy();
      await fresh.stop();
    }
  });

  it('reverts 04 to 01 back to the shared-inbox shape and re-applies', async () => {
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
      const down = await migrator.migrateTo(LAST_PRE_ASSIGNMENT);
      expect(down.error).toBeUndefined();
      const conv = await columns(freshDb, 'conversations');
      for (const c of ['status', 'assignee_account_id', 'state_version', 'customer_message_seq'])
        expect(conv).not.toContain(c);
      expect(await columns(freshDb, 'conversation_activities')).toEqual([]);
      const idx = await indexes(freshDb);
      expect(idx).not.toContain('conversations_workspace_id_status_idx');
      expect(idx).not.toContain('conversations_workspace_id_assignee_status_idx');
      const up = await migrator.migrateToLatest();
      expect(up.error).toBeUndefined();
      expect(await columns(freshDb, 'conversations')).toContain('state_version');
      expect(await columns(freshDb, 'conversation_activities')).toContain('kind');
    } finally {
      await freshDb.destroy();
      await fresh.stop();
    }
  });
});

describe('operator-notifications migrations 04-08', () => {
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

  async function workspace(handle: Kysely<unknown> = db): Promise<string> {
    const ws = newId();
    await sql`INSERT INTO workspaces (id, name, created_at) VALUES (${ws}, 'Acme', ${now})`.execute(
      handle,
    );
    return ws;
  }

  async function account(handle: Kysely<unknown> = db): Promise<string> {
    const id = newId();
    await sql`INSERT INTO accounts (id, email, display_name, password_hash, created_at)
      VALUES (${id}, ${`${id}@example.test`}, 'Test User', 'h', ${now})`.execute(handle);
    return id;
  }

  async function join(ws: string, acc: string, handle: Kysely<unknown> = db): Promise<void> {
    await sql`INSERT INTO memberships (id, workspace_id, account_id, role, state, created_at, active_since)
      VALUES (${newId()}, ${ws}, ${acc}, 'operator', 'active', ${now}, ${now})`.execute(handle);
  }

  async function member(ws: string): Promise<string> {
    const acc = await account();
    await join(ws, acc);
    return acc;
  }

  async function conversation(ws: string): Promise<string> {
    const contact = newId();
    const id = newId();
    const tg = Math.floor(Math.random() * 1e9);
    await sql`INSERT INTO contacts (id, workspace_id, telegram_user_id, first_name, profile_seen_at, created_at)
      VALUES (${contact}, ${ws}, ${tg}, 'Test User', ${now}, ${now})`.execute(db);
    await sql`INSERT INTO conversations (id, workspace_id, contact_id, telegram_chat_id, created_at,
        last_activity_at, last_message_received_at, status, state_version, customer_message_seq)
      VALUES (${id}, ${ws}, ${contact}, ${tg}, ${now}, ${now}, ${now}, 'open', 0, 0)`.execute(db);
    return id;
  }

  function link(
    ws: string,
    acc: string,
    o: {
      id?: string;
      tgUser?: number | null;
      displayName?: string | null;
      removedAt?: Date | null;
      removedReason?: string | null;
      blockedAt?: Date | null;
    } = {},
  ) {
    const has = <K extends keyof typeof o>(k: K) => k in o;
    return sql`INSERT INTO telegram_links (id, workspace_id, account_id, telegram_bot_id,
        telegram_user_id, display_name, linked_at, blocked_at, removed_at, removed_reason)
      VALUES (${o.id ?? newId()}, ${ws}, ${acc}, 7001,
        ${has('tgUser') ? o.tgUser : 5001}, ${has('displayName') ? o.displayName : 'Test User'},
        ${now}, ${o.blockedAt ?? null}, ${o.removedAt ?? null}, ${o.removedReason ?? null})`.execute(
      db,
    );
  }

  function connectLink(
    ws: string,
    acc: string,
    o: {
      hash?: Buffer;
      expiresAt?: Date;
      usedAt?: Date | null;
      replacedAt?: Date | null;
    } = {},
  ) {
    return sql`INSERT INTO connect_links (id, workspace_id, account_id, token_hash, created_at,
        expires_at, used_at, replaced_at)
      VALUES (${newId()}, ${ws}, ${acc}, ${o.hash ?? Buffer.alloc(32, 1)}, ${now},
        ${o.expiresAt ?? later}, ${o.usedAt ?? null}, ${o.replacedAt ?? null})`.execute(db);
  }

  function presence(
    ws: string,
    acc: string,
    o: { liveUntil?: Date; lastOnScreenAt?: Date | null } = {},
  ) {
    return sql`INSERT INTO tab_presences (id, workspace_id, account_id, live_until, on_screen,
        last_on_screen_at, opened_at)
      VALUES (${newId()}, ${ws}, ${acc}, ${o.liveUntil ?? later}, true,
        ${o.lastOnScreenAt ?? null}, ${now})`.execute(db);
  }

  function ping(
    ws: string,
    acc: string,
    linkId: string,
    o: { id?: string; outcome?: string; openedAt?: Date | null } = {},
  ) {
    return sql`INSERT INTO pings (id, workspace_id, account_id, telegram_link_id, outcome,
        created_at, opened_at)
      VALUES (${o.id ?? newId()}, ${ws}, ${acc}, ${linkId}, ${o.outcome ?? 'accepted'}, ${now},
        ${o.openedAt ?? null})`.execute(db);
  }

  function item(
    ws: string,
    acc: string,
    pingId: string,
    conv: string,
    since: Date = now,
    itemAccount: string = acc,
  ) {
    return sql`INSERT INTO ping_items (id, workspace_id, ping_id, account_id, conversation_id,
        waiting_since)
      VALUES (${newId()}, ${ws}, ${pingId}, ${itemAccount}, ${conv}, ${since})`.execute(db);
  }

  async function exists(table: string): Promise<boolean> {
    const { rows } = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}`.execute(db);
    return rows[0]?.n === '1';
  }

  it('adds bots.send_paused_until and the five tables', async () => {
    const { rows } = await sql<{ is_nullable: string }>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'bots' AND column_name = 'send_paused_until'`.execute(db);
    expect(rows.map((r) => r.is_nullable)).toEqual(['YES']);
    for (const t of ['telegram_links', 'connect_links', 'tab_presences', 'pings', 'ping_items'])
      expect(await exists(t)).toBe(true);
  });

  it('allows one live link per membership and per Telegram user, re-link after removal, same Telegram user in another workspace (AC-06)', async () => {
    const ws = await workspace();
    const other = await workspace();
    const a = await member(ws);
    const b = await member(ws);
    await link(ws, a);
    await expect(link(ws, a, { tgUser: 5002 })).rejects.toThrow(
      /telegram_links_live_workspace_id_account_id_key/,
    );
    await expect(link(ws, b)).rejects.toThrow(
      /telegram_links_live_workspace_id_telegram_user_id_key/,
    );
    await link(ws, b, { tgUser: 5003 });
    // The same account and Telegram user in another workspace is a separate link.
    await join(other, a);
    await link(other, a);
    // After removal the member links again.
    const removed = await member(ws);
    await link(ws, removed, {
      tgUser: null,
      displayName: null,
      removedAt: later,
      removedReason: 'deactivated',
    });
    await link(ws, removed, { tgUser: 5004 });
  });

  it('rejects a link outside its own workspace membership (AC-12)', async () => {
    const ws = await workspace();
    const other = await workspace();
    const foreign = await member(other);
    await expect(link(ws, foreign)).rejects.toThrow(/telegram_links_membership_fkey/);
    await expect(connectLink(ws, foreign)).rejects.toThrow(/connect_links_membership_fkey/);
    await expect(presence(ws, foreign)).rejects.toThrow(/tab_presences_membership_fkey/);
  });

  it('rejects telegram_links rows that break the removal, name and user id rules', async () => {
    const ws = await workspace();
    const a = await member(ws);
    await expect(
      link(ws, a, { removedAt: later, removedReason: 'bogus', tgUser: null, displayName: null }),
    ).rejects.toThrow(/telegram_links_removed_reason_check/);
    await expect(link(ws, a, { removedAt: later, displayName: null })).rejects.toThrow(
      /telegram_links_removed_pair_check/,
    );
    await expect(link(ws, a, { removedReason: 'member' })).rejects.toThrow(
      /telegram_links_removed_pair_check/,
    );
    await expect(link(ws, a, { displayName: null })).rejects.toThrow(
      /telegram_links_display_name_check/,
    );
    await expect(
      link(ws, a, { removedAt: later, removedReason: 'member', displayName: 'Test User' }),
    ).rejects.toThrow(/telegram_links_display_name_check/);
    await expect(link(ws, a, { tgUser: null })).rejects.toThrow(
      /telegram_links_telegram_user_id_check/,
    );
    // Only a member's own removal keeps the Telegram user id (for the "off" answer).
    await expect(
      link(ws, a, { removedAt: later, removedReason: 'deactivated', displayName: null }),
    ).rejects.toThrow(/telegram_links_telegram_user_id_check/);
    await expect(
      link(ws, a, {
        removedAt: new Date('2025-12-31T00:00:00Z'),
        removedReason: 'member',
        displayName: null,
      }),
    ).rejects.toThrow(/telegram_links_removed_at_check/);
    await expect(link(ws, a, { blockedAt: new Date('2025-12-31T00:00:00Z') })).rejects.toThrow(
      /telegram_links_blocked_at_check/,
    );
    await link(ws, a, { removedAt: later, removedReason: 'member', displayName: null });
  });

  it('rejects connect_links rows that break the hash, time and exclusivity rules', async () => {
    const ws = await workspace();
    const a = await member(ws);
    await expect(connectLink(ws, a, { hash: Buffer.alloc(31) })).rejects.toThrow(
      /connect_links_token_hash_length_check/,
    );
    await expect(connectLink(ws, a, { expiresAt: now })).rejects.toThrow(
      /connect_links_expires_at_check/,
    );
    await expect(connectLink(ws, a, { usedAt: new Date('2025-12-31T00:00:00Z') })).rejects.toThrow(
      /connect_links_used_at_check/,
    );
    await expect(
      connectLink(ws, a, { replacedAt: new Date('2025-12-31T00:00:00Z') }),
    ).rejects.toThrow(/connect_links_replaced_at_check/);
    await expect(connectLink(ws, a, { usedAt: later, replacedAt: later })).rejects.toThrow(
      /connect_links_used_or_replaced_check/,
    );
    await connectLink(ws, a, { hash: Buffer.alloc(32, 9) });
    await expect(connectLink(ws, a, { hash: Buffer.alloc(32, 9) })).rejects.toThrow(
      /connect_links_workspace_id_token_hash_key/,
    );
    // The hash is unique per workspace only.
    const other = await workspace();
    const b = await member(other);
    await connectLink(other, b, { hash: Buffer.alloc(32, 9) });
  });

  it('rejects tab_presences rows whose lease or screen time precedes the open', async () => {
    const ws = await workspace();
    const a = await member(ws);
    await expect(presence(ws, a, { liveUntil: now })).rejects.toThrow(
      /tab_presences_live_until_check/,
    );
    await expect(
      presence(ws, a, { lastOnScreenAt: new Date('2025-12-31T00:00:00Z') }),
    ).rejects.toThrow(/tab_presences_last_on_screen_at_check/);
    await presence(ws, a, { lastOnScreenAt: later });
    // A hidden tab that reconnected brings the time it left: up to 10 min + one lease before the open.
    await presence(ws, a, { lastOnScreenAt: new Date(now.getTime() - 650_000) });
    await expect(
      presence(ws, a, { lastOnScreenAt: new Date(now.getTime() - 651_000) }),
    ).rejects.toThrow(/tab_presences_last_on_screen_at_check/);
  });

  it('rejects pings and ledger items that break the outcome, member and ledger rules (AC-08)', async () => {
    const ws = await workspace();
    const a = await member(ws);
    const b = await member(ws);
    const linkId = newId();
    await link(ws, a, { id: linkId });
    await expect(ping(ws, a, linkId, { outcome: 'queued' })).rejects.toThrow(/pings_outcome_check/);
    await expect(
      ping(ws, a, linkId, { openedAt: new Date('2025-12-31T00:00:00Z') }),
    ).rejects.toThrow(/pings_opened_at_check/);
    await expect(ping(ws, a, newId())).rejects.toThrow(/pings_telegram_link_id_fkey/);
    const pingId = newId();
    await ping(ws, a, linkId, { id: pingId, outcome: 'sending' });
    const conv = await conversation(ws);
    await item(ws, a, pingId, conv);
    // Never twice per member, conversation and waiting period; a new period is a new row.
    const second = newId();
    await ping(ws, a, linkId, { id: second });
    await expect(item(ws, a, second, conv)).rejects.toThrow(
      /ping_items_conversation_id_waiting_since_account_id_key/,
    );
    await item(ws, a, second, conv, later);
    // An item's member is its ping's member.
    await expect(item(ws, a, second, await conversation(ws), now, b)).rejects.toThrow(
      /ping_items_ping_fkey/,
    );
    await expect(item(ws, a, second, newId())).rejects.toThrow(/ping_items_conversation_id_fkey/);
  });

  it('cascades the items when a ping is rolled out', async () => {
    const ws = await workspace();
    const a = await member(ws);
    const linkId = newId();
    await link(ws, a, { id: linkId });
    const pingId = newId();
    await ping(ws, a, linkId, { id: pingId });
    await item(ws, a, pingId, await conversation(ws));
    await item(ws, a, pingId, await conversation(ws));
    await sql`DELETE FROM pings WHERE id = ${pingId}`.execute(db);
    const { rows } = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM ping_items WHERE ping_id = ${pingId}`.execute(db);
    expect(rows[0]?.n).toBe('0');
  });

  it('reverts 08 down to 04 and re-applies', async () => {
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
      const state = async () => {
        const tables = await sql<{ table_name: string }>`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('telegram_links', 'connect_links', 'tab_presences', 'pings', 'ping_items')
          ORDER BY table_name`.execute(freshDb);
        const col = await sql<{ column_name: string }>`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'bots' AND column_name = 'send_paused_until'`.execute(freshDb);
        return { tables: tables.rows.map((r) => r.table_name), column: col.rows.length };
      };
      const full = {
        tables: ['connect_links', 'ping_items', 'pings', 'tab_presences', 'telegram_links'],
        column: 1,
      };
      expect(await state()).toEqual(full);
      // 03, 02 and 01 sit above 08: step them off first.
      for (let i = 0; i < 11; i++) {
        const down = await migrator.migrateDown();
        expect(down.error).toBeUndefined();
      }
      expect(await state()).toEqual({ tables: [], column: 0 });
      const up = await migrator.migrateToLatest();
      expect(up.error).toBeUndefined();
      expect(await state()).toEqual(full);
    } finally {
      await freshDb.destroy();
      await fresh.stop();
    }
  });
});

const LAST_PRE_WAITING = '1791681110002_create_pings';
const WAITING_COLUMNS = '1791681110003_add_conversations_waiting_period';
const WAITING_BACKFILL = '1791681110004_backfill_conversations_waiting_period';

describe('operator-notifications migrations 01-03', () => {
  let database: TestDatabase;
  let db: Kysely<unknown>;
  const minute = (m: number) => new Date(Date.UTC(2026, 0, 1, 10, m));

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

  const migratorFor = (handle: Kysely<unknown>) =>
    new Migrator({
      db: handle,
      provider: new TSFileMigrationProvider({
        migrationFolder: resolve(import.meta.dirname, '../../migrations'),
      }),
    });

  async function workspaceWithMember(handle: Kysely<unknown>) {
    const ws = newId();
    const account = newId();
    await sql`INSERT INTO workspaces (id, name, created_at) VALUES (${ws}, 'Acme', ${minute(0)})`.execute(
      handle,
    );
    await sql`INSERT INTO accounts (id, email, display_name, password_hash, created_at)
      VALUES (${account}, ${`${account}@example.test`}, 'Test User', 'h', ${minute(0)})`.execute(
      handle,
    );
    await sql`INSERT INTO memberships (id, workspace_id, account_id, role, state, created_at, active_since)
      VALUES (${newId()}, ${ws}, ${account}, 'operator', 'active', ${minute(0)}, ${minute(0)})`.execute(
      handle,
    );
    return { ws, account };
  }

  type History = {
    /** Customer messages by minute. */
    messages: number[];
    /** The last sent reply, minute. */
    reply?: number;
    status?: 'open' | 'closed';
    /** Activity entries by minute. */
    entries?: Array<{ at: number; kind: 'closed' | 'reopened'; cause?: string }>;
    expect: { startedBy: 'message' | 'reopen'; at: number } | null;
  };

  /** The ten history shapes of the data-model audit (minutes). */
  const SHAPES: History[] = [
    { messages: [1], expect: { startedBy: 'message', at: 1 } },
    { messages: [1], reply: 2, expect: null },
    { messages: [1, 3, 4], reply: 2, expect: { startedBy: 'message', at: 3 } },
    {
      messages: [1],
      status: 'closed',
      entries: [{ at: 2, kind: 'closed' }],
      expect: null,
    },
    {
      messages: [1],
      entries: [
        { at: 2, kind: 'closed' },
        { at: 3, kind: 'reopened' },
      ],
      expect: { startedBy: 'reopen', at: 3 },
    },
    {
      messages: [1],
      reply: 2,
      entries: [
        { at: 3, kind: 'closed' },
        { at: 4, kind: 'reopened' },
      ],
      expect: null,
    },
    {
      messages: [1, 3],
      entries: [
        { at: 2, kind: 'closed' },
        { at: 3, kind: 'reopened', cause: 'customer_wrote' },
      ],
      expect: { startedBy: 'message', at: 3 },
    },
    {
      messages: [1],
      entries: [
        { at: 2, kind: 'closed' },
        { at: 3, kind: 'reopened', cause: 'reply_not_delivered' },
      ],
      expect: { startedBy: 'reopen', at: 3 },
    },
    {
      messages: [1, 5],
      reply: 2,
      entries: [
        { at: 3, kind: 'closed' },
        { at: 4, kind: 'reopened' },
      ],
      expect: { startedBy: 'message', at: 5 },
    },
    {
      messages: [1, 2],
      entries: [
        { at: 3, kind: 'closed' },
        { at: 4, kind: 'reopened' },
        { at: 5, kind: 'closed' },
        { at: 6, kind: 'reopened' },
      ],
      expect: { startedBy: 'reopen', at: 6 },
    },
  ];

  async function seed(handle: Kysely<unknown>, ws: string, actor: string, h: History) {
    const contact = newId();
    const conv = newId();
    const tg = Math.floor(Math.random() * 1e9);
    const lastMessage = Math.max(...h.messages);
    await sql`INSERT INTO contacts (id, workspace_id, telegram_user_id, first_name, profile_seen_at, created_at)
      VALUES (${contact}, ${ws}, ${tg}, 'Test User', ${minute(0)}, ${minute(0)})`.execute(handle);
    const last = Math.max(lastMessage, h.reply ?? 0);
    await sql`INSERT INTO conversations (id, workspace_id, contact_id, telegram_chat_id, created_at,
        last_activity_at, last_message_received_at, last_reply_sent_at, status, state_version,
        customer_message_seq)
      VALUES (${conv}, ${ws}, ${contact}, ${tg}, ${minute(0)}, ${minute(last)}, ${minute(lastMessage)},
        ${h.reply === undefined ? null : minute(h.reply)}, ${h.status ?? 'open'}, 0, ${h.messages.length})`.execute(
      handle,
    );
    for (const [i, m] of h.messages.entries())
      await sql`INSERT INTO messages (id, workspace_id, conversation_id, telegram_message_id, kind, body,
          telegram_message, sent_at, received_at)
        VALUES (${newId()}, ${ws}, ${conv}, ${i + 1}, 'text', 'hi',
          ${JSON.stringify({ message_id: i + 1 })}::jsonb, ${minute(m)}, ${minute(m)})`.execute(
        handle,
      );
    for (const e of h.entries ?? []) {
      const cause = e.cause ?? 'member';
      await sql`INSERT INTO conversation_activities (id, workspace_id, conversation_id, kind, cause,
          actor_account_id, previous_assignee_account_id, new_assignee_account_id, position_at, created_at)
        VALUES (${newId()}, ${ws}, ${conv}, ${e.kind}, ${cause},
          ${cause === 'member' ? actor : null}, null, null, ${minute(e.at)}, ${minute(e.at)})`.execute(
        handle,
      );
    }
    return conv;
  }

  async function waiting(handle: Kysely<unknown>, conv: string) {
    const { rows } = await sql<{ waiting_since: Date | null; waiting_started_by: string | null }>`
      SELECT waiting_since, waiting_started_by FROM conversations WHERE id = ${conv}`.execute(
      handle,
    );
    return rows[0]!;
  }

  it('backfills the ten audit history shapes and leaves answered and closed rows NULL', async () => {
    const fresh = await startTestDatabase();
    const freshDb = new Kysely<unknown>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: fresh.url }) }),
    });
    try {
      const migrator = migratorFor(freshDb);
      const down = await migrator.migrateTo(LAST_PRE_WAITING);
      expect(down.error).toBeUndefined();
      const { ws, account } = await workspaceWithMember(freshDb);
      const ids: string[] = [];
      for (const h of SHAPES) ids.push(await seed(freshDb, ws, account, h));
      const up = await migrator.migrateToLatest();
      expect(up.error).toBeUndefined();
      for (const [i, h] of SHAPES.entries()) {
        expect(await waiting(freshDb, ids[i]!), `shape ${i + 1}`).toEqual(
          h.expect
            ? { waiting_since: minute(h.expect.at), waiting_started_by: h.expect.startedBy }
            : { waiting_since: null, waiting_started_by: null },
        );
      }
    } finally {
      await freshDb.destroy();
      await fresh.stop();
    }
  });

  it('a re-run of the backfill fills only rows still NULL and keeps the others', async () => {
    const { ws, account } = await workspaceWithMember(db);
    const conv = await seed(db, ws, account, SHAPES[0]!);
    await sql`UPDATE conversations SET waiting_since = ${minute(9)}, waiting_started_by = 'reopen'
      WHERE id = ${conv}`.execute(db);
    const other = await seed(db, ws, account, SHAPES[2]!);
    const migrator = migratorFor(db);
    const sqlOfBackfill = await migrator.migrateTo(WAITING_BACKFILL); // reverts 03 and what sits above
    expect(sqlOfBackfill.error).toBeUndefined();
    const second = await migrator.migrateTo(WAITING_COLUMNS); // reverts 02: a no-op
    expect(second.error).toBeUndefined();
    const again = await migrator.migrateToLatest(); // re-runs 02 and 03
    expect(again.error).toBeUndefined();
    expect(await waiting(db, conv)).toEqual({
      waiting_since: minute(9),
      waiting_started_by: 'reopen',
    });
    expect(await waiting(db, other)).toEqual({
      waiting_since: minute(3),
      waiting_started_by: 'message',
    });
  });

  it('rejects an unknown start kind, a start without a kind and a closed conversation still waiting', async () => {
    const { ws, account } = await workspaceWithMember(db);
    const conv = await seed(db, ws, account, SHAPES[1]!);
    await expect(
      sql`UPDATE conversations SET waiting_since = ${minute(1)}, waiting_started_by = 'other'
        WHERE id = ${conv}`.execute(db),
    ).rejects.toThrow(/conversations_waiting_started_by_check/);
    await expect(
      sql`UPDATE conversations SET waiting_since = ${minute(1)} WHERE id = ${conv}`.execute(db),
    ).rejects.toThrow(/conversations_waiting_pair_check/);
    await expect(
      sql`UPDATE conversations SET status = 'closed', waiting_since = ${minute(1)},
          waiting_started_by = 'message' WHERE id = ${conv}`.execute(db),
    ).rejects.toThrow(/conversations_waiting_open_check/);
    await sql`UPDATE conversations SET waiting_since = ${minute(1)}, waiting_started_by = 'message'
      WHERE id = ${conv}`.execute(db);
  });

  it('adds the partial index on (workspace_id, waiting_since)', async () => {
    const { rows } = await sql<{ indexdef: string }>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'conversations_workspace_id_waiting_since_idx'`.execute(db);
    expect(rows[0]?.indexdef).toMatch(/\(workspace_id, waiting_since\)/);
    expect(rows[0]?.indexdef).toMatch(/WHERE \(waiting_since IS NOT NULL\)/);
  });

  it('reverts 03 to 01 and re-applies', async () => {
    const fresh = await startTestDatabase();
    const freshDb = new Kysely<unknown>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: fresh.url }) }),
    });
    try {
      const migrator = migratorFor(freshDb);
      const state = async () => {
        const col = await sql<{ column_name: string }>`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'conversations' AND column_name LIKE 'waiting%'
          ORDER BY column_name`.execute(freshDb);
        const idx = await sql<{ indexname: string }>`
          SELECT indexname FROM pg_indexes
          WHERE indexname = 'conversations_workspace_id_waiting_since_idx'`.execute(freshDb);
        return { columns: col.rows.map((r) => r.column_name), index: idx.rows.length };
      };
      const full = { columns: ['waiting_started_by', 'waiting_since'].sort(), index: 1 };
      expect(await state()).toEqual(full);
      const down = await migrator.migrateTo(LAST_PRE_WAITING);
      expect(down.error).toBeUndefined();
      expect(await state()).toEqual({ columns: [], index: 0 });
      const up = await migrator.migrateToLatest();
      expect(up.error).toBeUndefined();
      expect(await state()).toEqual(full);
    } finally {
      await freshDb.destroy();
      await fresh.stop();
    }
  });
});

const LAST_PRE_WROTE = '1791681110005_add_conversations_waiting_index';

describe('contacts migrations 01-03', () => {
  let database: TestDatabase;
  let db: Kysely<unknown>;
  const day = (d: number, h = 10) => new Date(Date.UTC(2026, 1, d, h));

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

  const migratorFor = (handle: Kysely<unknown>) =>
    new Migrator({
      db: handle,
      provider: new TSFileMigrationProvider({
        migrationFolder: resolve(import.meta.dirname, '../../migrations'),
      }),
    });

  async function workspace(handle: Kysely<unknown>) {
    const ws = newId();
    await sql`INSERT INTO workspaces (id, name, created_at) VALUES (${ws}, 'Acme', ${day(1)})`.execute(
      handle,
    );
    return ws;
  }

  async function contactWithMessages(
    handle: Kysely<unknown>,
    ws: string,
    tg: number,
    messages: Array<{ sent: Date; received?: Date; edited?: Date }>,
  ) {
    const contact = newId();
    await sql`INSERT INTO contacts (id, workspace_id, telegram_user_id, first_name, profile_seen_at, created_at)
      VALUES (${contact}, ${ws}, ${tg}, 'Test User', ${day(1)}, ${day(1)})`.execute(handle);
    if (messages.length === 0) return contact;
    const conv = newId();
    await sql`INSERT INTO conversations (id, workspace_id, contact_id, telegram_chat_id, created_at,
        last_activity_at, last_message_received_at, status, state_version, customer_message_seq)
      VALUES (${conv}, ${ws}, ${contact}, ${tg}, ${day(1)}, ${day(1)}, ${day(1)}, 'open', 0, ${messages.length})`.execute(
      handle,
    );
    for (const [i, m] of messages.entries())
      await sql`INSERT INTO messages (id, workspace_id, conversation_id, telegram_message_id, kind, body,
          telegram_message, sent_at, received_at, edited_at, edit_update_id)
        VALUES (${newId()}, ${ws}, ${conv}, ${i + 1}, 'text', 'hi', ${JSON.stringify({ message_id: i + 1 })}::jsonb,
          ${m.sent}, ${m.received ?? m.sent}, ${m.edited ?? null}, ${m.edited ? 9000 + i : null})`.execute(
        handle,
      );
    return contact;
  }

  async function wrote(handle: Kysely<unknown>, contact: string) {
    const { rows } = await sql<{ first_wrote_at: Date | null; last_wrote_at: Date | null }>`
      SELECT first_wrote_at, last_wrote_at FROM contacts WHERE id = ${contact}`.execute(handle);
    return rows[0]!;
  }

  it('backfills the four audit shapes from the send times of the messages', async () => {
    const fresh = await startTestDatabase();
    const freshDb = new Kysely<unknown>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: fresh.url }) }),
    });
    try {
      const migrator = migratorFor(freshDb);
      expect((await migrator.migrateTo(LAST_PRE_WROTE)).error).toBeUndefined();
      const a = await workspace(freshDb);
      const b = await workspace(freshDb);
      const a1 = await contactWithMessages(freshDb, a, 1, [
        { sent: day(1) },
        { sent: day(2), edited: day(5) },
        { sent: day(3), received: day(4) },
      ]);
      const a2 = await contactWithMessages(freshDb, a, 2, [{ sent: day(1, 12) }]);
      const a3 = await contactWithMessages(freshDb, a, 3, []);
      const b1 = await contactWithMessages(freshDb, b, 1, [{ sent: day(9, 9) }]);
      expect((await migrator.migrateToLatest()).error).toBeUndefined();
      expect(await wrote(freshDb, a1)).toEqual({ first_wrote_at: day(1), last_wrote_at: day(3) });
      expect(await wrote(freshDb, a2)).toEqual({
        first_wrote_at: day(1, 12),
        last_wrote_at: day(1, 12),
      });
      expect(await wrote(freshDb, a3)).toEqual({ first_wrote_at: null, last_wrote_at: null });
      expect(await wrote(freshDb, b1)).toEqual({
        first_wrote_at: day(9, 9),
        last_wrote_at: day(9, 9),
      });
    } finally {
      await freshDb.destroy();
      await fresh.stop();
    }
  });

  it('a re-run of the backfill never narrows a range capture widened', async () => {
    const ws = await workspace(db);
    const c = await contactWithMessages(db, ws, 11, [{ sent: day(3) }]);
    await sql`UPDATE contacts SET first_wrote_at = ${day(1)}, last_wrote_at = ${day(8)} WHERE id = ${c}`.execute(
      db,
    );
    const backfill =
      await import('../../migrations/1791681110007_backfill_contacts_wrote_times.js');
    await backfill.up(db);
    expect(await wrote(db, c)).toEqual({ first_wrote_at: day(1), last_wrote_at: day(8) });
  });

  it('refuses one time without the other and first after last, on the named checks', async () => {
    const ws = await workspace(db);
    const c = await contactWithMessages(db, ws, 12, []);
    await expect(
      sql`UPDATE contacts SET first_wrote_at = ${day(1)} WHERE id = ${c}`.execute(db),
    ).rejects.toThrow(/contacts_wrote_pair_check/);
    await expect(
      sql`UPDATE contacts SET last_wrote_at = ${day(1)} WHERE id = ${c}`.execute(db),
    ).rejects.toThrow(/contacts_wrote_pair_check/);
    await expect(
      sql`UPDATE contacts SET first_wrote_at = ${day(2)}, last_wrote_at = ${day(1)} WHERE id = ${c}`.execute(
        db,
      ),
    ).rejects.toThrow(/contacts_wrote_order_check/);
    await sql`UPDATE contacts SET first_wrote_at = ${day(1)}, last_wrote_at = ${day(1)} WHERE id = ${c}`.execute(
      db,
    );
  });

  it('adds the keyset index and the unique (workspace_id, id) index', async () => {
    const { rows } = await sql<{ indexname: string; indexdef: string }>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN ('contacts_workspace_id_last_wrote_at_id_idx', 'contacts_workspace_id_id_key')`.execute(
      db,
    );
    const def = (n: string) => rows.find((r) => r.indexname === n)?.indexdef ?? '';
    expect(def('contacts_workspace_id_last_wrote_at_id_idx')).toMatch(
      /\(workspace_id, last_wrote_at DESC NULLS LAST, id DESC\)/,
    );
    expect(def('contacts_workspace_id_id_key')).toMatch(/UNIQUE INDEX .*\(workspace_id, id\)/);
  });

  it('reverts 03 to 01 and re-applies', async () => {
    const fresh = await startTestDatabase();
    const freshDb = new Kysely<unknown>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: fresh.url }) }),
    });
    try {
      const migrator = migratorFor(freshDb);
      const state = async () => {
        const col = await sql<{ column_name: string }>`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'contacts' AND column_name LIKE '%wrote_at' ORDER BY column_name`.execute(
          freshDb,
        );
        const idx = await sql<{ indexname: string }>`
          SELECT indexname FROM pg_indexes
          WHERE indexname IN ('contacts_workspace_id_last_wrote_at_id_idx', 'contacts_workspace_id_id_key')`.execute(
          freshDb,
        );
        const chk = await sql<{ conname: string }>`
          SELECT conname FROM pg_constraint WHERE conname LIKE 'contacts_wrote_%'`.execute(freshDb);
        return { columns: col.rows.length, indexes: idx.rows.length, checks: chk.rows.length };
      };
      expect(await state()).toEqual({ columns: 2, indexes: 2, checks: 2 });
      expect((await migrator.migrateTo(LAST_PRE_WROTE)).error).toBeUndefined();
      expect(await state()).toEqual({ columns: 0, indexes: 0, checks: 0 });
      expect((await migrator.migrateToLatest()).error).toBeUndefined();
      expect(await state()).toEqual({ columns: 2, indexes: 2, checks: 2 });
    } finally {
      await freshDb.destroy();
      await fresh.stop();
    }
  });
});
