import { newId } from '../../../platform/ids.js';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../platform/db.js';
import { insertContact } from '../../../test/fixtures/contacts.js';
import { insertConversation, insertMessage } from '../../../test/fixtures/conversations.js';
import { insertWorkspace, twoWorkspaces } from '../../../test/fixtures/workspaces.js';
import { startTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import { createMessageRepo, newestReceivedAtQuery } from './message-repo.js';

const T0 = new Date('2026-10-11T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe('message repository', () => {
  let database: TestDatabase;
  let db: Db;
  let repo: ReturnType<typeof createMessageRepo>;

  beforeAll(async () => {
    database = await startTestDatabase();
    db = createDb(database.url);
    repo = createMessageRepo(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await database?.stop();
  });

  async function conversation(workspaceId?: string) {
    const w = workspaceId ?? (await insertWorkspace(db));
    const contactId = await insertContact(db, { workspaceId: w });
    return { w, conversationId: await insertConversation(db, { workspaceId: w, contactId }) };
  }

  const rowsOf = (conversationId: string) =>
    db
      .selectFrom('messages')
      .selectAll()
      .where('conversation_id', '=', conversationId)
      .orderBy('telegram_message_id')
      .execute();

  const message = (conversationId: string, telegramMessageId: bigint, body = 'Hello') => ({
    id: newId(),
    conversationId,
    telegramMessageId,
    kind: 'text' as const,
    body,
    telegramMessage: { message_id: Number(telegramMessageId), text: body },
    sentAt: at(Number(telegramMessageId)),
  });

  it('inserts a message once; a redelivery is already_present and changes nothing (AC-11)', async () => {
    const { w, conversationId } = await conversation();
    expect(await repo.insertOnce(w, message(conversationId, 1n), at(100))).toBe('captured');
    expect(await repo.insertOnce(w, message(conversationId, 1n, 'Changed?'), at(200))).toBe(
      'already_present',
    );
    const rows = await rowsOf(conversationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspace_id: w,
      telegram_message_id: '1',
      kind: 'text',
      body: 'Hello',
      telegram_message: { message_id: 1, text: 'Hello' },
      sent_at: at(1),
      received_at: at(100),
      edited_at: null,
      edit_update_id: null,
    });
  });

  it('a late redelivered message takes its place in Telegram order (AC-11)', async () => {
    const { w, conversationId } = await conversation();
    await repo.insertOnce(w, message(conversationId, 3n), at(100));
    await repo.insertOnce(w, message(conversationId, 1n), at(101));
    await repo.insertOnce(w, message(conversationId, 2n), at(102));
    expect((await rowsOf(conversationId)).map((r) => r.telegram_message_id)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('stores a non-text kind with a null body', async () => {
    const { w, conversationId } = await conversation();
    await repo.insertOnce(
      w,
      {
        ...message(conversationId, 4n),
        kind: 'sticker',
        body: null,
        telegramMessage: { sticker: {} },
      },
      at(100),
    );
    expect(await rowsOf(conversationId)).toMatchObject([{ kind: 'sticker', body: null }]);
  });

  const edit = (
    conversationId: string,
    telegramMessageId: bigint,
    body: string,
    editedAt: Date,
    editUpdateId: bigint,
  ) => ({
    conversationId,
    telegramMessageId,
    body,
    telegramMessage: {
      message_id: Number(telegramMessageId),
      text: body,
      edit_date: editedAt.getTime() / 1000,
    },
    editedAt,
    editUpdateId,
  });

  it('applies a later edit, refuses an earlier or equal one, converging on the last edit (AC-10)', async () => {
    const { w, conversationId } = await conversation();
    await repo.insertOnce(w, message(conversationId, 1n), at(100));
    expect(await repo.applyEdit(w, edit(conversationId, 1n, 'third', at(30), 7n))).toBe('applied');
    expect(await repo.applyEdit(w, edit(conversationId, 1n, 'first', at(10), 9n))).toBe(
      'not_later',
    );
    expect(await repo.applyEdit(w, edit(conversationId, 1n, 'lower id', at(30), 6n))).toBe(
      'not_later',
    );
    expect(await repo.applyEdit(w, edit(conversationId, 1n, 'redelivered', at(30), 7n))).toBe(
      'not_later',
    );
    expect(await rowsOf(conversationId)).toMatchObject([
      {
        body: 'third',
        edited_at: at(30),
        edit_update_id: '7',
        telegram_message: { text: 'third' },
        received_at: at(100),
      },
    ]);
    expect(await repo.applyEdit(w, edit(conversationId, 1n, 'tie wins', at(30), 8n))).toBe(
      'applied',
    );
    expect((await rowsOf(conversationId))[0]?.body).toBe('tie wins');
  });

  it('an edit that removes a caption clears the body of a media message (AC-10)', async () => {
    const { w, conversationId } = await conversation();
    await repo.insertOnce(
      w,
      { ...message(conversationId, 5n, 'Old caption'), kind: 'photo', telegramMessage: {} },
      at(100),
    );
    const removed = { ...edit(conversationId, 5n, 'x', at(40), 3n), body: null };
    expect(await repo.applyEdit(w, removed)).toBe('applied');
    expect(await rowsOf(conversationId)).toMatchObject([{ kind: 'photo', body: null }]);
  });

  it('an edit without text never empties a text message', async () => {
    const { w, conversationId } = await conversation();
    await repo.insertOnce(w, message(conversationId, 6n), at(100));
    const empty = { ...edit(conversationId, 6n, 'x', at(40), 3n), body: null };
    expect(await repo.applyEdit(w, empty)).toBe('not_later');
    expect(await rowsOf(conversationId)).toMatchObject([{ kind: 'text', body: 'Hello' }]);
  });

  it('an edit of a message never captured is not_found and writes nothing (AC-10)', async () => {
    const { w, conversationId } = await conversation();
    expect(await repo.applyEdit(w, edit(conversationId, 99n, 'x', at(1), 1n))).toBe('not_found');
    expect(await rowsOf(conversationId)).toEqual([]);
  });

  it('isolation: insertOnce and applyEdit never touch another workspace’s conversation (AC-13)', async () => {
    const { a, b } = await twoWorkspaces(db);
    const { conversationId } = await conversation(a);
    await repo.insertOnce(a, message(conversationId, 1n), at(100));
    expect(await repo.applyEdit(b, edit(conversationId, 1n, 'from B', at(50), 1n))).toBe(
      'not_found',
    );
    expect((await rowsOf(conversationId))[0]?.body).toBe('Hello');
    await expect(repo.insertOnce(b, message(conversationId, 2n), at(100))).rejects.toThrow();
    expect(await rowsOf(conversationId)).toHaveLength(1);
  });

  it('isolation: newestReceivedAt is per workspace, null with no messages', async () => {
    const { a, b } = await twoWorkspaces(db);
    const { conversationId } = await conversation(a);
    expect(await repo.newestReceivedAt(a)).toBeNull();
    await insertMessage(db, {
      workspaceId: a,
      conversationId,
      telegramMessageId: 1n,
      receivedAt: at(10),
    });
    await insertMessage(db, {
      workspaceId: a,
      conversationId,
      telegramMessageId: 2n,
      receivedAt: at(30),
    });
    await insertMessage(db, {
      workspaceId: a,
      conversationId,
      telegramMessageId: 3n,
      receivedAt: at(20),
    });
    expect(await repo.newestReceivedAt(a)).toEqual(at(30));
    expect(await repo.newestReceivedAt(b)).toBeNull();
  });

  it('newestReceivedAt can use messages_workspace_id_received_at_idx', async () => {
    const w = await insertWorkspace(db);
    const plan = await db.transaction().execute(async (tx) => {
      await sql`SET LOCAL enable_seqscan = off`.execute(tx);
      return newestReceivedAtQuery(tx, w).explain();
    });
    expect(plan.map((r) => String(r['QUERY PLAN'])).join('\n')).toContain(
      'messages_workspace_id_received_at_idx',
    );
  });

  it('findId returns the captured message id, only inside its own workspace', async () => {
    const { w, conversationId } = await conversation();
    const m = message(conversationId, 40n);
    await repo.insertOnce(w, m, at(100));
    expect(await repo.findId(w, conversationId, 40n)).toBe(m.id);
    expect(await repo.findId(w, conversationId, 41n)).toBeNull();
    const other = await conversation();
    expect(await repo.findId(other.w, conversationId, 40n)).toBeNull();
  });
});
