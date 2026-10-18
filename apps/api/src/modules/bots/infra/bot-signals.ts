import type { Transaction } from 'kysely';
import { publish } from '../../../platform/realtime.js';
import type { DB } from '../../../platform/db.types.gen.js';
import type { BotSignals } from '../app/ports.js';

/** `bot.changed` through the realtime publisher, in the caller's transaction (ADR-0003). */
export function createBotSignals(): BotSignals {
  return {
    // The app layer only runs this inside `transaction()`, so `tx` is a real transaction.
    botChanged: (tx, workspaceId) =>
      publish(tx as Transaction<DB>, { type: 'bot.changed', v: 1, workspace_id: workspaceId }),
  };
}
