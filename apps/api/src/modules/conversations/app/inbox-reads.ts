import type { Clock } from '../../../platform/clock.js';
import { ValidationError } from '../../../platform/errors.js';
import {
  decodeListCursor,
  decodeThreadCursor,
  encodeListCursor,
  encodeThreadCursor,
  type ThreadPosition,
} from '../domain/thread.js';
import type { Transaction } from './conversations.js';
import type {
  ConversationListReads,
  ConversationRow,
  ConversationSignals,
  MediaReference,
  MessageView,
  ReadMarkRepo,
  ReadState,
  ReplyView,
  ThreadEntry,
  ThreadReads,
  Viewer,
} from './ports.js';

export interface InboxReadsDeps {
  transaction: Transaction;
  lists: ConversationListReads;
  threads: ThreadReads;
  marks: ReadMarkRepo;
  signals: ConversationSignals;
  clock: Clock;
}

export interface ListInput extends Viewer {
  contactIds: string[] | null;
  cursor: string | null;
  limit: number;
}

export interface ConversationPageResult {
  items: ConversationRow[];
  hasPrev: boolean;
  hasNext: boolean;
  nextCursor: string | null;
}

export interface ThreadInput {
  before: string | null;
  after: string | null;
  limit: number;
}

export interface ThreadPageResult {
  items: ThreadEntry[];
  hasPrev: boolean;
  hasNext: boolean;
  prevCursor: string | null;
  nextCursor: string | null;
  /** Present on the latest page only. */
  readThroughAt: Date | null;
  /** The conversation's newest reply, whatever page it is on; null when it has none. */
  newestReplyId: string | null;
}

export interface MarkReadInput extends Viewer {
  conversationId: string;
  readThroughAt: Date;
}

/** The read side of the conversations app layer — what `inbox` calls (sad.md §5). Null means "not found". */
export interface InboxReads {
  listConversations(workspaceId: string, input: ListInput): Promise<ConversationPageResult>;
  conversationSummary(
    workspaceId: string,
    conversationId: string,
    viewer: Viewer,
  ): Promise<ConversationRow | null>;
  threadPage(
    workspaceId: string,
    conversationId: string,
    input: ThreadInput,
  ): Promise<ThreadPageResult | null>;
  threadMessage(
    workspaceId: string,
    conversationId: string,
    messageId: string,
  ): Promise<MessageView | null>;
  threadReply(
    workspaceId: string,
    conversationId: string,
    replyId: string,
  ): Promise<ReplyView | null>;
  messageMedia(
    workspaceId: string,
    conversationId: string,
    messageId: string,
  ): Promise<MediaReference | null>;
  /** Raises this member's watermark and tells this member's own sockets (ADR-0005). */
  markRead(workspaceId: string, input: MarkReadInput): Promise<ReadState | null>;
}

function threadCursor(cursor: string | null): ThreadPosition | null {
  if (cursor === null) return null;
  const position = decodeThreadCursor(cursor);
  if (position === null) throw new ValidationError('The cursor is not valid.');
  return position;
}

export function createInboxReads(deps: InboxReadsDeps): InboxReads {
  const { transaction, lists, threads, marks, signals, clock } = deps;
  return {
    async listConversations(workspaceId, input) {
      let after = null;
      if (input.cursor !== null) {
        after = decodeListCursor(input.cursor);
        if (after === null) throw new ValidationError('The cursor is not valid.');
      }
      const { rows, hasNext } = await lists.listPage(workspaceId, {
        accountId: input.accountId,
        activeSince: input.activeSince,
        contactIds: input.contactIds,
        after,
        limit: input.limit,
      });
      const last = rows.at(-1);
      return {
        items: rows,
        hasPrev: after !== null,
        hasNext,
        nextCursor:
          hasNext && last
            ? encodeListCursor({ lastActivityAt: last.lastActivityAt, id: last.id })
            : null,
      };
    },

    conversationSummary: (workspaceId, conversationId, viewer) =>
      lists.summary(workspaceId, conversationId, viewer),

    async threadPage(workspaceId, conversationId, input) {
      if (input.before !== null && input.after !== null) {
        throw new ValidationError('Send either before or after, not both.');
      }
      const before = threadCursor(input.before);
      const after = threadCursor(input.after);
      const page = await threads.page(workspaceId, conversationId, {
        before,
        after,
        limit: input.limit,
      });
      if (page === null) return null;
      const first = page.entries[0];
      const last = page.entries.at(-1);
      return {
        items: page.entries,
        hasPrev: page.hasPrev,
        hasNext: page.hasNext,
        prevCursor: page.hasPrev && first ? encodeThreadCursor(first.position) : null,
        nextCursor: page.hasNext && last ? encodeThreadCursor(last.position) : null,
        readThroughAt: page.readThroughAt,
        newestReplyId: page.newestReplyId,
      };
    },

    threadMessage: (workspaceId, conversationId, messageId) =>
      threads.message(workspaceId, conversationId, messageId),
    threadReply: (workspaceId, conversationId, replyId) =>
      threads.reply(workspaceId, conversationId, replyId),
    messageMedia: (workspaceId, conversationId, messageId) =>
      threads.mediaReference(workspaceId, conversationId, messageId),

    markRead(workspaceId, input) {
      return transaction(async (tx) => {
        const state = await marks.markRead(
          workspaceId,
          {
            conversationId: input.conversationId,
            accountId: input.accountId,
            activeSince: input.activeSince,
            proposed: input.readThroughAt,
            now: clock.now(),
          },
          tx,
        );
        if (state === null) return null;
        // Published in the write's transaction: delivered only if the watermark commits (ADR-0003).
        await signals.conversationRead(tx, {
          workspaceId,
          conversationId: input.conversationId,
          accountId: input.accountId,
        });
        return state;
      });
    },
  };
}
