import type { Kysely } from 'kysely';
import type { DB } from '../../platform/db.types.gen.js';
import { newId } from '../../platform/ids.js';
import { insertContact } from './contacts.js';
import { insertMembership, insertWorkspace } from './workspaces.js';

const T = new Date('2026-10-11T10:00:00Z');

/** A conversations row; `telegramChatId` defaults to the contact's Telegram user id. */
export async function insertConversation(
  db: Kysely<DB>,
  o: { workspaceId: string; contactId: string; telegramChatId?: bigint },
): Promise<string> {
  const id = newId();
  const chatId =
    o.telegramChatId ??
    (
      await db
        .selectFrom('contacts')
        .select('telegram_user_id')
        .where('id', '=', o.contactId)
        .executeTakeFirstOrThrow()
    ).telegram_user_id;
  await db
    .insertInto('conversations')
    .values({
      id,
      workspace_id: o.workspaceId,
      contact_id: o.contactId,
      telegram_chat_id: chatId,
      created_at: T,
    })
    .execute();
  return id;
}

/** A messages row (default: a text message "Hello" sent and received at T). */
export async function insertMessage(
  db: Kysely<DB>,
  o: {
    workspaceId: string;
    conversationId: string;
    telegramMessageId: bigint;
    kind?: string;
    body?: string | null;
    sentAt?: Date;
    receivedAt?: Date;
    editedAt?: Date;
    editUpdateId?: bigint;
  },
): Promise<string> {
  const id = newId();
  const kind = o.kind ?? 'text';
  const body = o.body === undefined ? (kind === 'text' ? 'Hello' : null) : o.body;
  await db
    .insertInto('messages')
    .values({
      id,
      workspace_id: o.workspaceId,
      conversation_id: o.conversationId,
      telegram_message_id: o.telegramMessageId,
      kind,
      body,
      telegram_message: JSON.stringify({ message_id: Number(o.telegramMessageId) }),
      sent_at: o.sentAt ?? T,
      received_at: o.receivedAt ?? T,
      edited_at: o.editedAt ?? null,
      edit_update_id: o.editUpdateId ?? null,
    })
    .execute();
  return id;
}

type ReplyState = 'sending' | 'sent' | 'not_delivered' | 'not_confirmed';

/** A replies row (default: a "sending" reply "Hello" at T). `sent` fills sentAt / telegramMessageId. */
export async function insertReply(
  db: Kysely<DB>,
  o: {
    workspaceId: string;
    conversationId: string;
    authorAccountId: string;
    body?: string;
    state?: ReplyState;
    failureReason?: string | null;
    positionAt?: Date;
    sentAt?: Date | null;
    telegramMessageId?: bigint | null;
    clientKey?: string;
  },
): Promise<string> {
  const id = newId();
  const state = o.state ?? 'sending';
  const positionAt = o.positionAt ?? T;
  await db
    .insertInto('replies')
    .values({
      id,
      workspace_id: o.workspaceId,
      conversation_id: o.conversationId,
      author_account_id: o.authorAccountId,
      client_key: o.clientKey ?? newId(),
      body: o.body ?? 'Hello',
      state,
      failure_reason: o.failureReason ?? (state === 'not_delivered' ? 'customer_blocked' : null),
      position_at: positionAt,
      sent_at: state === 'sent' ? (o.sentAt ?? positionAt) : null,
      telegram_message_id: state === 'sent' ? (o.telegramMessageId ?? 9000n) : null,
      created_at: positionAt,
    })
    .execute();
  return id;
}

type AttemptOutcome =
  'accepted' | 'refused' | 'bot_unauthorized' | 'not_accepted' | 'unknown' | 'skipped';

/** A reply_attempts row (default: an unstarted `send` attempt by `initiatedByAccountId`). */
export async function insertReplyAttempt(
  db: Kysely<DB>,
  o: {
    workspaceId: string;
    conversationId: string;
    replyId: string;
    kind?: 'send' | 'try_again' | 'send_again' | 'retry';
    initiatedByAccountId?: string | null;
    createdAt?: Date;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    outcome?: AttemptOutcome | null;
  },
): Promise<string> {
  const id = newId();
  await db
    .insertInto('reply_attempts')
    .values({
      id,
      workspace_id: o.workspaceId,
      conversation_id: o.conversationId,
      reply_id: o.replyId,
      kind: o.kind ?? 'send',
      initiated_by_account_id: o.initiatedByAccountId ?? null,
      created_at: o.createdAt ?? T,
      started_at: o.startedAt ?? null,
      finished_at: o.finishedAt ?? null,
      outcome: o.outcome ?? null,
    })
    .execute();
  return id;
}

/** A read_marks row: the member has read the conversation through `readThroughAt`. */
export async function insertReadMark(
  db: Kysely<DB>,
  o: { workspaceId: string; conversationId: string; accountId: string; readThroughAt: Date },
): Promise<string> {
  const id = newId();
  await db
    .insertInto('read_marks')
    .values({
      id,
      workspace_id: o.workspaceId,
      conversation_id: o.conversationId,
      account_id: o.accountId,
      read_through_at: o.readThroughAt,
      created_at: T,
    })
    .execute();
  return id;
}

/**
 * Two workspaces sharing one Telegram user (AC-18); each has a member, a conversation,
 * a customer message and a reply.
 */
export async function twoWorkspacesWithInbox(db: Kysely<DB>) {
  const telegramUserId = 700001n;
  async function build(name: string) {
    const workspaceId = await insertWorkspace(db, name);
    const { accountId } = await insertMembership(db, workspaceId);
    const contactId = await insertContact(db, { workspaceId, telegramUserId });
    const conversationId = await insertConversation(db, { workspaceId, contactId });
    const messageId = await insertMessage(db, {
      workspaceId,
      conversationId,
      telegramMessageId: 1n,
    });
    const replyId = await insertReply(db, {
      workspaceId,
      conversationId,
      authorAccountId: accountId,
    });
    return { workspaceId, accountId, contactId, conversationId, messageId, replyId };
  }
  return { a: await build('A'), b: await build('B') };
}
