import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../platform/db.js';
import { hashToken } from '../../platform/tokens.js';
import { startTestDatabase, type TestDatabase } from '../postgres.js';
import { insertBot } from './bots.js';
import { insertContact } from './contacts.js';
import { insertConversation } from './conversations.js';
import {
  insertConnectLink,
  insertPing,
  insertPresence,
  insertTelegramLink,
  twoWorkspacesWithLinks,
} from './notifications.js';
import { insertMembership, insertWorkspace } from './workspaces.js';

describe('notifications fixtures', () => {
  let database: TestDatabase;
  let db: Db;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  it('insertBot stores sendPausedUntil', async () => {
    const workspaceId = await insertWorkspace(db);
    const until = new Date('2026-10-11T10:05:00Z');
    const { bot } = await insertBot(db, { workspaceId, sendPausedUntil: until });
    const row = await db
      .selectFrom('bots')
      .select('send_paused_until')
      .where('id', '=', bot.id)
      .executeTakeFirstOrThrow();
    expect(row.send_paused_until).toEqual(until);
    const plain = await insertBot(db, { workspaceId: await insertWorkspace(db) });
    const none = await db
      .selectFrom('bots')
      .select('send_paused_until')
      .where('id', '=', plain.bot.id)
      .executeTakeFirstOrThrow();
    expect(none.send_paused_until).toBeNull();
  });

  it('builds a link, a connect link, a presence and a ping with items', async () => {
    const workspaceId = await insertWorkspace(db);
    const { accountId } = await insertMembership(db, workspaceId);
    const link = await insertTelegramLink(db, { workspaceId, accountId });
    expect(link.telegramUserId).toBe(5001n);
    const live = await db
      .selectFrom('telegram_links')
      .selectAll()
      .where('id', '=', link.id)
      .executeTakeFirstOrThrow();
    expect(live).toMatchObject({ removed_at: null, display_name: 'Test User' });

    const connect = await insertConnectLink(db, { workspaceId, accountId });
    expect(connect.startPayload).toBe(`tgi_${connect.token}`);
    const stored = await db
      .selectFrom('connect_links')
      .select('token_hash')
      .where('id', '=', connect.id)
      .executeTakeFirstOrThrow();
    expect(stored.token_hash).toEqual(hashToken(connect.token));

    const presenceId = await insertPresence(db, { workspaceId, accountId });
    const lease = await db
      .selectFrom('tab_presences')
      .selectAll()
      .where('id', '=', presenceId)
      .executeTakeFirstOrThrow();
    expect(lease.live_until.getTime()).toBeGreaterThan(lease.opened_at.getTime());

    const contactId = await insertContact(db, { workspaceId });
    const conversationId = await insertConversation(db, { workspaceId, contactId });
    const ping = await insertPing(db, {
      workspaceId,
      accountId,
      telegramLinkId: link.id,
      items: [{ conversationId, waitingSince: new Date('2026-10-11T10:00:00Z') }],
    });
    const items = await db
      .selectFrom('ping_items')
      .select(['conversation_id', 'account_id'])
      .where('ping_id', '=', ping.id)
      .execute();
    expect(items).toEqual([{ conversation_id: conversationId, account_id: accountId }]);
  });

  it('twoWorkspacesWithLinks shares one account and one Telegram user across two workspaces', async () => {
    const s = await twoWorkspacesWithLinks(db);
    expect(s.a.workspaceId).not.toBe(s.b.workspaceId);
    const rows = await db
      .selectFrom('telegram_links')
      .select(['workspace_id', 'account_id', 'telegram_user_id'])
      .where('account_id', '=', s.accountId)
      .execute();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.telegram_user_id))).toEqual(
      new Set([String(s.telegramUserId)]),
    );
    expect(new Set(rows.map((r) => r.workspace_id))).toEqual(
      new Set([s.a.workspaceId, s.b.workspaceId]),
    );
  });
});
