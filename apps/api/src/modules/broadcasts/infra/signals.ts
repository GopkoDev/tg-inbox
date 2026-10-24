import type { Transaction } from 'kysely';
import type { DB } from '../../../platform/db.types.gen.js';
import { publish } from '../../../platform/realtime.js';
import type { BroadcastSignals } from '../app/ports.js';

/**
 * `broadcast.changed { workspace_id, broadcast_id, change }` through the realtime publisher, in the
 * caller's transaction: a rolled-back write publishes nothing (contracts/events.md).
 */
export function createBroadcastSignals(): BroadcastSignals {
  return {
    // The app layer only calls this inside `transaction()`, so `tx` is a real transaction.
    broadcastChanged: (tx, workspaceId, broadcastId, change) =>
      publish(tx as Transaction<DB>, {
        type: 'broadcast.changed',
        v: 1,
        workspace_id: workspaceId,
        broadcast_id: broadcastId,
        change,
      }),
  };
}
