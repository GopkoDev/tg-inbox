import { sql, type Selectable } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { BroadcastRecipients } from '../../../platform/db.types.gen.js';
import { notReachedStates, type FailureReason, type RecipientState } from '../domain/recipient.js';
import type { RecipientRecord, RecipientRepo, RecipientTotals } from '../app/ports.js';

type RecipientRow = Selectable<BroadcastRecipients>;

const STATES: readonly RecipientState[] = [
  'waiting',
  'sending',
  'delivered',
  'blocked',
  'failed',
  'not_confirmed',
  'stopped',
];

export function toRecipient(r: RecipientRow): RecipientRecord {
  return {
    id: r.id,
    broadcastId: r.broadcast_id,
    contactId: r.contact_id,
    position: r.position,
    telegramUserId: BigInt(r.telegram_user_id),
    state: r.state as RecipientState,
    failureReason: r.failure_reason as FailureReason | null,
    claimedAt: r.claimed_at,
    outcomeAt: r.outcome_at,
    telegramMessageId: r.telegram_message_id === null ? null : BigInt(r.telegram_message_id),
  };
}

/**
 * `broadcast_recipients`: inserted only by the launch, then moved by conditional single-row
 * updates (claim, outcome, back to waiting) and by the set-based settle — a row-level race decides
 * each recipient exactly once (ADR-0007, ADR-0009).
 */
export function createRecipientRepo(db: Db): RecipientRepo {
  const ofBroadcast = (ex: Db, workspaceId: string, broadcastId: string) =>
    ex
      .selectFrom('broadcast_recipients')
      .where('workspace_id', '=', workspaceId)
      .where('broadcast_id', '=', broadcastId);

  const contactIdsWhere = async (
    ex: Db,
    workspaceId: string,
    broadcastId: string,
    states: readonly RecipientState[],
    failedReasons: readonly FailureReason[],
  ) => {
    const rows = await ofBroadcast(ex, workspaceId, broadcastId)
      .select('contact_id')
      .where((eb) => {
        const parts = [];
        if (states.length > 0) parts.push(eb('state', 'in', [...states]));
        if (failedReasons.length > 0) {
          parts.push(
            eb.and([eb('state', '=', 'failed'), eb('failure_reason', 'in', [...failedReasons])]),
          );
        }
        return eb.or(parts);
      })
      .orderBy('contact_id')
      .execute();
    return rows.map((r) => r.contact_id);
  };

  return {
    async insertAll(workspaceId, broadcastId, rows, tx) {
      if (rows.length === 0) return;
      await sql`
        INSERT INTO broadcast_recipients (id, workspace_id, broadcast_id, contact_id, position, telegram_user_id, state)
        SELECT u.id, ${workspaceId}::uuid, ${broadcastId}::uuid, u.contact_id, u.position, u.telegram_user_id, 'waiting'
        FROM unnest(
          ${rows.map((r) => r.id)}::uuid[],
          ${rows.map((r) => r.contactId)}::uuid[],
          ${rows.map((r) => r.position)}::int[],
          ${rows.map((r) => String(r.telegramUserId))}::bigint[]
        ) AS u(id, contact_id, position, telegram_user_id)
      `.execute(tx);
    },

    async claim(workspaceId, id, at, tx) {
      const result = await (tx ?? db)
        .updateTable('broadcast_recipients')
        .set({ state: 'sending', claimed_at: at })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('state', '=', 'waiting')
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },

    async recordOutcome(workspaceId, id, outcome, at, tx) {
      const result = await (tx ?? db)
        .updateTable('broadcast_recipients')
        .set({
          state: outcome.state,
          failure_reason: outcome.state === 'failed' ? outcome.reason : null,
          telegram_message_id:
            outcome.state === 'delivered' ? String(outcome.telegramMessageId) : null,
          outcome_at: at,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where((eb) =>
          outcome.state === 'blocked'
            ? eb('state', 'in', ['sending', 'waiting'])
            : eb('state', '=', 'sending'),
        )
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },

    async backToWaiting(workspaceId, id, tx) {
      const result = await (tx ?? db)
        .updateTable('broadcast_recipients')
        .set({ state: 'waiting', claimed_at: null })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('state', '=', 'sending')
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },

    async resolveStaleInFlight(workspaceId, broadcastIds, at, tx) {
      if (broadcastIds.length === 0) return [];
      const rows = await tx
        .updateTable('broadcast_recipients')
        .set({ state: 'not_confirmed', outcome_at: at })
        .where('workspace_id', '=', workspaceId)
        .where('broadcast_id', 'in', [...broadcastIds])
        .where('state', '=', 'sending')
        .returning(['id', 'broadcast_id', 'contact_id', 'claimed_at'])
        .execute();
      return rows.map((r) => ({
        id: r.id,
        broadcastId: r.broadcast_id,
        contactId: r.contact_id,
        // The CHECK keeps claimed_at set on every sending row.
        claimedAt: r.claimed_at!,
      }));
    },

    async settleWaiting(workspaceId, broadcastId, settlement, at, tx) {
      const result = await tx
        .updateTable('broadcast_recipients')
        .set({
          state: settlement.state,
          failure_reason: settlement.state === 'failed' ? settlement.reason : null,
          outcome_at: at,
        })
        .where('workspace_id', '=', workspaceId)
        .where('broadcast_id', '=', broadcastId)
        .where('state', '=', 'waiting')
        .executeTakeFirst();
      return Number(result.numUpdatedRows);
    },

    async totals(workspaceId, broadcastId, tx) {
      const rows = await ofBroadcast(tx ?? db, workspaceId, broadcastId)
        .select(['state', (eb) => eb.fn.countAll<string>().as('n')])
        .groupBy('state')
        .execute();
      const totals = Object.fromEntries(STATES.map((s) => [s, 0])) as RecipientTotals;
      for (const r of rows) totals[r.state as RecipientState] = Number(r.n);
      return totals;
    },

    async page(workspaceId, broadcastId, q, limit) {
      let query = ofBroadcast(db, workspaceId, broadcastId).selectAll();
      if (q.after !== undefined) query = query.where('position', '>', q.after);
      if (q.state !== undefined) query = query.where('state', '=', q.state);
      const rows = await query
        .orderBy('position')
        .limit(limit + 1)
        .execute();
      return { rows: rows.slice(0, limit).map(toRecipient), hasNext: rows.length > limit };
    },

    async nextWaiting(workspaceId, broadcastId, tx) {
      const row = await ofBroadcast(tx ?? db, workspaceId, broadcastId)
        .selectAll()
        .where('state', '=', 'waiting')
        .orderBy('position')
        .limit(1)
        .executeTakeFirst();
      return row ? toRecipient(row) : null;
    },

    async hasWaitingOrInFlight(workspaceId, broadcastId, tx) {
      const row = await ofBroadcast(tx ?? db, workspaceId, broadcastId)
        .select('id')
        .where('state', 'in', ['waiting', 'sending'])
        .limit(1)
        .executeTakeFirst();
      return row !== undefined;
    },

    async allContactIds(workspaceId, broadcastId, tx) {
      const rows = await ofBroadcast(tx ?? db, workspaceId, broadcastId)
        .select('contact_id')
        .orderBy('contact_id')
        .execute();
      return rows.map((r) => r.contact_id);
    },

    notReachedContactIds(workspaceId, broadcastId, includeNotConfirmed, tx) {
      const { states, failedReasons } = notReachedStates(includeNotConfirmed);
      return contactIdsWhere(tx ?? db, workspaceId, broadcastId, states, failedReasons);
    },

    deliveredContactIds(workspaceId, broadcastId) {
      return contactIdsWhere(db, workspaceId, broadcastId, ['delivered'], []);
    },
  };
}
