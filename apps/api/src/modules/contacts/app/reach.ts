import type { ContactRepo, Executor, ReachRepo, ReachSignals } from './ports.js';

/** Runs `fn` in one database transaction, handing it the executor for every repo call. */
export type Transaction = <T>(fn: (tx: Executor) => Promise<T>) => Promise<T>;

export interface ContactReachDeps {
  transaction: Transaction;
  contacts: Pick<ContactRepo, 'idByTelegramUser'>;
  reach: Pick<ReachRepo, 'applyBlockChange'>;
  signals: ReachSignals;
}

/** What `bots` calls on contacts for reachability (sad.md §5, ADR-0002, ADR-0003). */
export interface ContactReach {
  /**
   * A block (`blocked`) or unblock of the bot `telegramBotId` by a Telegram user, at Telegram's
   * time (an update) or our clock (a refused send). Applied only when not older than the newest
   * fact; a Telegram user who is not a contact of the workspace (a member's linked account) is a
   * no-op. Publishes `contact.changed { change: "reach" }` in its transaction only when the mark
   * changed. True when it did.
   */
  recordBlockChange(
    workspaceId: string,
    telegramBotId: bigint,
    telegramUserId: bigint,
    blocked: boolean,
    at: Date,
  ): Promise<boolean>;
}

export function createContactReach(deps: ContactReachDeps): ContactReach {
  const { transaction, contacts, reach, signals } = deps;
  return {
    recordBlockChange: (workspaceId, telegramBotId, telegramUserId, blocked, at) =>
      transaction(async (tx) => {
        const contactId = await contacts.idByTelegramUser(workspaceId, telegramUserId, tx);
        if (contactId === null) return false;
        const changed = await reach.applyBlockChange(
          workspaceId,
          contactId,
          telegramBotId,
          blocked,
          at,
          tx,
        );
        if (changed) await signals.reachChanged(tx, workspaceId, contactId);
        return changed;
      }),
  };
}

/**
 * Capture's "wrote" through `telegramBotId`, in the capture transaction after the contact upsert;
 * a message that clears an older block publishes `contact.changed reach`, a first one does not.
 */
export async function recordWrote(
  deps: { reach: Pick<ReachRepo, 'upsertWrote'>; signals: ReachSignals },
  tx: Executor,
  workspaceId: string,
  contactId: string,
  telegramBotId: bigint,
  sentAt: Date,
): Promise<void> {
  if (await deps.reach.upsertWrote(workspaceId, contactId, telegramBotId, sentAt, tx)) {
    await deps.signals.reachChanged(tx, workspaceId, contactId);
  }
}
