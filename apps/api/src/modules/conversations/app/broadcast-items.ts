import type { Clock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import type {
  BroadcastItemRepo,
  BroadcastItemView,
  ConversationSignals,
  Executor,
  NewBroadcastItem,
} from './ports.js';

export interface BroadcastItemsDeps {
  items: BroadcastItemRepo;
  signals: Pick<ConversationSignals, 'broadcastItemChanged'>;
  clock: Clock;
}

/**
 * Broadcast items in the thread (ADR-0010) — what `broadcasts` (the outcome transaction) and
 * `inbox` (the one-item read) call. Takes no conversation, read-mark or activity writer: an item
 * never changes the conversation's status, assignee, state version, waiting period, last activity
 * or anyone's unread.
 */
export interface BroadcastItems {
  /**
   * In the caller's outcome transaction, after the recipient row: one item in the contact's
   * conversation, then `conversation.changed { item.type: broadcast, change: created }`. Null when
   * the contact has no conversation in the workspace (nothing written, nothing published).
   */
  recordBroadcastItem(
    tx: Executor,
    item: NewBroadcastItem,
  ): Promise<{ id: string; conversationId: string } | null>;
  getBroadcastItem(
    workspaceId: string,
    conversationId: string,
    itemId: string,
  ): Promise<BroadcastItemView | null>;
}

export function createBroadcastItems({
  items,
  signals,
  clock,
}: BroadcastItemsDeps): BroadcastItems {
  return {
    async recordBroadcastItem(tx, item) {
      const id = newId();
      const written = await items.insert({ ...item, id, createdAt: clock.now() }, tx);
      if (written === null) return null;
      await signals.broadcastItemChanged(tx, {
        workspaceId: item.workspaceId,
        conversationId: written.conversationId,
        broadcastItemId: id,
      });
      return { id, conversationId: written.conversationId };
    },
    getBroadcastItem: (workspaceId, conversationId, itemId) =>
      items.byId(workspaceId, conversationId, itemId),
  };
}
