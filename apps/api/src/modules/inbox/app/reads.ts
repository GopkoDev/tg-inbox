import type {
  Conversation,
  ConversationPage,
  InboxBotStatus,
  ReadState,
  ThreadItem,
  ThreadMessage,
  ThreadPage,
  ThreadReply,
} from '@tg/shared';
import { NotFoundError } from '../../../platform/errors.js';
import type { ConversationRow, MessageView, ReplyView } from '../../conversations/app/ports.js';
import type { InboxReadsDeps } from './ports.js';

export interface Member {
  accountId: string;
  activeSince: Date;
}

const iso = (d: Date) => d.toISOString();
const notFound = () => new NotFoundError('Not found');

function messageDto(workspaceId: string, m: MessageView): ThreadMessage {
  return {
    type: 'message',
    id: m.id,
    workspace_id: workspaceId,
    conversation_id: m.conversationId,
    kind: m.kind,
    body: m.body,
    sent_at: iso(m.sentAt),
    received_at: iso(m.receivedAt),
    edited_at: m.editedAt && iso(m.editedAt),
    attachment: m.attachment && {
      file_name: m.attachment.fileName,
      mime_type: m.attachment.mimeType,
      file_size: m.attachment.fileSize,
    },
    location: m.location && {
      latitude: m.location.latitude,
      longitude: m.location.longitude,
      venue: m.location.venue && {
        title: m.location.venue.title,
        address: m.location.venue.address,
      },
    },
    shared_contact: m.sharedContact && {
      first_name: m.sharedContact.firstName,
      last_name: m.sharedContact.lastName,
      phone_number: m.sharedContact.phoneNumber,
    },
    poll: m.poll && { question: m.poll.question, options: m.poll.options },
  };
}

export function replyDto(
  workspaceId: string,
  r: ReplyView,
  names: ReadonlyMap<string, string>,
): ThreadReply {
  return {
    type: 'reply',
    id: r.id,
    workspace_id: workspaceId,
    conversation_id: r.conversationId,
    client_key: r.clientKey,
    body: r.body,
    // A kept membership always has a name; the fallback only guards a removed account.
    author: { account_id: r.authorAccountId, display_name: names.get(r.authorAccountId) ?? '?' },
    state: r.state,
    failure_reason: r.failureReason as ThreadReply['failure_reason'],
    position_at: iso(r.positionAt),
    sent_at: r.sentAt && iso(r.sentAt),
    created_at: iso(r.createdAt),
  };
}

/** The inbox read use cases: guarded callers pass the workspace id and the member from the guard. */
export function createInboxReadUseCases(deps: InboxReadsDeps) {
  const { conversations, contacts, workspaces, bots } = deps;

  async function rowsToDtos(workspaceId: string, rows: ConversationRow[]): Promise<Conversation[]> {
    const found = await contacts.contactsByIds(workspaceId, [
      ...new Set(rows.map((r) => r.contactId)),
    ]);
    const byId = new Map(found.map((c) => [c.id, c]));
    const items: Conversation[] = [];
    for (const row of rows) {
      const contact = byId.get(row.contactId);
      // Capture always stores a contact and a first message; a row without either is not shown.
      if (!contact || !row.lastItem) continue;
      items.push({
        id: row.id,
        workspace_id: workspaceId,
        contact: {
          id: contact.id,
          first_name: contact.firstName,
          last_name: contact.lastName,
          username: contact.username,
        },
        last_activity_at: iso(row.lastActivityAt),
        last_item: row.lastItem,
        unread_count: row.unreadCount,
        waiting_for_reply: row.waitingForReply,
      });
    }
    return items;
  }

  return {
    async listConversations(
      workspaceId: string,
      member: Member,
      input: { q?: string | undefined; after?: string | undefined; limit: number },
    ): Promise<ConversationPage> {
      const contactIds = await contacts.searchContactIds(workspaceId, input.q ?? '');
      const page = await conversations.listConversations(workspaceId, {
        ...member,
        contactIds,
        status: 'open',
        assignee: 'all',
        search: (input.q ?? '').trim(),
        cursor: input.after ?? null,
        limit: input.limit,
      });
      return {
        workspace_id: workspaceId,
        items: await rowsToDtos(workspaceId, page.items),
        has_prev: page.hasPrev,
        has_next: page.hasNext,
        next_cursor: page.nextCursor,
      };
    },

    async getConversation(
      workspaceId: string,
      member: Member,
      conversationId: string,
    ): Promise<Conversation> {
      const row = await conversations.conversationSummary(workspaceId, conversationId, member);
      const [dto] = row ? await rowsToDtos(workspaceId, [row]) : [];
      if (!dto) throw notFound();
      return dto;
    },

    async listThreadItems(
      workspaceId: string,
      conversationId: string,
      input: { before?: string | undefined; after?: string | undefined; limit: number },
    ): Promise<ThreadPage> {
      const page = await conversations.threadPage(workspaceId, conversationId, {
        before: input.before ?? null,
        after: input.after ?? null,
        limit: input.limit,
      });
      if (!page) throw notFound();
      // Activity entries reach the thread DTO in the inbox reads task (T12).
      const entries = page.items.flatMap((e) => (e.type === 'activity' ? [] : [e]));
      const authorIds = entries.flatMap((e) =>
        e.type === 'reply' ? [e.reply.authorAccountId] : [],
      );
      const names = authorIds.length
        ? await workspaces.displayNames(workspaceId, [...new Set(authorIds)])
        : new Map<string, string>();
      const items: ThreadItem[] = entries.map((e) =>
        e.type === 'message'
          ? messageDto(workspaceId, e.message)
          : replyDto(workspaceId, e.reply, names),
      );
      return {
        workspace_id: workspaceId,
        conversation_id: conversationId,
        items,
        has_prev: page.hasPrev,
        has_next: page.hasNext,
        prev_cursor: page.prevCursor,
        next_cursor: page.nextCursor,
        read_through_at: page.readThroughAt && iso(page.readThroughAt),
        newest_reply_id: page.newestReplyId,
      };
    },

    async getThreadMessage(
      workspaceId: string,
      conversationId: string,
      messageId: string,
    ): Promise<ThreadMessage> {
      const m = await conversations.threadMessage(workspaceId, conversationId, messageId);
      if (!m) throw notFound();
      return messageDto(workspaceId, m);
    },

    async getThreadReply(
      workspaceId: string,
      conversationId: string,
      replyId: string,
    ): Promise<ThreadReply> {
      const r = await conversations.threadReply(workspaceId, conversationId, replyId);
      if (!r) throw notFound();
      const names = await workspaces.displayNames(workspaceId, [r.authorAccountId]);
      return replyDto(workspaceId, r, names);
    },

    async markConversationRead(
      workspaceId: string,
      member: Member,
      conversationId: string,
      readThroughAt: Date,
    ): Promise<ReadState> {
      const state = await conversations.markRead(workspaceId, {
        ...member,
        conversationId,
        readThroughAt,
      });
      if (!state) throw notFound();
      return {
        workspace_id: workspaceId,
        conversation_id: conversationId,
        read_through_at: iso(state.readThroughAt),
        unread_count: state.unreadCount,
      };
    },

    getInboxBotStatus: (workspaceId: string): Promise<InboxBotStatus> =>
      bots.inboxBotStatus(workspaceId),
  };
}

export type InboxReadUseCases = ReturnType<typeof createInboxReadUseCases>;
