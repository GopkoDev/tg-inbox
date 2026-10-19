import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import {
  insertConversation,
  insertMessage,
  insertReadMark,
  twoWorkspacesWithInbox,
} from '../../../test/fixtures/conversations.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createNotificationQueries } from './notification-queries.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

describe('notification reads (Postgres)', () => {
  let database: TestDatabase;
  let db: Db;
  let reads: ReturnType<typeof createNotificationQueries>;
  let nextUser = 6_000_000n;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    reads = createNotificationQueries(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  /** An open conversation waiting since `since`, its one customer message arriving then. */
  async function waiting(
    workspaceId: string,
    o: {
      since?: Date;
      startedBy?: 'message' | 'reopen';
      assignee?: string | null;
      status?: 'open' | 'closed';
      replySentAt?: Date | null;
      messages?: Date[];
    } = {},
  ) {
    const since = o.since ?? at(1);
    const contactId = await insertContact(db, { workspaceId, telegramUserId: nextUser++ });
    const messages = o.messages ?? [since];
    const last = new Date(Math.max(...messages.map((m) => m.getTime())));
    const reply = o.replySentAt ?? null;
    const status = o.status ?? 'open';
    const id = await insertConversation(db, {
      workspaceId,
      contactId,
      status,
      assigneeAccountId: o.assignee ?? null,
      lastMessageReceivedAt: last,
      lastReplySentAt: reply,
      lastActivityAt: reply && reply > last ? reply : last,
      ...(status === 'open'
        ? { waitingSince: since, waitingStartedBy: o.startedBy ?? 'message' }
        : {}),
    });
    for (const [i, m] of messages.entries()) {
      await insertMessage(db, {
        workspaceId,
        conversationId: id,
        telegramMessageId: BigInt(i + 1),
        receivedAt: m,
      });
    }
    return id;
  }

  describe('waitingForPings', () => {
    it('returns only the open waiting conversations of the workspace, oldest period first, with start, kind and assignee', async () => {
      const w = await insertWorkspace(db);
      const { accountId } = await insertMembership(db, w);
      const later = await waiting(w, { since: at(5), assignee: accountId });
      const earlier = await waiting(w, { since: at(2), startedBy: 'reopen', replySentAt: at(1) });
      await waiting(w, { status: 'closed' });
      const answered = await insertConversation(db, {
        workspaceId: w,
        contactId: await insertContact(db, { workspaceId: w, telegramUserId: nextUser++ }),
      });
      expect(answered).toBeTruthy();
      const rows = await reads.waitingForPings(w, { accountIds: [accountId] });
      expect(rows.map((r) => r.conversationId)).toEqual([earlier, later]);
      expect(rows[0]).toMatchObject({
        assigneeAccountId: null,
        waitingSince: at(2),
        startedBy: 'reopen',
      });
      expect(rows[1]).toMatchObject({
        assigneeAccountId: accountId,
        waitingSince: at(5),
        startedBy: 'message',
        startingArrival: at(5),
      });
    });

    it('the starting arrival of a message period is the message that began it; of a reopen the first message after the last reply', async () => {
      const w = await insertWorkspace(db);
      const message = await waiting(w, { since: at(10), messages: [at(1), at(10), at(12)] });
      const reopen = await waiting(w, {
        since: at(20),
        startedBy: 'reopen',
        replySentAt: at(3),
        messages: [at(1), at(4), at(6)],
      });
      const rows = await reads.waitingForPings(w, { accountIds: [] });
      const by = (id: string) => rows.find((r) => r.conversationId === id)!;
      expect(by(message).startingArrival).toEqual(at(10));
      expect(by(reopen).startingArrival).toEqual(at(4));
    });

    it('readBy holds the given accounts whose mark reaches the starting arrival, the watermark exactly at it included', async () => {
      const w = await insertWorkspace(db);
      const reader = (await insertMembership(db, w)).accountId;
      const exact = (await insertMembership(db, w)).accountId;
      const behind = (await insertMembership(db, w)).accountId;
      const none = (await insertMembership(db, w)).accountId;
      const id = await waiting(w, { since: at(5) });
      await insertReadMark(db, {
        workspaceId: w,
        conversationId: id,
        accountId: reader,
        readThroughAt: at(9),
      });
      await insertReadMark(db, {
        workspaceId: w,
        conversationId: id,
        accountId: exact,
        readThroughAt: at(5),
      });
      await insertReadMark(db, {
        workspaceId: w,
        conversationId: id,
        accountId: behind,
        readThroughAt: at(4),
      });
      const [row] = await reads.waitingForPings(w, { accountIds: [reader, exact, behind, none] });
      expect([...row!.readBy].sort()).toEqual([reader, exact].sort());
    });

    it('returns the read state of an unlinked assignee that is not in accountIds', async () => {
      const w = await insertWorkspace(db);
      const assignee = (await insertMembership(db, w)).accountId;
      const linked = (await insertMembership(db, w)).accountId;
      const id = await waiting(w, { since: at(5), assignee });
      await insertReadMark(db, {
        workspaceId: w,
        conversationId: id,
        accountId: assignee,
        readThroughAt: at(6),
      });
      const [row] = await reads.waitingForPings(w, { accountIds: [linked] });
      expect([...row!.readBy]).toEqual([assignee]);
    });

    it('narrows to conversationIds', async () => {
      const w = await insertWorkspace(db);
      const one = await waiting(w, { since: at(1) });
      await waiting(w, { since: at(2) });
      const rows = await reads.waitingForPings(w, { conversationIds: [one], accountIds: [] });
      expect(rows.map((r) => r.conversationId)).toEqual([one]);
      expect(await reads.waitingForPings(w, { conversationIds: [], accountIds: [] })).toEqual([]);
    });

    it('never returns a conversation, or a read mark, of another workspace', async () => {
      const { a, b, sharedAccountId } = await twoWorkspacesWithInbox(db);
      const inA = await waiting(a.workspaceId, { since: at(5) });
      const inB = await waiting(b.workspaceId, { since: at(5) });
      await insertReadMark(db, {
        workspaceId: b.workspaceId,
        conversationId: inB,
        accountId: sharedAccountId,
        readThroughAt: at(9),
      });
      const rowsA = await reads.waitingForPings(a.workspaceId, { accountIds: [sharedAccountId] });
      expect(rowsA.map((r) => r.conversationId)).toEqual([inA]);
      expect(rowsA[0]!.readBy.size).toBe(0);
      expect(
        await reads.waitingForPings(a.workspaceId, { conversationIds: [inB], accountIds: [] }),
      ).toEqual([]);
    });
  });

  describe('attentionCount', () => {
    it('counts the member’s own and the unassigned open conversations with an unread customer message, not a teammate’s or a closed one (AC-01)', async () => {
      const w = await insertWorkspace(db);
      const me = (await insertMembership(db, w)).accountId;
      const mate = (await insertMembership(db, w)).accountId;
      await waiting(w, { assignee: me });
      await waiting(w, { assignee: me });
      await waiting(w, { assignee: null });
      await waiting(w, { assignee: mate });
      await waiting(w, { assignee: me, status: 'closed' });
      await waiting(w, { assignee: null, status: 'closed' });
      expect(await reads.attentionCount(w, me, at(-60))).toBe(3);
      expect(await reads.attentionCount(w, mate, at(-60))).toBe(2);
    });

    it('a read mark at or after the newest arrival, or active-since after it, takes a conversation out', async () => {
      const w = await insertWorkspace(db);
      const me = (await insertMembership(db, w)).accountId;
      const read = await waiting(w, { assignee: me, messages: [at(1), at(2)] });
      const partly = await waiting(w, { assignee: me, messages: [at(1), at(8)] });
      await insertReadMark(db, {
        workspaceId: w,
        conversationId: read,
        accountId: me,
        readThroughAt: at(2),
      });
      await insertReadMark(db, {
        workspaceId: w,
        conversationId: partly,
        accountId: me,
        readThroughAt: at(2),
      });
      expect(await reads.attentionCount(w, me, at(-60))).toBe(1);
      expect(await reads.attentionCount(w, me, at(9))).toBe(0);
    });

    it('a teammate’s read does not take it out for me', async () => {
      const w = await insertWorkspace(db);
      const me = (await insertMembership(db, w)).accountId;
      const mate = (await insertMembership(db, w)).accountId;
      const id = await waiting(w);
      await insertReadMark(db, {
        workspaceId: w,
        conversationId: id,
        accountId: mate,
        readThroughAt: at(30),
      });
      expect(await reads.attentionCount(w, me, at(-60))).toBe(1);
      expect(await reads.attentionCount(w, mate, at(-60))).toBe(0);
    });

    it('counts a conversation with an unread message even when a reply answered it (unread, not waiting)', async () => {
      const w = await insertWorkspace(db);
      const me = (await insertMembership(db, w)).accountId;
      await waiting(w, { assignee: me, messages: [at(1)], replySentAt: at(3) });
      expect(await reads.attentionCount(w, me, at(-60))).toBe(1);
    });

    it('is isolated by workspace: the same account counts only the given workspace', async () => {
      const { a, b, sharedAccountId } = await twoWorkspacesWithInbox(db);
      await waiting(a.workspaceId, { assignee: sharedAccountId });
      await waiting(b.workspaceId, { assignee: sharedAccountId });
      await waiting(b.workspaceId, { assignee: null });
      const before = await reads.attentionCount(a.workspaceId, sharedAccountId, at(-600));
      const inB = await reads.attentionCount(b.workspaceId, sharedAccountId, at(-600));
      expect(inB - before).toBe(1);
      const other = await insertWorkspace(db);
      expect(await reads.attentionCount(other, sharedAccountId, at(-600))).toBe(0);
    });
  });
});
