import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../../platform/ids.js';
import { createDb, type Db } from '../../../platform/db.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import {
  insertConversation,
  insertMessage,
  insertReadMark,
  insertReply,
  twoWorkspacesWithInbox,
} from '../../../test/fixtures/conversations.js';
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
        last_activity_at: NOW,
        last_message_received_at: NOW,
        last_reply_sent_at: null,
        status: 'open',
        assignee_account_id: null,
        state_version: 0,
        customer_message_seq: 0,
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

  it('raiseReceived raises arrival and keeps activity = GREATEST(arrival, last sent reply); never lowers', async () => {
    const w = await insertWorkspace(db);
    const contactId = await insertContact(db, { workspaceId: w, telegramUserId: 5006n });
    const later = new Date(NOW.getTime() + 60_000);
    const replyAt = new Date(NOW.getTime() + 600_000);
    const id = await insertConversation(db, {
      workspaceId: w,
      contactId,
      lastActivityAt: replyAt,
      lastReplySentAt: replyAt,
    });
    const read = () =>
      db
        .selectFrom('conversations')
        .select(['last_activity_at', 'last_message_received_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
    await repo.raiseReceived(w, id, later);
    expect(await read()).toEqual({ last_activity_at: replyAt, last_message_received_at: later });
    await repo.raiseReceived(w, id, NOW);
    expect(await read()).toEqual({ last_activity_at: replyAt, last_message_received_at: later });
    const muchLater = new Date(NOW.getTime() + 900_000);
    await repo.raiseReceived(w, id, muchLater);
    expect(await read()).toEqual({
      last_activity_at: muchLater,
      last_message_received_at: muchLater,
    });
  });

  it('raiseReceived raises the counter by one and returns the state under the lock', async () => {
    const w = await insertWorkspace(db);
    const contactId = await insertContact(db, { workspaceId: w, telegramUserId: 5008n });
    const id = await insertConversation(db, {
      workspaceId: w,
      contactId,
      status: 'closed',
      stateVersion: 3,
      customerMessageSeq: 4,
    });
    expect(await repo.raiseReceived(w, id, NOW)).toEqual({
      status: 'closed',
      assigneeAccountId: null,
      stateVersion: 3,
    });
    const row = await db
      .selectFrom('conversations')
      .select('customer_message_seq')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.customer_message_seq).toBe(5);
  });

  it('isolation: raiseReceived never touches another workspace’s conversation', async () => {
    const { a, b } = await twoWorkspaces(db);
    const contactId = await insertContact(db, { workspaceId: a, telegramUserId: 5007n });
    const id = await insertConversation(db, { workspaceId: a, contactId });
    await expect(repo.raiseReceived(b, id, new Date(NOW.getTime() + 60_000))).rejects.toThrow();
    const row = await db
      .selectFrom('conversations')
      .select('last_message_received_at')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.last_message_received_at).toEqual(NOW);
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

  describe('state (assignment and status)', () => {
    const lock = <T>(fn: (tx: Db) => Promise<T>) => db.transaction().execute(fn);
    let chat = 8100n;
    const fresh = async (
      workspaceId: string,
      o: Partial<Parameters<typeof insertConversation>[1]> = {},
    ) => {
      chat += 1n;
      const contactId = await insertContact(db, { workspaceId, telegramUserId: chat });
      return insertConversation(db, { workspaceId, contactId, ...o });
    };

    it('lockState reads status, assignee, version, counter and waiting under FOR UPDATE', async () => {
      const { a } = await twoWorkspacesWithInbox(db);
      const id = await fresh(a.workspaceId, {
        status: 'closed',
        assigneeAccountId: a.accountId,
        stateVersion: 4,
        customerMessageSeq: 7,
        lastActivityAt: new Date(NOW.getTime() + 5_000),
        lastMessageReceivedAt: new Date(NOW.getTime() + 5_000),
      });
      const state = await lock((tx) => repo.lockState(a.workspaceId, id, tx));
      expect(state).toEqual({
        status: 'closed',
        assigneeAccountId: a.accountId,
        stateVersion: 4,
        customerMessageSeq: 7,
        lastActivityAt: new Date(NOW.getTime() + 5_000),
        waitingForReply: true,
      });
    });

    it('lockState: waiting is false once the last reply is newer than the last message', async () => {
      const { a } = await twoWorkspacesWithInbox(db);
      const later = new Date(NOW.getTime() + 9_000);
      const id = await fresh(a.workspaceId, {
        lastActivityAt: later,
        lastReplySentAt: later,
      });
      const state = await lock((tx) => repo.lockState(a.workspaceId, id, tx));
      expect(state?.waitingForReply).toBe(false);
    });

    it('lockState blocks a second writer until the transaction ends', async () => {
      const { a } = await twoWorkspacesWithInbox(db);
      const id = a.conversationId;
      let writerDone = false;
      let writer: Promise<unknown> = Promise.resolve();
      await lock(async (tx) => {
        await repo.lockState(a.workspaceId, id, tx);
        writer = repo.writeState(a.workspaceId, id, { status: 'closed' }).then(() => {
          writerDone = true;
        });
        await new Promise((r) => setTimeout(r, 300));
        expect(writerDone).toBe(false);
      });
      await writer;
      expect(writerDone).toBe(true);
    });

    it('lockState is null for a conversation of another workspace', async () => {
      const { a, b } = await twoWorkspacesWithInbox(db);
      expect(await lock((tx) => repo.lockState(b.workspaceId, a.conversationId, tx))).toBeNull();
      expect(await lock((tx) => repo.lockState(a.workspaceId, newId(), tx))).toBeNull();
    });

    it('writeState raises state_version by one, sets only the given fields, keeps last_activity_at', async () => {
      const { a } = await twoWorkspacesWithInbox(db);
      const id = a.conversationId;
      const before = await lock((tx) => repo.lockState(a.workspaceId, id, tx));
      const v1 = await lock((tx) =>
        repo.writeState(a.workspaceId, id, { assigneeAccountId: a.accountId }, tx),
      );
      expect(v1).toBe((before?.stateVersion ?? 0) + 1);
      let now = await lock((tx) => repo.lockState(a.workspaceId, id, tx));
      expect(now).toMatchObject({
        status: 'open',
        assigneeAccountId: a.accountId,
        stateVersion: v1,
        lastActivityAt: before?.lastActivityAt,
      });
      await lock((tx) =>
        repo.writeState(a.workspaceId, id, { status: 'closed', assigneeAccountId: null }, tx),
      );
      now = await lock((tx) => repo.lockState(a.workspaceId, id, tx));
      expect(now).toMatchObject({
        status: 'closed',
        assigneeAccountId: null,
        stateVersion: (v1 ?? 0) + 1,
        lastActivityAt: before?.lastActivityAt,
      });
    });

    it('isolation: writeState never touches another workspace’s conversation', async () => {
      const { a, b } = await twoWorkspacesWithInbox(db);
      const before = await lock((tx) => repo.lockState(a.workspaceId, a.conversationId, tx));
      const result = await lock((tx) =>
        repo.writeState(b.workspaceId, a.conversationId, { status: 'closed' }, tx),
      );
      expect(result).toBeNull();
      expect(await lock((tx) => repo.lockState(a.workspaceId, a.conversationId, tx))).toEqual(
        before,
      );
    });
  });

  describe('close-reason reads', () => {
    it('newestUnreadCustomerMessage returns the newest message after max(watermark, activeSince)', async () => {
      const { a, sharedAccountId } = await twoWorkspacesWithInbox(db);
      const w = a.workspaceId;
      const contactId = await insertContact(db, { workspaceId: w, telegramUserId: 8201n });
      const id = await insertConversation(db, { workspaceId: w, contactId });
      const t = (s: number) => new Date(NOW.getTime() + s * 1000);
      await insertMessage(db, {
        workspaceId: w,
        conversationId: id,
        telegramMessageId: 1n,
        receivedAt: t(10),
      });
      const newest = await insertMessage(db, {
        workspaceId: w,
        conversationId: id,
        telegramMessageId: 2n,
        receivedAt: t(30),
      });
      // no read mark: the floor is active-since
      expect(await repo.newestUnreadCustomerMessage(w, id, a.accountId, t(0))).toEqual({
        id: newest,
        receivedAt: t(30),
      });
      expect(await repo.newestUnreadCustomerMessage(w, id, a.accountId, t(30))).toBeNull();
      await insertReadMark(db, {
        workspaceId: w,
        conversationId: id,
        accountId: a.accountId,
        readThroughAt: t(20),
      });
      // watermark 20 beats active-since 0
      expect((await repo.newestUnreadCustomerMessage(w, id, a.accountId, t(0)))?.id).toBe(newest);
      // active-since 40 beats watermark 20
      expect(await repo.newestUnreadCustomerMessage(w, id, a.accountId, t(40))).toBeNull();
      // another member has no mark: floor is their active-since
      expect((await repo.newestUnreadCustomerMessage(w, id, sharedAccountId, t(5)))?.id).toBe(
        newest,
      );
    });

    it('isolation: newestUnreadCustomerMessage is null for another workspace', async () => {
      const { a, b } = await twoWorkspacesWithInbox(db);
      expect(
        await repo.newestUnreadCustomerMessage(
          b.workspaceId,
          a.conversationId,
          a.accountId,
          new Date(0),
        ),
      ).toBeNull();
      expect(
        (
          await repo.newestUnreadCustomerMessage(
            a.workspaceId,
            a.conversationId,
            a.accountId,
            new Date(0),
          )
        )?.id,
      ).toBe(a.messageId);
    });

    it('latestReply returns the newest reply by position, ties by id, null when none', async () => {
      const { a, b } = await twoWorkspacesWithInbox(db);
      const w = a.workspaceId;
      const contactId = await insertContact(db, { workspaceId: w, telegramUserId: 8202n });
      const id = await insertConversation(db, { workspaceId: w, contactId });
      expect(await repo.latestReply(w, id)).toBeNull();
      const t = (s: number) => new Date(NOW.getTime() + s * 1000);
      await insertReply(db, {
        workspaceId: w,
        conversationId: id,
        authorAccountId: a.accountId,
        state: 'sent',
        positionAt: t(1),
      });
      const newer = await insertReply(db, {
        workspaceId: w,
        conversationId: id,
        authorAccountId: a.accountId,
        state: 'not_delivered',
        positionAt: t(2),
      });
      expect(await repo.latestReply(w, id)).toEqual({ id: newer, state: 'not_delivered' });
      // isolation
      expect(await repo.latestReply(b.workspaceId, id)).toBeNull();
    });
  });
});
