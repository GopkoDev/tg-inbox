import { newId } from '../../../platform/ids.js';
import type { Clock } from '../../../platform/clock.js';
import type { Contacts } from '../../contacts/app/contacts.js';
import type { ContactProfile } from '../../contacts/app/ports.js';
import type { MessageKind } from '../domain/message.js';
import { recordChange } from './state-changes.js';
import type {
  ActivityRepo,
  ConversationRepo,
  EditOutcome,
  ConversationSignals,
  Executor,
  InsertOutcome,
  MessageRepo,
} from './ports.js';

/** A private message `bots` has already filtered and normalised (flow 2). */
export interface InboundMessage {
  chatId: bigint;
  messageId: bigint;
  kind: MessageKind;
  /** Text, or the caption of any other kind; null when there is neither. */
  body: string | null;
  /** Telegram's `date`. */
  sentAt: Date;
  sender: ContactProfile;
  /** Telegram's message object, stored for its media references. */
  raw: Record<string, unknown>;
}

/** An edit of a private message's text or caption (flow 8). */
export interface InboundEdit {
  chatId: bigint;
  messageId: bigint;
  body: string | null;
  /** Telegram's `edit_date`. */
  editedAt: Date;
  /** The update's `update_id` — the tie-break for equal edit times. */
  updateId: bigint;
  raw: Record<string, unknown>;
}

/** Runs `fn` in one database transaction, handing it the executor for every repo call. */
export type Transaction = <T>(fn: (tx: Executor) => Promise<T>) => Promise<T>;

export interface ConversationsDeps {
  transaction: Transaction;
  conversations: ConversationRepo;
  messages: MessageRepo;
  activities: ActivityRepo;
  contacts: Pick<Contacts, 'upsertFromProfile'>;
  signals: ConversationSignals;
  clock: Clock;
}

/** The conversations app layer — what `bots` calls (sad.md §5, cross-module app-layer calls). */
export interface Conversations {
  captureInbound(workspaceId: string, message: InboundMessage): Promise<InsertOutcome>;
  applyEdit(workspaceId: string, edit: InboundEdit): Promise<EditOutcome>;
  lastMessageReceivedAt(workspaceId: string): Promise<Date | null>;
  hasConversations(workspaceId: string): Promise<boolean>;
  /**
   * The `onMembershipDeactivated` port: inside the deactivation's transaction, after the membership
   * `UPDATE`, returns every conversation of the workspace assigned to the account to the team.
   * Lock order (sad.md §8): workspace row, membership row, then these conversation rows by id; the
   * assign path share-locks memberships before its conversation row, so the two never cross.
   */
  unassignDeactivatedMember(
    tx: Executor,
    event: { workspaceId: string; accountId: string; at: Date },
  ): Promise<void>;
}

export function createConversations(deps: ConversationsDeps): Conversations {
  const { transaction, conversations, messages, activities, contacts, signals, clock } = deps;
  return {
    // One short transaction (ADR-0003): contact, conversation, message — or nothing. Any database
    // error propagates so the webhook answers 5xx and Telegram redelivers.
    captureInbound(workspaceId, m) {
      const now = clock.now();
      return transaction(async (tx) => {
        const { contactId } = await contacts.upsertFromProfile(workspaceId, m.sender, m.sentAt, tx);
        const { conversationId } = await conversations.upsert(
          workspaceId,
          { contactId, telegramChatId: m.chatId },
          now,
          tx,
        );
        const id = newId();
        const outcome = await messages.insertOnce(
          workspaceId,
          {
            id,
            conversationId,
            telegramMessageId: m.messageId,
            kind: m.kind,
            body: m.body,
            telegramMessage: m.raw,
            sentAt: m.sentAt,
          },
          now,
          tx,
        );
        if (outcome === 'captured') {
          // The arrival moves the row to the top of the list; a duplicate moves nothing (AC-01, AC-11).
          const raised = await conversations.raiseReceived(workspaceId, conversationId, now, tx);
          await signals.messageChanged(tx, {
            workspaceId,
            conversationId,
            messageId: id,
            change: 'created',
          });
          // Decided on the status the raise UPDATE returned under the row lock, never on an earlier
          // read: a close racing this capture either committed first (reopened here) or sees the
          // counter grow (ADR-0004). The assignee stays.
          if (raised.status === 'closed') {
            await recordChange({ conversations, activities, signals }, tx, {
              workspaceId,
              conversationId,
              kind: 'reopened',
              cause: 'customer_wrote',
              actorAccountId: null,
              previousAssignee: null,
              newAssignee: null,
              now,
            });
          }
        }
        return outcome;
      });
    },

    async unassignDeactivatedMember(tx, { workspaceId, accountId, at }) {
      const ids = await conversations.lockAssignedTo(workspaceId, accountId, tx);
      for (const conversationId of ids) {
        await recordChange({ conversations, activities, signals }, tx, {
          workspaceId,
          conversationId,
          kind: 'unassigned',
          cause: 'member_deactivated',
          actorAccountId: null,
          previousAssignee: accountId,
          newAssignee: null,
          now: at,
        });
      }
    },

    // An edit of a message not captured adds nothing and is not kept for later (AC-10).
    async applyEdit(workspaceId, e) {
      const conversationId = await conversations.findByChat(workspaceId, e.chatId);
      if (conversationId === null) return 'not_found';
      return transaction(async (tx) => {
        const outcome = await messages.applyEdit(
          workspaceId,
          {
            conversationId,
            telegramMessageId: e.messageId,
            body: e.body,
            telegramMessage: e.raw,
            editedAt: e.editedAt,
            editUpdateId: e.updateId,
          },
          tx,
        );
        if (outcome === 'applied') {
          // An edit never moves arrival or activity: it only announces itself.
          const messageId = await messages.findId(workspaceId, conversationId, e.messageId, tx);
          if (messageId !== null) {
            await signals.messageChanged(tx, {
              workspaceId,
              conversationId,
              messageId,
              change: 'edited',
            });
          }
        }
        return outcome;
      });
    },

    lastMessageReceivedAt: (workspaceId) => messages.newestReceivedAt(workspaceId),
    hasConversations: (workspaceId) => conversations.hasAny(workspaceId),
  };
}
