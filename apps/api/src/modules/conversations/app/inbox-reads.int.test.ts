import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { startRealtimeListener, type RealtimeSignal } from '../../../platform/realtime.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertConversation, insertMessage } from '../../../test/fixtures/conversations.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createConversationSignals } from '../infra/conversation-signals.js';
import { createListQueries } from '../infra/list-queries.js';
import { createReadMarkRepo } from '../infra/read-mark-repo.js';
import { createThreadQueries } from '../infra/thread-queries.js';
import { createInboxReads } from './inbox-reads.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe('inbox reads (Postgres)', () => {
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

  const reads = () =>
    createInboxReads({
      transaction: (fn) => db.transaction().execute(fn),
      lists: createListQueries(db),
      threads: createThreadQueries(db),
      marks: createReadMarkRepo(db),
      signals: createConversationSignals(),
      clock: fixedClock(at(100)),
    });

  async function seed() {
    const workspaceId = await insertWorkspace(db);
    const { accountId } = await insertMembership(db, workspaceId);
    const contactId = await insertContact(db, { workspaceId });
    const conversationId = await insertConversation(db, {
      workspaceId,
      contactId,
      lastActivityAt: at(30),
      lastMessageReceivedAt: at(30),
    });
    await insertMessage(db, {
      workspaceId,
      conversationId,
      telegramMessageId: 1n,
      receivedAt: at(30),
    });
    return { workspaceId, accountId, conversationId };
  }

  it('publishes conversation.changed (read) with the account id, once the watermark commits (AC-15)', async () => {
    const s = await seed();
    const listener = await startRealtimeListener(database.url, pino({ level: 'silent' }));
    const got: RealtimeSignal[] = [];
    listener.onSignal((sig) => got.push(sig));
    try {
      const state = await reads().markRead(s.workspaceId, {
        conversationId: s.conversationId,
        accountId: s.accountId,
        activeSince: at(0),
        readThroughAt: at(30),
      });
      expect(state).toEqual({ readThroughAt: at(30), unreadCount: 0 });
      const end = Date.now() + 10_000;
      while (got.length === 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
      expect(got).toEqual([
        {
          type: 'conversation.changed',
          v: 1,
          workspace_id: s.workspaceId,
          conversation_id: s.conversationId,
          item: null,
          change: 'read',
          account_id: s.accountId,
        },
      ]);
    } finally {
      await listener.stop();
    }
  });

  it('publishes nothing for a conversation of another workspace', async () => {
    const s = await seed();
    const other = await insertWorkspace(db);
    const listener = await startRealtimeListener(database.url, pino({ level: 'silent' }));
    const got: RealtimeSignal[] = [];
    listener.onSignal((sig) => got.push(sig));
    try {
      const state = await reads().markRead(other, {
        conversationId: s.conversationId,
        accountId: s.accountId,
        activeSince: at(0),
        readThroughAt: at(30),
      });
      expect(state).toBeNull();
      await new Promise((r) => setTimeout(r, 300));
      expect(got).toEqual([]);
    } finally {
      await listener.stop();
    }
  });
});
