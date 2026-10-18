import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertConversation } from '../../../test/fixtures/conversations.js';
import { insertWorkspace, twoWorkspaces } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createConversationRepo } from './conversation-repo.js';

const NOW = new Date('2026-10-11T10:00:00Z');

describe('conversation repository', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: ReturnType<typeof createConversationRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    repo = createConversationRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  it('upsert creates the contact’s conversation once and returns it again', async () => {
    const w = await insertWorkspace(db);
    const contactId = await insertContact(db, { workspaceId: w, telegramUserId: 5001n });
    const first = await repo.upsert(w, { contactId, telegramChatId: 5001n }, NOW);
    const again = await repo.upsert(w, { contactId, telegramChatId: 5001n }, NOW);
    expect(first.created).toBe(true);
    expect(again).toEqual({ conversationId: first.conversationId, created: false });
    const rows = await db
      .selectFrom('conversations')
      .selectAll()
      .where('workspace_id', '=', w)
      .execute();
    expect(rows).toEqual([
      {
        id: first.conversationId,
        workspace_id: w,
        contact_id: contactId,
        telegram_chat_id: '5001',
        created_at: NOW,
        last_activity_at: null,
        last_message_received_at: null,
        last_reply_sent_at: null,
      },
    ]);
  });

  it('concurrent upserts of one chat produce one conversation', async () => {
    const w = await insertWorkspace(db);
    const contactId = await insertContact(db, { workspaceId: w, telegramUserId: 5002n });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => repo.upsert(w, { contactId, telegramChatId: 5002n }, NOW)),
    );
    expect(new Set(results.map((r) => r.conversationId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it('isolation: one person in two workspaces gets two conversations; upsert never returns the other’s (AC-13)', async () => {
    const { a, b } = await twoWorkspaces(db);
    const ca = await insertContact(db, { workspaceId: a, telegramUserId: 5003n });
    const cb = await insertContact(db, { workspaceId: b, telegramUserId: 5003n });
    const inA = await repo.upsert(a, { contactId: ca, telegramChatId: 5003n }, NOW);
    const inB = await repo.upsert(b, { contactId: cb, telegramChatId: 5003n }, NOW);
    expect(inB.created).toBe(true);
    expect(inB.conversationId).not.toBe(inA.conversationId);
  });

  it('isolation: findByChat only finds the workspace’s own conversation', async () => {
    const { a, b } = await twoWorkspaces(db);
    const contactId = await insertContact(db, { workspaceId: a, telegramUserId: 5004n });
    const id = await insertConversation(db, { workspaceId: a, contactId });
    expect(await repo.findByChat(a, 5004n)).toBe(id);
    expect(await repo.findByChat(b, 5004n)).toBeNull();
    expect(await repo.findByChat(a, 9999n)).toBeNull();
  });

  it('isolation: hasAny is per workspace', async () => {
    const { a, b } = await twoWorkspaces(db);
    const contactId = await insertContact(db, { workspaceId: a });
    await insertConversation(db, { workspaceId: a, contactId });
    expect(await repo.hasAny(a)).toBe(true);
    expect(await repo.hasAny(b)).toBe(false);
  });

  it('joins a caller transaction', async () => {
    const w = await insertWorkspace(db);
    const contactId = await insertContact(db, { workspaceId: w, telegramUserId: 5005n });
    await expect(
      db.transaction().execute(async (tx) => {
        await repo.upsert(w, { contactId, telegramChatId: 5005n }, NOW, tx);
        expect(await repo.hasAny(w, tx)).toBe(true);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await repo.hasAny(w)).toBe(false);
  });
});
