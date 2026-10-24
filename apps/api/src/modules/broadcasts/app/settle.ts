import type { Clock } from '../../../platform/clock.js';
import type { AbortReason } from '../domain/recipient.js';
import type {
  BroadcastJobs,
  BroadcastLogger,
  BroadcastRecord,
  BroadcastRepo,
  BroadcastSignals,
  EndReason,
  Executor,
  RecipientRepo,
  Transaction,
} from './ports.js';

export interface SettleDeps {
  transaction: Transaction;
  broadcasts: Pick<BroadcastRepo, 'lockForUpdate' | 'markStopped' | 'markSent'>;
  recipients: Pick<RecipientRepo, 'settleWaiting' | 'hasWaitingOrInFlight' | 'totals'>;
  signals: BroadcastSignals;
  jobs: Pick<BroadcastJobs, 'enqueueBlockedShare'>;
  clock: Clock;
  logger?: BroadcastLogger;
}

/** How a sending broadcast ends (ADR-0009). */
export type Ending =
  { kind: 'stop'; actorAccountId: string } | { kind: 'abort'; reason: AbortReason };

/**
 * Ending a broadcast in one transaction under its row lock (ADR-0009, sad.md §6 flow 13): the
 * waiting recipients are settled in one bulk update, so a claim and a settle decide each
 * recipient exactly once; recipients in flight finish and record their outcome.
 */
export interface Settle {
  /**
   * Joins `tx` (the caller holds the row lock on a `sending` row): every waiting recipient stopped
   * or failed with the abort reason, the broadcast stopped or sent, signal and measure job queued.
   * False when nothing is waiting (a stop then answers unchanged) or the row is not sending.
   */
  endInTx(tx: Executor, row: BroadcastRecord, ending: Ending): Promise<boolean>;
  /** An abort from the sending chain (AC-12); a broadcast stopped meanwhile is left alone. */
  abort(workspaceId: string, broadcastId: string, reason: AbortReason): Promise<boolean>;
  /** `sent` with `completed` once nothing is waiting or in flight (AC-11). */
  finishIfDone(workspaceId: string, broadcastId: string): Promise<boolean>;
  /** The `broadcast.ended` log line, after the ending committed. */
  logEnded(row: BroadcastRecord, endReason: EndReason): Promise<void>;
}

export const BLOCKED_SHARE_DELAY_MS = 48 * 3_600_000;

export function createSettle(deps: SettleDeps): Settle {
  const { transaction, broadcasts, recipients, signals, jobs, clock, logger } = deps;

  async function ended(tx: Executor, row: BroadcastRecord, at: Date) {
    await signals.broadcastChanged(tx, row.workspaceId, row.id, 'status');
    await jobs.enqueueBlockedShare(
      tx,
      row.workspaceId,
      row.id,
      new Date(at.getTime() + BLOCKED_SHARE_DELAY_MS),
    );
  }

  async function logEnded(row: BroadcastRecord, endReason: EndReason) {
    if (!logger) return;
    const totals = await recipients.totals(row.workspaceId, row.id);
    logger.info(
      {
        workspace_id: row.workspaceId,
        broadcast_id: row.id,
        end_reason: endReason,
        totals,
        launch_to_finish_ms: clock.now().getTime() - (row.launchedAt ?? clock.now()).getTime(),
      },
      'broadcast.ended',
    );
  }

  async function endInTx(tx: Executor, row: BroadcastRecord, ending: Ending): Promise<boolean> {
    if (row.status !== 'sending') return false;
    const at = clock.now();
    const { workspaceId, id } = row;
    if (ending.kind === 'stop') {
      const settled = await recipients.settleWaiting(workspaceId, id, { state: 'stopped' }, at, tx);
      if (settled === 0) return false;
      await broadcasts.markStopped(workspaceId, id, ending.actorAccountId, at, tx);
    } else {
      await recipients.settleWaiting(
        workspaceId,
        id,
        { state: 'failed', reason: ending.reason },
        at,
        tx,
      );
      await broadcasts.markSent(workspaceId, id, ending.reason, at, tx);
    }
    await ended(tx, row, at);
    return true;
  }

  /** Runs `decide` under the row lock; logs after the commit when it ended the broadcast. */
  async function locked(
    workspaceId: string,
    broadcastId: string,
    decide: (tx: Executor, row: BroadcastRecord) => Promise<EndReason | null>,
  ): Promise<boolean> {
    const result = await transaction(async (tx) => {
      const row = await broadcasts.lockForUpdate(workspaceId, broadcastId, tx);
      if (row === null || row.status !== 'sending') return null;
      const reason = await decide(tx, row);
      return reason === null ? null : { row, reason };
    });
    if (result === null) return false;
    await logEnded(result.row, result.reason);
    return true;
  }

  return {
    endInTx,
    logEnded,

    abort(workspaceId, broadcastId, reason) {
      return locked(workspaceId, broadcastId, async (tx, row) =>
        (await endInTx(tx, row, { kind: 'abort', reason })) ? reason : null,
      );
    },

    finishIfDone(workspaceId, broadcastId) {
      return locked(workspaceId, broadcastId, async (tx, row) => {
        if (await recipients.hasWaitingOrInFlight(workspaceId, broadcastId, tx)) return null;
        const at = clock.now();
        await broadcasts.markSent(workspaceId, broadcastId, 'completed', at, tx);
        await ended(tx, row, at);
        return 'completed';
      });
    },
  };
}
