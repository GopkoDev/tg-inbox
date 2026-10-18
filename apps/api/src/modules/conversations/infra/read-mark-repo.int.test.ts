import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import {
  insertConversation,
  insertMessage,
  twoWorkspacesWithInbox,
} from '../../../test/fixtures/conversations.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createReadMarkRepo } from './read-mark-repo.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe('read mark repository', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: ReturnType<typeof createReadMarkRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    repo = createReadMarkRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  /** Messages arrive at 10, 20, 30; the conversation's newest arrival is 30. */
  async function setup() {
    const workspaceId = await insertWorkspace(db);
    const { accountId } = await insertMembership(db, workspaceId);
    const contactId = await insertContact(db, { workspaceId });
    const conversationId = await insertConversation(db, {
      workspaceId,
      contactId,
      lastActivityAt: at(30),
      lastMessageReceivedAt: at(30),
    });
    for (const [i, s] of [10, 20, 30].entries()) {
      await insertMessage(db, {
        workspaceId,
        conversationId,
        telegramMessageId: BigInt(i + 1),
        sentAt: at(s),
        receivedAt: at(s),
      });
    }
    return { workspaceId, accountId, conversationId, activeSince: at(0) };
  }

  const mark = (
    s: { workspaceId: string; accountId: string; conversationId: string; activeSince: Date },
    proposed: Date,
    accountId = s.accountId,
  ) =>
    repo.markRead(s.workspaceId, {
      conversationId: s.conversationId,
      accountId,
      activeSince: s.activeSince,
      proposed,
      now: at(100),
    });

  const stored = (conversationId: string, accountId: string) =>
    db
      .selectFrom('read_marks')
      .selectAll()
      .where('conversation_id', '=', conversationId)
      .where('account_id', '=', accountId)
      .execute();

  it('creates the mark, then raises it, and returns the unread count by arrival (AC-03)', async () => {
    const s = await setup();
    expect(await mark(s, at(10))).toEqual({ readThroughAt: at(10), unreadCount: 2 });
    expect(await mark(s, at(20))).toEqual({ readThroughAt: at(20), unreadCount: 1 });
    expect(await mark(s, at(30))).toEqual({ readThroughAt: at(30), unreadCount: 0 });
    expect(await stored(s.conversationId, s.accountId)).toHaveLength(1);
  });

  it('never lowers the stored mark', async () => {
    const s = await setup();
    await mark(s, at(20));
    expect(await mark(s, at(10))).toEqual({ readThroughAt: at(20), unreadCount: 1 });
    expect((await stored(s.conversationId, s.accountId))[0]!.read_through_at).toEqual(at(20));
  });

  it('clamps a time in the future to the newest arrival', async () => {
    const s = await setup();
    expect(await mark(s, at(99999))).toEqual({ readThroughAt: at(30), unreadCount: 0 });
  });

  it('counts a late redelivery that arrived after the mark as unread, by its arrival (AC-15)', async () => {
    const s = await setup();
    await mark(s, at(30));
    await insertMessage(db, {
      workspaceId: s.workspaceId,
      conversationId: s.conversationId,
      telegramMessageId: 9n,
      sentAt: at(5),
      receivedAt: at(60),
    });
    await db
      .updateTable('conversations')
      .set({ last_message_received_at: at(60), last_activity_at: at(60) })
      .where('id', '=', s.conversationId)
      .execute();
    expect(await mark(s, at(30))).toEqual({ readThroughAt: at(30), unreadCount: 1 });
  });

  it('counts above active-since when it is later than the mark', async () => {
    const s = await setup();
    const joinedLater = { ...s, activeSince: at(20) };
    expect(await mark(joinedLater, at(10))).toEqual({ readThroughAt: at(10), unreadCount: 1 });
  });

  it('marks for one member only', async () => {
    const s = await setup();
    const teammate = await insertMembership(db, s.workspaceId);
    await mark(s, at(30));
    expect(await mark(s, at(10), teammate.accountId)).toEqual({
      readThroughAt: at(10),
      unreadCount: 2,
    });
    expect((await stored(s.conversationId, s.accountId))[0]!.read_through_at).toEqual(at(30));
  });

  it('answers null for an unknown conversation and writes nothing', async () => {
    const s = await setup();
    expect(await mark({ ...s, conversationId: newId() }, at(10))).toBeNull();
  });

  it('cannot mark a conversation of another workspace (AC-18)', async () => {
    const { a, b } = await twoWorkspacesWithInbox(db);
    const result = await repo.markRead(b.workspaceId, {
      conversationId: a.conversationId,
      accountId: b.accountId,
      activeSince: at(-1000),
      proposed: at(10),
      now: at(100),
    });
    expect(result).toBeNull();
    expect(await stored(a.conversationId, b.accountId)).toEqual([]);
    expect(await stored(a.conversationId, a.accountId)).toEqual([]);
  });
});
