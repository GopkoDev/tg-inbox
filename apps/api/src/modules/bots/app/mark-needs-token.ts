import type { Clock } from '../../../platform/clock.js';
import type { BotRepo, BotSignals, Transaction } from './ports.js';

export interface MarkNeedsTokenDeps {
  bots: BotRepo;
  clock: Clock;
  transaction: Transaction;
  signals: BotSignals;
}

/**
 * Telegram rejected the workspace's token during a send or a file fetch: the live bot becomes
 * `needs_token` and `bot.changed` is published in the same transaction. Idempotent; a no-op for
 * a missing or disconnected bot, and it never overwrites an owner action written since it read.
 */
export type MarkNeedsToken = (workspaceId: string) => Promise<void>;

export function createMarkNeedsToken({
  bots,
  clock,
  transaction,
  signals,
}: MarkNeedsTokenDeps): MarkNeedsToken {
  return async (workspaceId) => {
    const bot = await bots.findByWorkspace(workspaceId);
    if (!bot || bot.state === 'disconnected' || bot.state === 'needs_token') return;
    await transaction(async (tx) => {
      const written = await bots.setState(
        workspaceId,
        bot.id,
        'needs_token',
        clock.now(),
        { ifLastCheckedAt: bot.lastCheckedAt },
        tx,
      );
      if (written) await signals.botChanged(tx, workspaceId);
    });
  };
}
