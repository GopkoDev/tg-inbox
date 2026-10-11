import type { Db } from '../../../platform/db.js';
import type { MessageKind } from '../domain/message.js';

/** A Kysely handle or a transaction (the capture transaction). */
export type Executor = Db;

export interface UpsertedConversation {
  conversationId: string;
  created: boolean;
}

export interface ConversationRepo {
  /** One conversation per (workspace, private chat); inserted once, returned again after. */
  upsert(
    workspaceId: string,
    conversation: { contactId: string; telegramChatId: bigint },
    now: Date,
    tx?: Executor,
  ): Promise<UpsertedConversation>;
  findByChat(workspaceId: string, telegramChatId: bigint, tx?: Executor): Promise<string | null>;
  hasAny(workspaceId: string, tx?: Executor): Promise<boolean>;
}

export interface NewMessage {
  conversationId: string;
  telegramMessageId: bigint;
  kind: MessageKind;
  body: string | null;
  /** Telegram's message object, stored whole for its media references. */
  telegramMessage: Record<string, unknown>;
  sentAt: Date;
}

export interface MessageEdit {
  conversationId: string;
  telegramMessageId: bigint;
  body: string;
  telegramMessage: Record<string, unknown>;
  editedAt: Date;
  editUpdateId: bigint;
}

export type InsertOutcome = 'captured' | 'already_present';
export type EditOutcome = 'applied' | 'not_later' | 'not_found';

export interface MessageRepo {
  /** Keyed by (conversation, Telegram message id): a redelivery is `already_present` (AC-11). */
  insertOnce(
    workspaceId: string,
    message: NewMessage,
    receivedAt: Date,
    tx?: Executor,
  ): Promise<InsertOutcome>;
  /** The conditional update of the edit rule (conversations/domain/edit.ts, AC-10). */
  applyEdit(workspaceId: string, edit: MessageEdit, tx?: Executor): Promise<EditOutcome>;
  newestReceivedAt(workspaceId: string, tx?: Executor): Promise<Date | null>;
}
