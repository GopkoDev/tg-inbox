import type {
  ActiveMemberList,
  AssigneeLens,
  Conversation,
  ConversationPage,
  ConversationSummary,
  InboxBotStatus,
  MemberRef,
  ReadState,
  StatusLens,
  ThreadActivity,
  ThreadItem,
  ThreadMessage,
  ThreadPage,
  ThreadReply,
} from '@tg/shared';
import { NotFoundError } from '../../../platform/errors.js';
import type {
  ActivityView,
  ConversationRow,
  ConversationSummaryRow,
  MessageView,
  ReplyView,
} from '../../conversations/app/ports.js';
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

/** A kept membership always has a name; the fallback only guards a removed account. */
const memberRef = (names: ReadonlyMap<string, string>, accountId: string): MemberRef => ({
  account_id: accountId,
  display_name: names.get(accountId) ?? '?',
});
export const orNull = (names: ReadonlyMap<string, string>, accountId: string | null) =>
  accountId === null ? null : memberRef(names, accountId);

/** The accounts an activity entry names: actor, previous and new assignee. */
const activityAccountIds = (a: ActivityView): string[] =>
  [a.actorAccountId, a.previousAssigneeAccountId, a.newAssigneeAccountId].filter(
    (id): id is string => id !== null,
  );

export function activityDto(
  workspaceId: string,
  a: ActivityView,
  names: ReadonlyMap<string, string>,
): ThreadActivity {
  return {
    type: 'activity',
    id: a.id,
    workspace_id: workspaceId,
    conversation_id: a.conversationId,
    kind: a.kind,
    cause: a.cause,
    actor: orNull(names, a.actorAccountId),
    previous_assignee: orNull(names, a.previousAssigneeAccountId),
    new_assignee: orNull(names, a.newAssigneeAccountId),
    position_at: iso(a.positionAt),
  };
}

/** The inbox read use cases: guarded callers pass the workspace id and the member from the guard. */
export function createInboxReadUseCases(deps: InboxReadsDeps) {
  const { conversations, contacts, workspaces, bots } = deps;

  async function namesOf(workspaceId: string, ids: readonly string[]) {
    const unique = [...new Set(ids)];
    return unique.length ? workspaces.displayNames(workspaceId, unique) : new Map<string, string>();
  }

  async function rowsToDtos(workspaceId: string, rows: ConversationRow[]): Promise<Conversation[]> {
    const names = await namesOf(
      workspaceId,
      rows.flatMap((r) => (r.assigneeAccountId === null ? [] : [r.assigneeAccountId])),
    );
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
        status: row.status,
        assignee: orNull(names, row.assigneeAccountId),
        state_version: row.stateVersion,
      });
    }
    return items;
  }

  async function summaryDto(
    workspaceId: string,
    row: ConversationSummaryRow | null,
  ): Promise<ConversationSummary> {
    const [dto] = row ? await rowsToDtos(workspaceId, [row]) : [];
    if (!row || !dto) throw notFound();
    const snapshot = row.closeSnapshot;
    return {
      ...dto,
      close_snapshot: {
        customer_message_seq: snapshot.customerMessageSeq,
        latest_reply: snapshot.latestReply && {
          id: snapshot.latestReply.id,
          state: snapshot.latestReply.state,
        },
      },
    };
  }

  return {
    async listConversations(
      workspaceId: string,
      member: Member,
      input: {
        status: StatusLens;
        assignee: AssigneeLens;
        q?: string | undefined;
        after?: string | undefined;
        limit: number;
      },
    ): Promise<ConversationPage> {
      // Searching is decided once, from the normalised query: `null` contact ids is no search (a
      // blank or bare "@" query), so the status lens stays applied, said and bound to the cursor.
      const contactIds = await contacts.searchContactIds(workspaceId, input.q ?? '');
      const searching = contactIds !== null;
      const search = searching ? (input.q ?? '').trim() : '';
      const page = await conversations.listConversations(workspaceId, {
        ...member,
        contactIds,
        status: input.status,
        assignee: input.assignee,
        search,
        cursor: input.after ?? null,
        limit: input.limit,
      });
      return {
        workspace_id: workspaceId,
        // Searching sets the status lens aside (AC-01): the page says so.
        lens: { status: searching ? null : input.status, assignee: input.assignee },
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
    ): Promise<ConversationSummary> {
      return summaryDto(
        workspaceId,
        await conversations.conversationSummary(workspaceId, conversationId, member),
      );
    },

    /** The conversation of a contact (the profile's "open conversation"); a pure read. */
    async getContactConversation(
      workspaceId: string,
      member: Member,
      contactId: string,
    ): Promise<ConversationSummary> {
      return summaryDto(
        workspaceId,
        await conversations.findByContact(workspaceId, contactId, member),
      );
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
      const names = await namesOf(
        workspaceId,
        page.items.flatMap((e) => {
          if (e.type === 'reply') return [e.reply.authorAccountId];
          if (e.type === 'activity') return activityAccountIds(e.activity);
          return [];
        }),
      );
      // Broadcast items are enriched from `broadcasts` by T25 (listThreadItems, ADR-0010); until
      // then they are left out of the page.
      const items: ThreadItem[] = page.items.flatMap((e): ThreadItem[] => {
        if (e.type === 'message') return [messageDto(workspaceId, e.message)];
        if (e.type === 'reply') return [replyDto(workspaceId, e.reply, names)];
        if (e.type === 'activity') return [activityDto(workspaceId, e.activity, names)];
        return [];
      });
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

    async getThreadActivity(
      workspaceId: string,
      conversationId: string,
      activityId: string,
    ): Promise<ThreadActivity> {
      const a = await conversations.threadActivity(workspaceId, conversationId, activityId);
      if (!a) throw notFound();
      return activityDto(workspaceId, a, await namesOf(workspaceId, activityAccountIds(a)));
    },

    async listActiveMembers(workspaceId: string): Promise<ActiveMemberList> {
      const members = await workspaces.activeMembers(workspaceId);
      return {
        workspace_id: workspaceId,
        items: members.map((m) => ({ account_id: m.accountId, display_name: m.displayName })),
      };
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
