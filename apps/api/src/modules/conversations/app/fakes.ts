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
  ReplyRepo,
  ReplySignal,
  ReplyView,
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
  replies: Array<ReplySignal & { tx: Executor }>;
} {
  const replies: Array<ReplySignal & { tx: Executor }> = [];
  const sent: Array<MessageSignal & { tx: Executor }> = [];
  const read: Array<ReadSignal & { tx: Executor }> = [];
  return {
    sent,
    read,
    replies,
    async replyChanged(tx, signal) {
      replies.push({ ...signal, tx });
    },
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

export interface FakeAttempt {
  id: string;
  workspaceId: string;
  conversationId: string;
  replyId: string;
  kind: string;
  initiatedByAccountId: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  outcome: string | null;
}

/** In-memory ReplyRepo for unit tests (one workspace's conversations are `known`). */
export function fakeReplyRepo(o: {
  conversations: Array<[workspaceId: string, id: string]>;
}): ReplyRepo & {
  replies: Array<ReplyView & { workspaceId: string }>;
  attempts: FakeAttempt[];
  /** Sent times raised by `raiseReplySent`, in call order. */
  raised: Date[];
} {
  const raised: Date[] = [];
  const replies: Array<ReplyView & { workspaceId: string }> = [];
  const attempts: FakeAttempt[] = [];
  const own = (w: string, c: string) =>
    replies.filter((r) => r.workspaceId === w && r.conversationId === c);

  const strip = (row: ReplyView & { workspaceId: string }): ReplyView => {
    const view: ReplyView & { workspaceId?: string } = { ...row };
    delete view.workspaceId;
    return view;
  };
  const order = (a: ReplyView, b: ReplyView) =>
    a.positionAt.getTime() - b.positionAt.getTime() || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1);
  return {
    replies,
    attempts,
    raised,
    async findByClientKey(w, c, key) {
      const r = own(w, c).find((x) => x.clientKey === key);
      return r ? strip(r) : null;
    },
    async findForUpdate(w, c, id) {
      const r = own(w, c).find((x) => x.id === id);
      return r ? strip(r) : null;
    },
    async lockAndCountAttempts(w, account, since) {
      const mine = attempts.filter(
        (a) => a.workspaceId === w && a.initiatedByAccountId === account && a.createdAt > since,
      );
      const times = mine.map((a) => a.createdAt.getTime());
      return { count: mine.length, oldest: times.length ? new Date(Math.min(...times)) : null };
    },
    async newestTeammateReply(w, c, account, afterId) {
      const all = own(w, c).sort(order);
      const seen = all.find((r) => r.id === afterId);
      const found = all
        .filter((r) => r.authorAccountId !== account && (!seen || order(r, seen) > 0))
        .at(-1);
      return found ? strip(found) : null;
    },
    async insert(w, reply) {
      if (!o.conversations.some(([ws, id]) => ws === w && id === reply.conversationId)) return null;
      if (own(w, reply.conversationId).some((r) => r.clientKey === reply.clientKey)) return null;
      const row = {
        id: reply.id,
        workspaceId: w,
        conversationId: reply.conversationId,
        clientKey: reply.clientKey,
        body: reply.body,
        authorAccountId: reply.authorAccountId,
        state: 'sending' as const,
        failureReason: null,
        positionAt: reply.positionAt,
        sentAt: null,
        createdAt: reply.positionAt,
      };
      replies.push(row);
      return strip(row);
    },
    async insertAttempt(w, a) {
      attempts.push({
        ...a,
        workspaceId: w,
        startedAt: null,
        finishedAt: null,
        outcome: null,
      });
    },
    async requeue(w, c, id, positionAt) {
      const r = own(w, c).find((x) => x.id === id);
      if (!r || (r.state !== 'not_delivered' && r.state !== 'not_confirmed')) return null;
      Object.assign(r, { state: 'sending', failureReason: null, positionAt });
      return strip(r);
    },

    async pendingReplies(w, c) {
      return own(w, c)
        .filter((r) => r.state === 'sending')
        .sort(order)
        .map(strip);
    },
    async lastStartedAt(w, c) {
      const times = attempts
        .filter((a) => a.workspaceId === w && a.conversationId === c && a.startedAt)
        .map((a) => a.startedAt!.getTime());
      return times.length ? new Date(Math.max(...times)) : null;
    },
    async startAttempt(w, c, replyId, attemptId, startedAt) {
      const r = own(w, c).find((x) => x.id === replyId);
      if (r?.state !== 'sending') return null;
      const open = attempts
        .filter(
          (a) => a.workspaceId === w && a.replyId === replyId && !a.startedAt && !a.finishedAt,
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      if (open) {
        open.startedAt = startedAt;
        return open.id;
      }
      attempts.push({
        id: attemptId,
        workspaceId: w,
        conversationId: c,
        replyId,
        kind: 'retry',
        initiatedByAccountId: null,
        createdAt: startedAt,
        startedAt,
        finishedAt: null,
        outcome: null,
      });
      return attemptId;
    },
    async finishAttempt(w, c, attemptId, outcome, finishedAt) {
      const a = attempts.find(
        (x) => x.workspaceId === w && x.conversationId === c && x.id === attemptId,
      );
      if (!a || a.finishedAt) return null;
      Object.assign(a, { outcome, finishedAt });
      return { replyId: a.replyId };
    },
    async settleReply(w, c, replyId, settlement) {
      const r = own(w, c).find((x) => x.id === replyId);
      if (r?.state !== 'sending') return null;
      if (settlement.state === 'sent') {
        Object.assign(r, { state: 'sent', failureReason: null, sentAt: settlement.sentAt });
      } else {
        Object.assign(r, {
          state: settlement.state,
          failureReason: settlement.state === 'not_delivered' ? settlement.failureReason : null,
        });
      }
      return strip(r);
    },
    async raiseReplySent(_w, _c, sentAt) {
      raised.push(sentAt);
    },
    async skipAttempt(w, c, replyId, attemptId, finishedAt) {
      const open = attempts.filter(
        (a) => a.workspaceId === w && a.replyId === replyId && !a.startedAt && !a.finishedAt,
      );
      for (const a of open) Object.assign(a, { outcome: 'skipped', finishedAt });
      if (open.length > 0) return;
      attempts.push({
        id: attemptId,
        workspaceId: w,
        conversationId: c,
        replyId,
        kind: 'retry',
        initiatedByAccountId: null,
        createdAt: finishedAt,
        startedAt: null,
        finishedAt,
        outcome: 'skipped',
      });
    },
    async inFlightAttempts(w, c, olderThan) {
      return attempts
        .filter(
          (a) =>
            a.workspaceId === w &&
            a.conversationId === c &&
            a.startedAt &&
            !a.finishedAt &&
            (!olderThan || a.startedAt < olderThan),
        )
        .map((a) => ({ id: a.id, replyId: a.replyId }));
    },
  };
}
