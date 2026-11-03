import type { Transaction } from 'kysely';
import type { DB } from '../../../platform/db.types.gen.js';
import { publish } from '../../../platform/realtime.js';
import type { DestinationSignals } from '../app/destinations.js';

/**
 * `post.changed { workspace_id, post_id }` and `destinations.changed { workspace_id }` through the
 * realtime publisher, in the caller's transaction (ids only, contracts/events.md).
 */
export function createPostSignals(): DestinationSignals {
  return {
    // The app layer only calls these inside `transaction()`, so `tx` is a real transaction.
    postChanged: (tx, workspaceId, postId) =>
      publish(tx as Transaction<DB>, {
        type: 'post.changed',
        v: 1,
        workspace_id: workspaceId,
        post_id: postId,
      }),
    destinationsChanged: (tx, workspaceId) =>
      publish(tx as Transaction<DB>, {
        type: 'destinations.changed',
        v: 1,
        workspace_id: workspaceId,
      }),
  };
}
