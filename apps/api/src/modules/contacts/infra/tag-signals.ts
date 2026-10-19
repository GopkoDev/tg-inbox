import type { Transaction } from 'kysely';
import type { DB } from '../../../platform/db.types.gen.js';
import { publish } from '../../../platform/realtime.js';
import type { TagSignals } from '../app/ports.js';

/**
 * `contact.changed` / `tags.changed` through the realtime publisher, in the caller's transaction:
 * a rolled-back write publishes nothing (contracts/events.md).
 */
export function createTagSignals(): TagSignals {
  return {
    // The app layer only calls these inside `transaction()`, so `tx` is a real transaction.
    contactChanged: (tx, workspaceId, contactId) =>
      publish(tx as Transaction<DB>, {
        type: 'contact.changed',
        v: 1,
        workspace_id: workspaceId,
        contact_id: contactId,
        change: 'tags',
      }),
    tagsChanged: (tx, workspaceId) =>
      publish(tx as Transaction<DB>, { type: 'tags.changed', v: 1, workspace_id: workspaceId }),
  };
}
