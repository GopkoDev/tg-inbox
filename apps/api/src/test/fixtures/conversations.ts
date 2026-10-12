import type { Kysely } from 'kysely';
import type { DB } from '../../platform/db.types.gen.js';
import { newId } from '../../platform/ids.js';

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
