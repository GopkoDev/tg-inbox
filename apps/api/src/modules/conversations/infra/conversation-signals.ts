import type { Transaction } from 'kysely';
import type { DB } from '../../../platform/db.types.gen.js';
import { publish } from '../../../platform/realtime.js';
import type { ConversationSignals } from '../app/ports.js';

/** `conversation.changed` through the realtime publisher, in the caller's transaction (ADR-0003). */
export function createConversationSignals(): ConversationSignals {
  return {
    // The app layer only calls this inside `transaction()`, so `tx` is a real transaction.
    messageChanged: (tx, s) =>
      publish(tx as Transaction<DB>, {
        type: 'conversation.changed',
        v: 1,
        workspace_id: s.workspaceId,
        conversation_id: s.conversationId,
        item: { type: 'message', id: s.messageId },
        change: s.change,
      }),
    replyChanged: (tx, s) =>
      publish(tx as Transaction<DB>, {
        type: 'conversation.changed',
        v: 1,
        workspace_id: s.workspaceId,
        conversation_id: s.conversationId,
        item: { type: 'reply', id: s.replyId },
        change: s.change,
      }),
    conversationRead: (tx, s) =>
      publish(tx as Transaction<DB>, {
        type: 'conversation.changed',
        v: 1,
        workspace_id: s.workspaceId,
        conversation_id: s.conversationId,
        item: null,
        change: 'read',
        account_id: s.accountId,
      }),
  };
}
