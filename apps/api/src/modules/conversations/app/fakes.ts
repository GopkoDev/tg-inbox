import { newId } from '../../../platform/ids.js';
import { isLaterEdit } from '../domain/edit.js';
import type { MessageKind } from '../domain/message.js';
import type {
  ConversationRepo,
  ConversationSignals,
  Executor,
  MessageRepo,
  MessageSignal,
  ReadMarkRepo,
  ReadSignal,
} from './ports.js';
import { raise, unreadFloor } from '../domain/read-state.js';

export interface FakeConversation {
  id: string;
  workspaceId: string;
  contactId: string;
  telegramChatId: bigint;
  createdAt: Date;
  lastActivityAt: Date;
  lastMessageReceivedAt: Date;
  lastReplySentAt: Date | null;
}

/** In-memory ConversationRepo for unit tests. */
export function fakeConversationRepo(): ConversationRepo & { rows: FakeConversation[] } {
  const rows: FakeConversation[] = [];
  const find = (w: string, chat: bigint) =>
    rows.find((r) => r.workspaceId === w && r.telegramChatId === chat);
  return {
    rows,
    async upsert(workspaceId, { contactId, telegramChatId }, now) {
      const existing = find(workspaceId, telegramChatId);
      if (existing) return { conversationId: existing.id, created: false };
      const id = newId();
      rows.push({
        id,
        workspaceId,
        contactId,
        telegramChatId,
        createdAt: now,
        lastActivityAt: now,
        lastMessageReceivedAt: now,
        lastReplySentAt: null,
      });
      return { conversationId: id, created: true };
    },
    async raiseReceived(workspaceId, conversationId, receivedAt) {
      const row = rows.find((r) => r.workspaceId === workspaceId && r.id === conversationId);
      if (!row) return;
      row.lastMessageReceivedAt = new Date(
        Math.max(row.lastMessageReceivedAt.getTime(), receivedAt.getTime()),
      );
      row.lastActivityAt = new Date(
        Math.max(row.lastMessageReceivedAt.getTime(), row.lastReplySentAt?.getTime() ?? 0),
      );
    },
    async findByChat(workspaceId, telegramChatId) {
      return find(workspaceId, telegramChatId)?.id ?? null;
    },
    async hasAny(workspaceId) {
      return rows.some((r) => r.workspaceId === workspaceId);
    },
  };
}

export interface FakeMessage {
  id: string;
  workspaceId: string;
  conversationId: string;
  telegramMessageId: bigint;
  kind: MessageKind;
  body: string | null;
  telegramMessage: Record<string, unknown>;
  sentAt: Date;
  receivedAt: Date;
  editedAt: Date | null;
  editUpdateId: bigint | null;
}

/** In-memory MessageRepo for unit tests; applies the same edit rule as the SQL. */
export function fakeMessageRepo(): MessageRepo & { rows: FakeMessage[] } {
  const rows: FakeMessage[] = [];
  const find = (w: string, c: string, m: bigint) =>
    rows.find((r) => r.workspaceId === w && r.conversationId === c && r.telegramMessageId === m);
  return {
    rows,
    async insertOnce(workspaceId, m, receivedAt) {
      if (find(workspaceId, m.conversationId, m.telegramMessageId)) return 'already_present';
      rows.push({ ...m, workspaceId, receivedAt, editedAt: null, editUpdateId: null });
      return 'captured';
    },
    async applyEdit(workspaceId, e) {
      const row = find(workspaceId, e.conversationId, e.telegramMessageId);
      if (!row) return 'not_found';
      const stored =
        row.editedAt && row.editUpdateId !== null
          ? { editedAt: row.editedAt, editUpdateId: row.editUpdateId }
          : null;
      if (!isLaterEdit(stored, { editedAt: e.editedAt, updateId: e.editUpdateId })) {
        return 'not_later';
      }
      Object.assign(row, {
        body: e.body,
        telegramMessage: e.telegramMessage,
        editedAt: e.editedAt,
        editUpdateId: e.editUpdateId,
      });
      return 'applied';
    },
    async findId(workspaceId, conversationId, telegramMessageId) {
      return find(workspaceId, conversationId, telegramMessageId)?.id ?? null;
    },
    async newestReceivedAt(workspaceId) {
      const times = rows
        .filter((r) => r.workspaceId === workspaceId)
        .map((r) => r.receivedAt.getTime());
      return times.length ? new Date(Math.max(...times)) : null;
    },
  };
}

/** Records every signal with the executor it was published in. */
export function fakeConversationSignals(): ConversationSignals & {
  sent: Array<MessageSignal & { tx: Executor }>;
  read: Array<ReadSignal & { tx: Executor }>;
} {
  const sent: Array<MessageSignal & { tx: Executor }> = [];
  const read: Array<ReadSignal & { tx: Executor }> = [];
  return {
    sent,
    read,
    async messageChanged(tx, signal) {
      sent.push({ ...signal, tx });
    },
    async conversationRead(tx, signal) {
      read.push({ ...signal, tx });
    },
  };
}

/**
 * In-memory ReadMarkRepo over one conversation whose messages arrived at `arrivals`
 * (null: the conversation is not in the workspace). Applies the same raise / floor rules as the SQL.
 */
export function fakeReadMarkRepo(o: {
  arrivals: Date[] | null;
}): ReadMarkRepo & { marks: Map<string, Date> } {
  const marks = new Map<string, Date>();
  return {
    marks,
    async markRead(_workspaceId, input) {
      if (o.arrivals === null) return null;
      const newest = o.arrivals.reduce<Date | null>(
        (m, d) => (m && m.getTime() > d.getTime() ? m : d),
        null,
      );
      if (newest === null) return null;
      const readThroughAt = raise(marks.get(input.accountId) ?? null, input.proposed, newest);
      marks.set(input.accountId, readThroughAt);
      const floor = unreadFloor(readThroughAt, input.activeSince);
      return {
        readThroughAt,
        unreadCount: o.arrivals.filter((d) => d.getTime() > floor.getTime()).length,
      };
    },
  };
}
