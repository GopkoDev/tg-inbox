import type { Transaction } from 'kysely';
import type { DB } from '../../../platform/db.types.gen.js';
import { publish } from '../../../platform/realtime.js';
import type { NotificationSignals } from '../app/ports.js';

/** `telegram_link.changed` through the realtime publisher, in the caller's transaction (ADR-0010). */
export function createNotificationSignals(): NotificationSignals {
  return {
    // The app layer only runs this inside `transaction()`, so `tx` is a real transaction.
    telegramLinkChanged: (tx, workspaceId, accountId) =>
      publish(tx as Transaction<DB>, {
        type: 'telegram_link.changed',
        v: 1,
        workspace_id: workspaceId,
        account_id: accountId,
      }),
  };
}
