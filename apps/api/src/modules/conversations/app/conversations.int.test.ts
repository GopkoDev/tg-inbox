import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { createDb, type Db } from '../../../platform/db.js';
import { insertWorkspace } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createContacts } from '../../contacts/app/contacts.js';
import { createContactRepo } from '../../contacts/infra/contact-repo.js';
import { createConversationRepo } from '../infra/conversation-repo.js';
import { createMessageRepo } from '../infra/message-repo.js';
import { createConversations, type InboundMessage } from './conversations.js';
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
      contacts: createContacts({ repo: createContactRepo(db), clock }),
      clock,
    });
  }

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
});
