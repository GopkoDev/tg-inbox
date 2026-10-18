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
import type { ThreadPosition } from '../domain/thread.js';
import type { ThreadEntry } from '../app/ports.js';
import { createThreadQueries } from './thread-queries.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const label = (e: ThreadEntry) =>
  e.type === 'message' ? `m${e.message.body}` : `r${e.reply.body}`;

describe('thread queries', () => {
  let database: TestDatabase;
  let db: Db;
  let threads: ReturnType<typeof createThreadQueries>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    threads = createThreadQueries(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  async function setup() {
    const workspaceId = await insertWorkspace(db);
    const { accountId } = await insertMembership(db, workspaceId);
    const contactId = await insertContact(db, { workspaceId });
    const conversationId = await insertConversation(db, {
      workspaceId,
      contactId,
      lastActivityAt: at(1000),
      lastMessageReceivedAt: at(1000),
    });
    return { workspaceId, accountId, conversationId };
  }

  const msg = (
    s: { workspaceId: string; conversationId: string },
    id: bigint,
    sent: number,
    o: { received?: number; kind?: string; raw?: Record<string, unknown> } = {},
  ) =>
    insertMessage(db, {
      workspaceId: s.workspaceId,
      conversationId: s.conversationId,
      telegramMessageId: id,
      body: String(id),
      sentAt: at(sent),
      receivedAt: at(o.received ?? sent),
      ...(o.kind && { kind: o.kind }),
    });

  const rep = (
    s: { workspaceId: string; conversationId: string; accountId: string },
    body: string,
    position: number,
    state: 'sending' | 'sent' | 'not_delivered' = 'sent',
  ) =>
    insertReply(db, {
      workspaceId: s.workspaceId,
      conversationId: s.conversationId,
      authorAccountId: s.accountId,
      body,
      state,
      positionAt: at(position),
    });

  it('merges messages and replies by position time, a message before a reply within the same instant (AC-03)', async () => {
    const s = await setup();
    await msg(s, 1n, 10);
    await rep(s, 'a', 10); // same instant: after the message
    await msg(s, 3n, 30);
    await rep(s, 'b', 20, 'sending'); // every state is shown
    await msg(s, 2n, 20, { received: 500 }); // late redelivery: placed at its sent_at
    const page = await threads.page(s.workspaceId, s.conversationId, {
      before: null,
      after: null,
      limit: 50,
    });
    expect(page?.entries.map(label)).toEqual(['m1', 'ra', 'm2', 'rb', 'm3']);
    expect(page?.hasPrev).toBe(false);
    expect(page?.hasNext).toBe(false);
  });

  it('pages a 600-item history from the latest page up to the first message and back down (AC-03)', async () => {
    const s = await setup();
    for (let i = 0; i < 300; i++) {
      await msg(s, BigInt(i + 1), i * 2);
      await rep(s, `${i + 1}`, i * 2 + 1);
    }
    const latest = await threads.page(s.workspaceId, s.conversationId, {
      before: null,
      after: null,
      limit: 100,
    });
    expect(latest!.entries).toHaveLength(100);
    expect(latest!.hasPrev).toBe(true);
    expect(latest!.hasNext).toBe(false);
    expect(label(latest!.entries.at(-1)!)).toBe('r300');

    // scroll up until the first message
    const collected: ThreadEntry[] = [...latest!.entries];
    let before: ThreadPosition | null = latest!.entries[0]!.position;
    let pages = 1;
    while (before) {
      const older = await threads.page(s.workspaceId, s.conversationId, {
        before,
        after: null,
        limit: 100,
      });
      expect(older!.hasNext).toBe(true);
      collected.unshift(...older!.entries);
      before = older!.hasPrev ? older!.entries[0]!.position : null;
      pages++;
    }
    expect(pages).toBe(6);
    expect(collected).toHaveLength(600);
    expect(label(collected[0]!)).toBe('m1');
    expect(new Set(collected.map(label)).size).toBe(600);

    // heal downwards from the first message
    const down: ThreadEntry[] = [];
    let after: ThreadPosition | null = collected[0]!.position;
    for (;;) {
      const newer = await threads.page(s.workspaceId, s.conversationId, {
        before: null,
        after,
        limit: 250,
      });
      expect(newer!.hasPrev).toBe(true);
      down.push(...newer!.entries);
      if (!newer!.hasNext) break;
      after = newer!.entries.at(-1)!.position;
    }
    expect(down.map(label)).toEqual(collected.slice(1).map(label));
  });

  it('carries read_through_at (the newest arrival) on the latest page only (ADR-0005)', async () => {
    const s = await setup();
    await msg(s, 1n, 10);
    await msg(s, 2n, 20);
    await db
      .updateTable('conversations')
      .set({ last_message_received_at: at(1000) })
      .where('id', '=', s.conversationId)
      .execute();
    const latest = await threads.page(s.workspaceId, s.conversationId, {
      before: null,
      after: null,
      limit: 1,
    });
    expect(latest?.readThroughAt).toEqual(at(1000));
    const older = await threads.page(s.workspaceId, s.conversationId, {
      before: latest!.entries[0]!.position,
      after: null,
      limit: 1,
    });
    expect(older?.readThroughAt).toBeNull();
  });

  it('answers null for a conversation that is not in the workspace', async () => {
    const s = await setup();
    expect(
      await threads.page(s.workspaceId, newId(), { before: null, after: null, limit: 10 }),
    ).toBeNull();
  });

  it('reads one message and one reply, with the projections of its kind (AC-09)', async () => {
    const s = await setup();
    const id = await insertMessage(db, {
      workspaceId: s.workspaceId,
      conversationId: s.conversationId,
      telegramMessageId: 7n,
      kind: 'location',
      body: null,
    });
    await db
      .updateTable('messages')
      .set({ telegram_message: JSON.stringify({ location: { latitude: 50, longitude: 30 } }) })
      .where('id', '=', id)
      .execute();
    const m = await threads.message(s.workspaceId, s.conversationId, id);
    expect(m).toMatchObject({
      id,
      kind: 'location',
      location: { latitude: 50, longitude: 30, venue: null },
      attachment: null,
    });
    const r = await rep(s, 'hi', 5);
    expect(await threads.reply(s.workspaceId, s.conversationId, r)).toMatchObject({
      id: r,
      body: 'hi',
      authorAccountId: s.accountId,
      state: 'sent',
    });
    expect(await threads.message(s.workspaceId, s.conversationId, newId())).toBeNull();
    expect(await threads.reply(s.workspaceId, s.conversationId, newId())).toBeNull();
    // an id of the other kind is not found
    expect(await threads.message(s.workspaceId, s.conversationId, r)).toBeNull();
  });

  it('gives the media reference of a message with a file, and null for kinds with none', async () => {
    const s = await setup();
    const photo = await insertMessage(db, {
      workspaceId: s.workspaceId,
      conversationId: s.conversationId,
      telegramMessageId: 1n,
      kind: 'photo',
      body: null,
    });
    await db
      .updateTable('messages')
      .set({
        telegram_message: JSON.stringify({
          photo: [{ file_id: 'AgAD', width: 5, height: 5, file_size: 99 }],
        }),
      })
      .where('id', '=', photo)
      .execute();
    const text = await msg(s, 2n, 5);
    const poll = await insertMessage(db, {
      workspaceId: s.workspaceId,
      conversationId: s.conversationId,
      telegramMessageId: 3n,
      kind: 'poll',
      body: null,
    });
    expect(await threads.mediaReference(s.workspaceId, s.conversationId, photo)).toEqual({
      fileReference: 'AgAD',
      kind: 'photo',
      fileSize: 99,
      fileName: null,
      mimeType: 'image/jpeg',
    });
    expect(await threads.mediaReference(s.workspaceId, s.conversationId, text)).toBeNull();
    expect(await threads.mediaReference(s.workspaceId, s.conversationId, poll)).toBeNull();
    expect(await threads.mediaReference(s.workspaceId, s.conversationId, newId())).toBeNull();
  });

  it('finds nothing of another workspace: page, message, reply and media (AC-18)', async () => {
    const { a, b } = await twoWorkspacesWithInbox(db);
    const photo = await insertMessage(db, {
      workspaceId: a.workspaceId,
      conversationId: a.conversationId,
      telegramMessageId: 5n,
      kind: 'photo',
      body: null,
    });
    await db
      .updateTable('messages')
      .set({ telegram_message: JSON.stringify({ photo: [{ file_id: 'X', width: 1, height: 1 }] }) })
      .where('id', '=', photo)
      .execute();
    expect(
      await threads.page(b.workspaceId, a.conversationId, { before: null, after: null, limit: 10 }),
    ).toBeNull();
    expect(await threads.message(b.workspaceId, a.conversationId, a.messageId)).toBeNull();
    expect(await threads.reply(b.workspaceId, a.conversationId, a.replyId)).toBeNull();
    expect(await threads.mediaReference(b.workspaceId, a.conversationId, photo)).toBeNull();
    // the right conversation id with the right workspace still works
    expect(
      (
        await threads.page(a.workspaceId, a.conversationId, {
          before: null,
          after: null,
          limit: 10,
        })
      )?.entries.length,
    ).toBeGreaterThan(0);
    // a conversation of A addressed with B's own conversation id sees only B's items
    const own = await threads.page(b.workspaceId, b.conversationId, {
      before: null,
      after: null,
      limit: 10,
    });
    expect(
      own!.entries.every((e) => (e.type === 'message' ? e.message.id : e.reply.id) !== a.messageId),
    ).toBe(true);
  });

  it('opens the latest page of a 5 000-message conversation within 500 ms of server time (NFR)', async () => {
    const s = await setup();
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      id: newId(),
      workspace_id: s.workspaceId,
      conversation_id: s.conversationId,
      telegram_message_id: String(i + 1),
      kind: 'text',
      body: `m${i + 1}`,
      telegram_message: JSON.stringify({ message_id: i + 1 }),
      sent_at: at(i),
      received_at: at(i),
      edited_at: null,
      edit_update_id: null,
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      await db
        .insertInto('messages')
        .values(rows.slice(i, i + 1000))
        .execute();
    }
    for (let i = 0; i < 500; i++) await rep(s, `r${i}`, i * 10 + 5);
    const q = { before: null, after: null, limit: 50 };
    await threads.page(s.workspaceId, s.conversationId, q); // warm the pool
    const started = performance.now();
    const latest = await threads.page(s.workspaceId, s.conversationId, q);
    const elapsed = performance.now() - started;
    expect(latest!.entries).toHaveLength(50);
    expect(latest!.hasPrev).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});
