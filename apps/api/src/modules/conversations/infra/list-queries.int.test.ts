import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { newId } from '../../../platform/ids.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import {
  insertConversation,
  insertMessage,
  insertReply,
  twoWorkspacesWithInbox,
} from '../../../test/fixtures/conversations.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createListQueries } from './list-queries.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe('list queries', () => {
  let database: TestDatabase;
  let db: Db;
  let lists: ReturnType<typeof createListQueries>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    lists = createListQueries(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  async function workspaceWithMember(activeSince = at(-1000)) {
    const workspaceId = await insertWorkspace(db);
    const { accountId } = await insertMembership(db, workspaceId, { activeSince });
    return { workspaceId, accountId, activeSince };
  }

  async function conversation(
    workspaceId: string,
    o: { lastActivityAt?: Date; lastMessageReceivedAt?: Date; lastReplySentAt?: Date | null } = {},
  ) {
    const contactId = await insertContact(db, { workspaceId });
    const id = await insertConversation(db, { workspaceId, contactId, ...o });
    return { id, contactId };
  }

  const page = (
    m: { workspaceId: string; accountId: string; activeSince: Date },
    o: {
      contactIds?: string[] | null;
      after?: { lastActivityAt: Date; id: string } | null;
      limit?: number;
    } = {},
  ) =>
    lists.listPage(m.workspaceId, {
      accountId: m.accountId,
      activeSince: m.activeSince,
      contactIds: o.contactIds ?? null,
      after: o.after ?? null,
      limit: o.limit ?? 50,
    });

  it('lists newest activity first and pages by (activity, id) without gaps or repeats (AC-01)', async () => {
    const m = await workspaceWithMember();
    const made = [];
    for (const s of [10, 30, 30, 20, 40]) {
      made.push(
        await conversation(m.workspaceId, { lastActivityAt: at(s), lastMessageReceivedAt: at(s) }),
      );
    }
    const first = await page(m, { limit: 2 });
    expect(first.hasNext).toBe(true);
    expect(first.rows.map((r) => r.lastActivityAt)).toEqual([at(40), at(30)]);
    const seen = [...first.rows];
    let cursor = seen[seen.length - 1]!;
    for (;;) {
      const next = await page(m, {
        limit: 2,
        after: { lastActivityAt: cursor.lastActivityAt, id: cursor.id },
      });
      seen.push(...next.rows);
      if (!next.hasNext) break;
      cursor = next.rows[next.rows.length - 1]!;
    }
    expect(seen.map((r) => r.id).sort()).toEqual(made.map((c) => c.id).sort());
    expect(new Set(seen.map((r) => r.id)).size).toBe(5);
    const times = seen.map((r) => r.lastActivityAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    // ties on activity fall back to id descending
    const tied = seen
      .filter((r) => r.lastActivityAt.getTime() === at(30).getTime())
      .map((r) => r.id);
    expect(tied).toEqual([...tied].sort().reverse());
  });

  it('counts unread by arrival, above the later of the read mark and active-since (AC-01, AC-15)', async () => {
    const m = await workspaceWithMember(at(10));
    const c = await conversation(m.workspaceId, {
      lastActivityAt: at(100),
      lastMessageReceivedAt: at(100),
    });
    // arrived before the operator joined: read
    await insertMessage(db, {
      workspaceId: m.workspaceId,
      conversationId: c.id,
      telegramMessageId: 1n,
      sentAt: at(1),
      receivedAt: at(5),
    });
    // after joining: unread
    await insertMessage(db, {
      workspaceId: m.workspaceId,
      conversationId: c.id,
      telegramMessageId: 2n,
      sentAt: at(20),
      receivedAt: at(20),
    });
    await insertMessage(db, {
      workspaceId: m.workspaceId,
      conversationId: c.id,
      telegramMessageId: 3n,
      sentAt: at(30),
      receivedAt: at(30),
    });
    // a teammate's reply never counts
    await insertReply(db, {
      workspaceId: m.workspaceId,
      conversationId: c.id,
      authorAccountId: m.accountId,
      state: 'sent',
      positionAt: at(25),
    });
    expect((await page(m)).rows[0]!.unreadCount).toBe(2);

    await db
      .insertInto('read_marks')
      .values({
        id: newId(),
        workspace_id: m.workspaceId,
        conversation_id: c.id,
        account_id: m.accountId,
        read_through_at: at(30),
        created_at: at(30),
      })
      .execute();
    expect((await page(m)).rows[0]!.unreadCount).toBe(0);

    // a late redelivery: placed early in the history (sent_at), arrived after the mark
    await insertMessage(db, {
      workspaceId: m.workspaceId,
      conversationId: c.id,
      telegramMessageId: 0n,
      sentAt: at(2),
      receivedAt: at(60),
    });
    expect((await page(m)).rows[0]!.unreadCount).toBe(1);

    // another member's mark does not change this member's count
    const other = await insertMembership(db, m.workspaceId, { activeSince: at(-1000) });
    const mine = await page({ ...m, accountId: other.accountId, activeSince: at(-1000) });
    expect(mine.rows[0]!.unreadCount).toBe(4);
  });

  it('marks waiting when the customer wrote after the last sent reply; only a sent reply clears it (AC-01)', async () => {
    const m = await workspaceWithMember();
    const none = await conversation(m.workspaceId, {
      lastActivityAt: at(10),
      lastMessageReceivedAt: at(10),
    });
    const answered = await conversation(m.workspaceId, {
      lastActivityAt: at(60),
      lastMessageReceivedAt: at(10),
      lastReplySentAt: at(60),
    });
    const again = await conversation(m.workspaceId, {
      lastActivityAt: at(70),
      lastMessageReceivedAt: at(70),
      lastReplySentAt: at(60),
    });
    const byId = new Map((await page(m)).rows.map((r) => [r.id, r]));
    expect(byId.get(none.id)!.waitingForReply).toBe(true);
    expect(byId.get(answered.id)!.waitingForReply).toBe(false);
    expect(byId.get(again.id)!.waitingForReply).toBe(true);
  });

  it('shows the later of the newest message by arrival and the newest sent reply as the last item (AC-01)', async () => {
    const m = await workspaceWithMember();
    const c = await conversation(m.workspaceId, {
      lastActivityAt: at(50),
      lastMessageReceivedAt: at(20),
      lastReplySentAt: at(50),
    });
    const photo = await insertMessage(db, {
      workspaceId: m.workspaceId,
      conversationId: c.id,
      telegramMessageId: 1n,
      kind: 'photo',
      body: 'new bouquet?',
      sentAt: at(5),
      receivedAt: at(20),
    });
    await insertMessage(db, {
      workspaceId: m.workspaceId,
      conversationId: c.id,
      telegramMessageId: 2n,
      sentAt: at(6),
      receivedAt: at(10),
      body: 'older arrival',
    });
    expect((await page(m)).rows[0]!.lastItem).toEqual({
      type: 'message',
      id: photo,
      kind: 'photo',
      body: 'new bouquet?',
    });

    const sent = await insertReply(db, {
      workspaceId: m.workspaceId,
      conversationId: c.id,
      authorAccountId: m.accountId,
      state: 'sent',
      body: 'We deliver',
      positionAt: at(50),
      sentAt: at(50),
    });
    // a reply still sending, or not delivered, is never the last item
    await insertReply(db, {
      workspaceId: m.workspaceId,
      conversationId: c.id,
      authorAccountId: m.accountId,
      state: 'sending',
      positionAt: at(80),
    });
    await insertReply(db, {
      workspaceId: m.workspaceId,
      conversationId: c.id,
      authorAccountId: m.accountId,
      state: 'not_delivered',
      positionAt: at(90),
    });
    expect((await page(m)).rows[0]!.lastItem).toEqual({
      type: 'reply',
      id: sent,
      body: 'We deliver',
    });
  });

  it('filters by contact ids; an empty list matches nothing, null means no filter', async () => {
    const m = await workspaceWithMember();
    const a = await conversation(m.workspaceId);
    await conversation(m.workspaceId);
    expect((await page(m, { contactIds: [a.contactId] })).rows.map((r) => r.id)).toEqual([a.id]);
    expect((await page(m, { contactIds: [] })).rows).toEqual([]);
    expect((await page(m, { contactIds: null })).rows).toHaveLength(2);
  });

  it('returns the same row as the list for the summary, and null for an unknown id', async () => {
    const m = await workspaceWithMember();
    const c = await conversation(m.workspaceId, {
      lastActivityAt: at(10),
      lastMessageReceivedAt: at(10),
    });
    await insertMessage(db, {
      workspaceId: m.workspaceId,
      conversationId: c.id,
      telegramMessageId: 1n,
      receivedAt: at(10),
    });
    const fromList = (await page(m)).rows[0]!;
    expect(
      await lists.summary(m.workspaceId, c.id, {
        accountId: m.accountId,
        activeSince: m.activeSince,
      }),
    ).toEqual(fromList);
    expect(
      await lists.summary(m.workspaceId, newId(), {
        accountId: m.accountId,
        activeSince: m.activeSince,
      }),
    ).toBeNull();
  });

  it('never shows another workspace in the list or the summary (AC-18)', async () => {
    const { a, b } = await twoWorkspacesWithInbox(db);
    const viewerB = { accountId: b.accountId, activeSince: at(-1000) };
    const listB = await lists.listPage(b.workspaceId, {
      ...viewerB,
      contactIds: null,
      after: null,
      limit: 50,
    });
    expect(listB.rows.map((r) => r.id).sort()).toEqual(
      [b.conversationId, b.assignedConversationId].sort(),
    );
    const filtered = await lists.listPage(b.workspaceId, {
      ...viewerB,
      contactIds: [a.contactId],
      after: null,
      limit: 50,
    });
    expect(filtered.rows).toEqual([]);
    expect(await lists.summary(b.workspaceId, a.conversationId, viewerB)).toBeNull();
    // messages and replies of the other workspace never feed the row
    const row = await lists.summary(a.workspaceId, a.conversationId, {
      accountId: a.accountId,
      activeSince: at(-1000),
    });
    expect(row?.id).toBe(a.conversationId);
  });

  it('serves the first page of a 1 000-conversation workspace within 500 ms of server time (NFR)', async () => {
    const m = await workspaceWithMember();
    const contacts = Array.from({ length: 1000 }, (_, i) => ({
      id: newId(),
      workspace_id: m.workspaceId,
      telegram_user_id: String(9_000_000 + i),
      first_name: 'Test User',
      last_name: null,
      username: null,
      language_code: 'en',
      profile_seen_at: T0,
      created_at: T0,
    }));
    await db.insertInto('contacts').values(contacts).execute();
    const convs = contacts.map((c, i) => ({
      id: newId(),
      workspace_id: m.workspaceId,
      contact_id: c.id,
      telegram_chat_id: c.telegram_user_id,
      created_at: T0,
      last_activity_at: at(i),
      last_message_received_at: at(i),
      last_reply_sent_at: null,
    }));
    await db.insertInto('conversations').values(convs).execute();
    await db
      .insertInto('messages')
      .values(
        convs.map((c, i) => ({
          id: newId(),
          workspace_id: m.workspaceId,
          conversation_id: c.id,
          telegram_message_id: '1',
          kind: 'text',
          body: 'Hello',
          telegram_message: JSON.stringify({ message_id: 1 }),
          sent_at: at(i),
          received_at: at(i),
          edited_at: null,
          edit_update_id: null,
        })),
      )
      .execute();
    await page(m); // warm the pool
    const started = performance.now();
    const first = await page(m);
    const elapsed = performance.now() - started;
    expect(first.rows).toHaveLength(50);
    expect(first.hasNext).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});
