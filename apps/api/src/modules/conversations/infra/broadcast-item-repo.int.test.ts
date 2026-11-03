import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { startRealtimeListener, type RealtimeSignal } from '../../../platform/realtime.js';
import { twoWorkspacesWithBroadcasts } from '../../../test/fixtures/broadcasts.js';
import {
  insertActivity,
  insertBroadcastItem,
  insertMessage,
  insertReadMark,
  insertReply,
} from '../../../test/fixtures/conversations.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createBroadcastItems, type BroadcastItems } from '../app/broadcast-items.js';
import type { ThreadEntry } from '../app/ports.js';
import { createBroadcastItemRepo } from './broadcast-item-repo.js';
import { createConversationSignals } from './conversation-signals.js';
import { createThreadQueries } from './thread-queries.js';

const T0 = new Date('2026-10-20T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe('broadcast items (postgres, ADR-0010, AC-16)', () => {
  let database: TestDatabase;
  let db: Db;
  let items: BroadcastItems;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    items = createBroadcastItems({
      items: createBroadcastItemRepo(db),
      signals: createConversationSignals(),
      clock: fixedClock(at(1000)),
    });
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  const inTx = <T>(fn: (tx: Db) => Promise<T>) =>
    db.transaction().execute((tx) => fn(tx as unknown as Db));
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const conversationRow = (workspaceId: string, id: string) =>
    db
      .selectFrom('conversations')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  it('writes the item and signals it, leaving every conversation column and read mark as it was', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    await db
      .updateTable('conversations')
      .set({
        status: 'closed',
        assignee_account_id: null,
        waiting_since: null,
        waiting_started_by: null,
      })
      .where('id', '=', a.conversationId)
      .execute();
    await insertReadMark(db, {
      workspaceId: a.workspaceId,
      conversationId: a.conversationId,
      accountId: a.operatorAccountId,
      readThroughAt: at(-60),
    });
    const before = await conversationRow(a.workspaceId, a.conversationId);
    const marksBefore = await db.selectFrom('read_marks').selectAll().execute();
    const activitiesBefore = await db.selectFrom('conversation_activities').selectAll().execute();

    const listener = await startRealtimeListener(database.url, pino({ level: 'silent' }), {
      reconnectDelayMs: 50,
    });
    const got: RealtimeSignal[] = [];
    listener.onSignal((sig) => got.push(sig));
    let out: Awaited<ReturnType<BroadcastItems['recordBroadcastItem']>>;
    try {
      out = await inTx((tx) =>
        items.recordBroadcastItem(tx, {
          workspaceId: a.workspaceId,
          contactId: a.taggedContactId,
          broadcastId: a.launchedId,
          state: 'delivered',
          positionAt: at(5),
          telegramMessageId: 4242n,
        }),
      );
      const end = Date.now() + 10_000;
      while (got.length < 1 && Date.now() < end) await wait(25);
      await wait(150);
    } finally {
      await listener.stop();
    }
    expect(out).toEqual({ id: expect.any(String), conversationId: a.conversationId });
    expect(got).toEqual([
      {
        type: 'conversation.changed',
        v: 1,
        workspace_id: a.workspaceId,
        conversation_id: a.conversationId,
        item: { type: 'broadcast', id: out!.id },
        change: 'created',
      },
    ]);
    expect(await conversationRow(a.workspaceId, a.conversationId)).toEqual(before);
    expect(await db.selectFrom('read_marks').selectAll().execute()).toEqual(marksBefore);
    expect(await db.selectFrom('conversation_activities').selectAll().execute()).toEqual(
      activitiesBefore,
    );
    expect(await items.getBroadcastItem(a.workspaceId, a.conversationId, out!.id)).toEqual({
      id: out!.id,
      conversationId: a.conversationId,
      broadcastId: a.launchedId,
      state: 'delivered',
      positionAt: at(5),
      telegramMessageId: 4242n,
      createdAt: at(1000),
    });
  });

  it('a not confirmed item has no message id; a second item of the same broadcast is refused', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    const out = await inTx((tx) =>
      items.recordBroadcastItem(tx, {
        workspaceId: a.workspaceId,
        contactId: a.taggedContactId,
        broadcastId: a.launchedId,
        state: 'not_confirmed',
        positionAt: at(3),
        telegramMessageId: null,
      }),
    );
    expect(await items.getBroadcastItem(a.workspaceId, a.conversationId, out!.id)).toMatchObject({
      state: 'not_confirmed',
      positionAt: at(3),
      telegramMessageId: null,
    });
    await expect(
      inTx((tx) =>
        items.recordBroadcastItem(tx, {
          workspaceId: a.workspaceId,
          contactId: a.taggedContactId,
          broadcastId: a.launchedId,
          state: 'delivered',
          positionAt: at(4),
          telegramMessageId: 1n,
        }),
      ),
    ).rejects.toThrow(/broadcast_items_broadcast_conversation_key/);
  });

  it('the thread interleaves broadcast items in (position_at, kind, id) order, both page directions', async () => {
    const { a } = await twoWorkspacesWithBroadcasts(db);
    const ws = a.workspaceId;
    const conv = a.conversationId;
    await insertMessage(db, {
      workspaceId: ws,
      conversationId: conv,
      telegramMessageId: 1n,
      sentAt: at(5),
    });
    await insertReply(db, {
      workspaceId: ws,
      conversationId: conv,
      authorAccountId: a.operatorAccountId,
      positionAt: at(5),
    });
    await insertActivity(db, {
      workspaceId: ws,
      conversationId: conv,
      kind: 'assigned',
      actorAccountId: a.operatorAccountId,
      newAssigneeAccountId: a.operatorAccountId,
      positionAt: at(5),
    });
    const atFive = await insertBroadcastItem(db, {
      workspaceId: ws,
      conversationId: conv,
      broadcastId: a.launchedId,
      positionAt: at(5),
    });
    const atThree = await insertBroadcastItem(db, {
      workspaceId: ws,
      conversationId: conv,
      broadcastId: a.draftId,
      state: 'not_confirmed',
      positionAt: at(3),
    });
    await insertMessage(db, {
      workspaceId: ws,
      conversationId: conv,
      telegramMessageId: 2n,
      sentAt: at(6),
    });

    const threads = createThreadQueries(db);
    const label = (e: ThreadEntry) =>
      e.type === 'broadcast' ? `broadcast:${e.broadcastItem.id}` : e.type;
    const all = await threads.page(ws, conv, { before: null, after: null, limit: 50 });
    expect(all!.entries.map(label)).toEqual([
      `broadcast:${atThree}`,
      'message',
      'reply',
      'activity',
      `broadcast:${atFive}`,
      'message',
    ]);

    // Walk older pages of one item from the newest, then newer pages from the oldest.
    const backwards: string[] = [];
    let page = await threads.page(ws, conv, { before: null, after: null, limit: 1 });
    backwards.unshift(...page!.entries.map(label));
    while (page!.hasPrev) {
      page = await threads.page(ws, conv, {
        before: page!.entries[0]!.position,
        after: null,
        limit: 1,
      });
      backwards.unshift(...page!.entries.map(label));
    }
    expect(backwards).toEqual(all!.entries.map(label));

    const forwards: string[] = [];
    let next = await threads.page(ws, conv, {
      before: null,
      after: all!.entries[0]!.position,
      limit: 1,
    });
    forwards.push(...next!.entries.map(label));
    while (next!.hasNext) {
      next = await threads.page(ws, conv, {
        before: null,
        after: next!.entries.at(-1)!.position,
        limit: 1,
      });
      forwards.push(...next!.entries.map(label));
    }
    expect(forwards).toEqual(all!.entries.slice(1).map(label));
  });

  it('is scoped by workspace: no item for a contact of another workspace, no foreign read', async () => {
    const { a, b } = await twoWorkspacesWithBroadcasts(db);
    const inB = await insertBroadcastItem(db, {
      workspaceId: b.workspaceId,
      conversationId: b.conversationId,
      broadcastId: b.launchedId,
    });
    expect(
      await inTx((tx) =>
        items.recordBroadcastItem(tx, {
          workspaceId: a.workspaceId,
          contactId: b.taggedContactId,
          broadcastId: a.launchedId,
          state: 'delivered',
          positionAt: at(5),
          telegramMessageId: 1n,
        }),
      ),
    ).toBeNull();
    // A's conversation with B's broadcast: the composite foreign key refuses it.
    await expect(
      inTx((tx) =>
        items.recordBroadcastItem(tx, {
          workspaceId: a.workspaceId,
          contactId: a.taggedContactId,
          broadcastId: b.launchedId,
          state: 'delivered',
          positionAt: at(5),
          telegramMessageId: 1n,
        }),
      ),
    ).rejects.toThrow();
    expect(await items.getBroadcastItem(a.workspaceId, b.conversationId, inB)).toBeNull();
    expect(await items.getBroadcastItem(a.workspaceId, a.conversationId, inB)).toBeNull();
    expect(await items.getBroadcastItem(b.workspaceId, b.conversationId, inB)).not.toBeNull();
    const threads = createThreadQueries(db);
    const pageA = await threads.page(a.workspaceId, a.conversationId, {
      before: null,
      after: null,
      limit: 50,
    });
    expect(pageA!.entries.filter((e) => e.type === 'broadcast')).toEqual([]);
  });
});
