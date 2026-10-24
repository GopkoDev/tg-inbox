import type { Transaction } from 'kysely';
import type { DB } from '../../../platform/db.types.gen.js';
import { publish } from '../../../platform/realtime.js';
import type { Clock } from '../../../platform/clock.js';
import type { BroadcastSignals, ReportSignals } from '../app/ports.js';
import { ReportCoalescer } from '../domain/sending.js';

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

/**
 * `report` signals coalesced in memory per broadcast, one coalescer per workspace (its one active
 * send link publishes them): at most one per broadcast per second, the rest owed and flushed once
 * due (events.md assumption 3, ADR-0011).
 */
export function createReportSignals(signals: BroadcastSignals, clock: Clock): ReportSignals {
  const byWorkspace = new Map<string, ReportCoalescer>();
  const of = (workspaceId: string) => {
    let c = byWorkspace.get(workspaceId);
    if (c === undefined) {
      c = new ReportCoalescer();
      byWorkspace.set(workspaceId, c);
    }
    return c;
  };
  return {
    async report(tx, workspaceId, broadcastId) {
      if (of(workspaceId).shouldPublish(broadcastId, clock.now().getTime())) {
        await signals.broadcastChanged(tx, workspaceId, broadcastId, 'report');
      }
    },
    async flush(tx, workspaceId) {
      const c = byWorkspace.get(workspaceId);
      if (c === undefined) return;
      for (const id of c.flushDue(clock.now().getTime())) {
        await signals.broadcastChanged(tx, workspaceId, id, 'report');
      }
      if (c.tracked().length === 0) byWorkspace.delete(workspaceId);
    },
    msUntilDue(workspaceId, now) {
      return byWorkspace.get(workspaceId)?.msUntilDue(now.getTime()) ?? 0;
    },
  };
}
