import { sql } from 'kysely';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { startRealtimeListener, type RealtimeSignal } from '../../../platform/realtime.js';
import { insertMembership, insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createContacts } from '../../contacts/app/contacts.js';
import { createContactRepo } from '../../contacts/infra/contact-repo.js';
import type { CloseSnapshot } from '../domain/state.js';
import { createActivityRepo } from '../infra/activity-repo.js';
import { createConversationRepo } from '../infra/conversation-repo.js';
import { createConversationSignals } from '../infra/conversation-signals.js';
import { createMessageRepo } from '../infra/message-repo.js';
import { createConversations, type InboundMessage } from './conversations.js';
import { createStateChanges } from './state-changes.js';
import type { MessageRepo } from './ports.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

let nextUser = 800000;
const sender = (telegramUserId: bigint) => ({
  telegramUserId,
  firstName: 'Olena',
  lastName: null,
  username: 'olena',
  languageCode: 'uk',
});

function message(userId: bigint, messageId: bigint, o: Partial<InboundMessage> = {}) {
  return {
    chatId: userId,
    messageId,
    kind: 'text' as const,
    body: `m${messageId}`,
    sentAt: at(Number(messageId)),
    sender: sender(userId),
    raw: { message_id: Number(messageId), text: `m${messageId}` },
    ...o,
  };
}

describe('conversations capture (Postgres)', () => {
  let database: TestDatabase;
  let db: Db;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url, { max: 10 });
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  function build(messages: MessageRepo = createMessageRepo(db)) {
    const clock = fixedClock(at(100));
    return createConversations({
      transaction: (fn) => db.transaction().execute(fn),
      conversations: createConversationRepo(db),
      messages,
      activities: createActivityRepo(db),
      contacts: createContacts({ repo: createContactRepo(db), clock }),
      signals: createConversationSignals(),
      clock,
    });
  }

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function listen() {
    const listener = await startRealtimeListener(database.url, pino({ level: 'silent' }), {
      reconnectDelayMs: 50,
    });
    const got: RealtimeSignal[] = [];
    listener.onSignal((sig) => got.push(sig));
    return { listener, got };
  }
  async function until(cond: () => boolean) {
    const end = Date.now() + 10_000;
    while (!cond()) {
      if (Date.now() > end) throw new Error('timed out waiting for condition');
      await wait(25);
    }
  }
  const listColumns = (workspaceId: string) =>
    db
      .selectFrom('conversations')
      .select(['last_activity_at', 'last_message_received_at', 'last_reply_sent_at'])
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirstOrThrow();

  const counts = async (workspaceId: string) => ({
    contacts: (
      await db.selectFrom('contacts').select('id').where('workspace_id', '=', workspaceId).execute()
    ).length,
    conversations: (
      await db
        .selectFrom('conversations')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .execute()
    ).length,
    messages: (
      await db.selectFrom('messages').select('id').where('workspace_id', '=', workspaceId).execute()
    ).length,
  });

  it('a first message creates contact, conversation and message (AC-07)', async () => {
    const w = await insertWorkspace(db);
    const user = BigInt(nextUser++);
    const conversations = build();
    expect(await conversations.captureInbound(w, message(user, 1n))).toBe('captured');
    expect(await counts(w)).toEqual({ contacts: 1, conversations: 1, messages: 1 });
    expect(await conversations.lastMessageReceivedAt(w)).toEqual(at(100));
    expect(await conversations.hasConversations(w)).toBe(true);
  });

  it('a redelivery is stored once (AC-11)', async () => {
    const w = await insertWorkspace(db);
    const user = BigInt(nextUser++);
    const conversations = build();
    await conversations.captureInbound(w, message(user, 1n));
    expect(await conversations.captureInbound(w, message(user, 1n))).toBe('already_present');
    expect(await counts(w)).toEqual({ contacts: 1, conversations: 1, messages: 1 });
  });

  it('concurrent first messages of one customer → one contact, one conversation, two messages', async () => {
    const w = await insertWorkspace(db);
    const user = BigInt(nextUser++);
    const conversations = build();
    const results = await Promise.all([
      conversations.captureInbound(w, message(user, 1n)),
      conversations.captureInbound(w, message(user, 2n)),
    ]);
    expect(results).toEqual(['captured', 'captured']);
    expect(await counts(w)).toEqual({ contacts: 1, conversations: 1, messages: 2 });
  });

  it('a concurrent duplicate delivery → one message', async () => {
    const w = await insertWorkspace(db);
    const user = BigInt(nextUser++);
    const conversations = build();
    const results = await Promise.all([
      conversations.captureInbound(w, message(user, 1n)),
      conversations.captureInbound(w, message(user, 1n)),
    ]);
    expect(results.sort()).toEqual(['already_present', 'captured']);
    expect(await counts(w)).toEqual({ contacts: 1, conversations: 1, messages: 1 });
  });

  it('a failure mid-transaction leaves nothing half-written', async () => {
    const w = await insertWorkspace(db);
    const user = BigInt(nextUser++);
    const failing: MessageRepo = {
      ...createMessageRepo(db),
      insertOnce: async () => {
        throw new Error('forced failure');
      },
    };
    await expect(build(failing).captureInbound(w, message(user, 1n))).rejects.toThrow(
      'forced failure',
    );
    expect(await counts(w)).toEqual({ contacts: 0, conversations: 0, messages: 0 });
  });

  it('an edit before its original is not kept; the original later keeps its text (AC-10)', async () => {
    const w = await insertWorkspace(db);
    const user = BigInt(nextUser++);
    const conversations = build();
    await conversations.captureInbound(w, message(user, 2n));
    const edit = {
      chatId: user,
      messageId: 1n,
      body: 'edited',
      editedAt: at(50),
      updateId: 5n,
      raw: { message_id: 1, text: 'edited' },
    };
    expect(await conversations.applyEdit(w, edit)).toBe('not_found');
    await conversations.captureInbound(w, message(user, 1n));
    const row = await db
      .selectFrom('messages')
      .select(['body', 'edited_at'])
      .where('workspace_id', '=', w)
      .where('telegram_message_id', '=', '1')
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ body: 'm1', edited_at: null });
    expect(await conversations.applyEdit(w, edit)).toBe('applied');
    expect(await conversations.applyEdit(w, edit)).toBe('not_later');
  });

  it('a customer of another workspace stays separate (tenancy)', async () => {
    const a = await insertWorkspace(db);
    const b = await insertWorkspace(db);
    const user = BigInt(nextUser++);
    const conversations = build();
    await conversations.captureInbound(a, message(user, 1n));
    expect(await conversations.hasConversations(b)).toBe(false);
    expect(await conversations.lastMessageReceivedAt(b)).toBeNull();
    expect(
      await conversations.applyEdit(b, {
        chatId: user,
        messageId: 1n,
        body: 'x',
        editedAt: at(50),
        updateId: 1n,
        raw: {},
      }),
    ).toBe('not_found');
  });

  describe('reopen on a customer message (AC-06, AC-07, ADR-0004)', () => {
    function at_(clockAt: Date) {
      const clock = fixedClock(clockAt);
      return createConversations({
        transaction: (fn) => db.transaction().execute(fn),
        conversations: createConversationRepo(db),
        messages: createMessageRepo(db),
        activities: createActivityRepo(db),
        contacts: createContacts({ repo: createContactRepo(db), clock }),
        signals: createConversationSignals(),
        clock,
      });
    }
    const row = (w: string) =>
      db
        .selectFrom('conversations')
        .select(['id', 'status', 'assignee_account_id', 'state_version', 'customer_message_seq'])
        .where('workspace_id', '=', w)
        .executeTakeFirstOrThrow();
    const entries = (w: string) =>
      db
        .selectFrom('conversation_activities')
        .select(['id', 'kind', 'cause', 'actor_account_id', 'position_at'])
        .where('workspace_id', '=', w)
        .orderBy('position_at')
        .execute();

    /** A captured conversation, then closed with an assignee (as a member's close would leave it). */
    async function closed() {
      const w = await insertWorkspace(db);
      const { accountId } = await insertMembership(db, w);
      const user = BigInt(nextUser++);
      await build().captureInbound(w, message(user, 1n));
      await db
        .updateTable('conversations')
        .set({ status: 'closed', assignee_account_id: accountId, state_version: 4 })
        .where('workspace_id', '=', w)
        .execute();
      return { w, accountId, user };
    }

    it('reopens with the same assignee, one entry at the arrival, and signals it', async () => {
      const { w, accountId, user } = await closed();
      const { listener, got } = await listen();
      try {
        await at_(at(300)).captureInbound(w, message(user, 2n));
        expect(await row(w)).toMatchObject({
          status: 'open',
          assignee_account_id: accountId,
          state_version: 5,
          customer_message_seq: 2,
        });
        expect(await entries(w)).toEqual([
          {
            id: expect.any(String),
            kind: 'reopened',
            cause: 'customer_wrote',
            actor_account_id: null,
            position_at: at(300),
          },
        ]);
        const [entry] = await entries(w);
        await until(() =>
          got.some((g) => g.type === 'conversation.changed' && g.item?.type === 'activity'),
        );
        expect(
          got.filter(
            (g) =>
              g.workspace_id === w &&
              g.type === 'conversation.changed' &&
              g.item?.type === 'activity',
          ),
        ).toEqual([
          expect.objectContaining({
            change: 'created',
            item: { type: 'activity', id: entry!.id },
          }),
        ]);
      } finally {
        await listener.stop();
      }
    });

    it('a late redelivery keeps its message place while the line sits at its arrival', async () => {
      const { w, user } = await closed();
      await at_(at(300)).captureInbound(w, message(user, 0n, { sentAt: at(-60) }));
      const message0 = await db
        .selectFrom('messages')
        .select(['sent_at', 'received_at'])
        .where('workspace_id', '=', w)
        .where('telegram_message_id', '=', '0')
        .executeTakeFirstOrThrow();
      expect(message0.sent_at).toEqual(at(-60));
      expect((await row(w)).status).toBe('open');
      expect((await entries(w)).map((e) => e.position_at)).toEqual([at(300)]);
    });

    it('a duplicate redelivery and an edit do not reopen', async () => {
      const { w, user } = await closed();
      await at_(at(300)).captureInbound(w, message(user, 1n));
      await at_(at(300)).applyEdit(w, {
        chatId: user,
        messageId: 1n,
        body: 'edited',
        editedAt: at(250),
        updateId: 9n,
        raw: { message_id: 1, text: 'edited' },
      });
      expect(await row(w)).toMatchObject({
        status: 'closed',
        state_version: 4,
        customer_message_seq: 1,
      });
      expect(await entries(w)).toEqual([]);
    });

    it('a capture that fails after the reopen leaves the conversation closed', async () => {
      const { w, user } = await closed();
      const failing: MessageRepo = {
        ...createMessageRepo(db),
        insertOnce: async () => {
          throw new Error('forced failure');
        },
      };
      await build(failing)
        .captureInbound(w, message(user, 2n))
        .catch(() => undefined);
      expect(await row(w)).toMatchObject({ status: 'closed', state_version: 4 });
      expect(await entries(w)).toEqual([]);
    });

    function stateChanges() {
      return createStateChanges({
        conversations: createConversationRepo(db),
        activities: createActivityRepo(db),
        signals: createConversationSignals(),
        clock: fixedClock(at(200)),
      });
    }
    const closeAs = (
      w: string,
      actor: string,
      conversationId: string,
      snapshot: CloseSnapshot,
      confirm: boolean,
    ) =>
      db.transaction().execute((tx) =>
        stateChanges().changeStatus(tx, {
          workspaceId: w,
          actorAccountId: actor,
          conversationId,
          to: 'closed',
          expectedStateVersion: 0,
          expectedCloseSnapshot: snapshot,
          confirm,
          actorActiveSince: at(0),
        }),
      );
    /** Closed conversations whose last customer arrival is later than their latest close entry. */
    const integrityViolations = async (workspaceId: string) =>
      (
        await sql<{ id: string }>`SELECT c.id FROM conversations c
          WHERE c.workspace_id = ${workspaceId} AND c.status = 'closed' AND c.last_message_received_at >
            COALESCE((SELECT max(a.position_at) FROM conversation_activities a
              WHERE a.conversation_id = c.id AND a.kind = 'closed'), '-infinity'::timestamptz)`.execute(
          db,
        )
      ).rows;

    it('QG-1 (b): a message between the refusal and close-anyway, even one not arriving later, asks again', async () => {
      const w = await insertWorkspace(db);
      const { accountId } = await insertMembership(db, w);
      const user = BigInt(nextUser++);
      await build().captureInbound(w, message(user, 1n)); // arrival at(100)
      const id = (await row(w)).id;
      const first = await closeAs(
        w,
        accountId,
        id,
        { customerMessageSeq: 1, latestReply: null },
        false,
      );
      if (first.outcome !== 'needs_confirmation') throw new Error(first.outcome);
      // the same arrival instant as the current one (concurrent webhook connections)
      await build().captureInbound(w, message(user, 2n));
      const again = await closeAs(w, accountId, id, first.snapshot, true);
      if (again.outcome !== 'needs_confirmation') throw new Error(again.outcome);
      expect(again.reasons).toContain('new_customer_message');
      expect(again.snapshot.customerMessageSeq).toBe(2);
      expect((await row(w)).status).toBe('open');
      const final = await closeAs(w, accountId, id, again.snapshot, true);
      expect(final.outcome).toBe('recorded');
    });

    it('QG-1 (c): a close racing a capture, many times, leaves no closed conversation with a later arrival', async () => {
      const w = await insertWorkspace(db);
      const { accountId } = await insertMembership(db, w);
      const ids: string[] = [];
      const users: bigint[] = [];
      for (let i = 0; i < 20; i++) {
        const user = BigInt(nextUser++);
        users.push(user);
        await build().captureInbound(w, message(user, 1n));
      }
      const rows = await db
        .selectFrom('conversations')
        .select('id')
        .where('workspace_id', '=', w)
        .execute();
      ids.push(...rows.map((r) => r.id));
      await Promise.all(
        ids.flatMap((id, i) => [
          closeAs(w, accountId, id, { customerMessageSeq: 1, latestReply: null }, true),
          at_(at(400)).captureInbound(w, message(users[i]!, 2n)),
        ]),
      );
      expect(await integrityViolations(w)).toEqual([]);
      // at least some interleavings closed first and were reopened by the capture
      const counts = await db
        .selectFrom('conversations')
        .select(['status', 'state_version', 'customer_message_seq'])
        .where('workspace_id', '=', w)
        .execute();
      for (const c of counts) expect(c.customer_message_seq).toBe(2);
    });
  });

  describe('list columns and signals (AC-01, AC-15)', () => {
    it('capture stamps arrival and activity with the arrival; a later message and a late redelivery move them', async () => {
      const w = await insertWorkspace(db);
      const user = BigInt(nextUser++);
      await build().captureInbound(w, message(user, 5n, { sentAt: at(50) }));
      expect(await listColumns(w)).toEqual({
        last_activity_at: at(100),
        last_message_received_at: at(100),
        last_reply_sent_at: null,
      });
      const later = createConversations({
        transaction: (fn) => db.transaction().execute(fn),
        conversations: createConversationRepo(db),
        messages: createMessageRepo(db),
        activities: createActivityRepo(db),
        contacts: createContacts({
          repo: createContactRepo(db),
          clock: fixedClock(at(400)),
        }),
        signals: createConversationSignals(),
        clock: fixedClock(at(400)),
      });
      // older Telegram time, new id: it arrives now
      await later.captureInbound(w, message(user, 3n, { sentAt: at(30) }));
      expect(await listColumns(w)).toMatchObject({
        last_activity_at: at(400),
        last_message_received_at: at(400),
      });
      // a duplicate changes nothing
      await build().captureInbound(w, message(user, 3n, { sentAt: at(30) }));
      expect(await listColumns(w)).toMatchObject({ last_message_received_at: at(400) });
    });

    it('activity keeps the later sent reply when a message arrives earlier than it', async () => {
      const w = await insertWorkspace(db);
      const user = BigInt(nextUser++);
      await build().captureInbound(w, message(user, 1n));
      await db
        .updateTable('conversations')
        .set({ last_reply_sent_at: at(500), last_activity_at: at(500) })
        .where('workspace_id', '=', w)
        .execute();
      const clock = fixedClock(at(300));
      await createConversations({
        transaction: (fn) => db.transaction().execute(fn),
        conversations: createConversationRepo(db),
        messages: createMessageRepo(db),
        activities: createActivityRepo(db),
        contacts: createContacts({ repo: createContactRepo(db), clock }),
        signals: createConversationSignals(),
        clock,
      }).captureInbound(w, message(user, 2n));
      expect(await listColumns(w)).toEqual({
        last_activity_at: at(500),
        last_message_received_at: at(300),
        last_reply_sent_at: at(500),
      });
    });

    it('an edit leaves the list columns alone', async () => {
      const w = await insertWorkspace(db);
      const user = BigInt(nextUser++);
      const conversations = build();
      await conversations.captureInbound(w, message(user, 1n));
      const before = await listColumns(w);
      await conversations.applyEdit(w, {
        chatId: user,
        messageId: 1n,
        body: 'edited',
        editedAt: at(50),
        updateId: 5n,
        raw: { message_id: 1, text: 'edited' },
      });
      expect(await listColumns(w)).toEqual(before);
    });

    it('signals created and edited are published with the write, none for a duplicate or a rollback', async () => {
      const w = await insertWorkspace(db);
      const user = BigInt(nextUser++);
      const { listener, got } = await listen();
      try {
        const conversations = build();
        await conversations.captureInbound(w, message(user, 1n));
        await conversations.captureInbound(w, message(user, 1n)); // duplicate
        await conversations.applyEdit(w, {
          chatId: user,
          messageId: 1n,
          body: 'edited',
          editedAt: at(50),
          updateId: 5n,
          raw: { message_id: 1, text: 'edited' },
        });
        const failing: MessageRepo = {
          ...createMessageRepo(db),
          insertOnce: async () => {
            throw new Error('forced failure');
          },
        };
        await build(failing)
          .captureInbound(w, message(user, 9n))
          .catch(() => undefined);
        await until(() => got.length >= 2);
        await wait(200);
        const mine = got.filter((g) => g.workspace_id === w);
        const row = await db
          .selectFrom('messages')
          .select(['id', 'conversation_id'])
          .where('workspace_id', '=', w)
          .executeTakeFirstOrThrow();
        expect(mine).toEqual([
          {
            type: 'conversation.changed',
            v: 1,
            workspace_id: w,
            conversation_id: row.conversation_id,
            item: { type: 'message', id: row.id },
            change: 'created',
          },
          {
            type: 'conversation.changed',
            v: 1,
            workspace_id: w,
            conversation_id: row.conversation_id,
            item: { type: 'message', id: row.id },
            change: 'edited',
          },
        ]);
      } finally {
        await listener.stop();
      }
    });
  });
});
