import type { Clock } from '../../../platform/clock.js';
import { LINK_MS, MAX_IN_FLIGHT, nextTurn } from '../domain/sending.js';
import {
  outcomeOf,
  type AbortReason,
  type RecordedOutcome,
  type SendAnswer,
} from '../domain/recipient.js';
import type {
  BroadcastJobs,
  BroadcastLogger,
  BroadcastRecord,
  BroadcastRepo,
  BroadcastSendOutcome,
  BroadcastSender,
  ContactsApi,
  ConversationsApi,
  RecipientRecord,
  RecipientRepo,
  ReportSignals,
  Transaction,
} from './ports.js';
import type { Settle } from './settle.js';

export interface SendLinkDeps {
  transaction: Transaction;
  broadcasts: Pick<BroadcastRepo, 'sendingBroadcasts' | 'lockForUpdate'>;
  recipients: Pick<
    RecipientRepo,
    | 'resolveStaleInFlight'
    | 'nextWaiting'
    | 'claim'
    | 'recordOutcome'
    | 'backToWaiting'
    | 'settleWaiting'
  >;
  contacts: Pick<ContactsApi, 'isBlocked'>;
  bots: BroadcastSender;
  conversations: ConversationsApi;
  settle: Pick<Settle, 'endInTx' | 'finishIfDone' | 'logEnded'>;
  reports: ReportSignals;
  jobs: Pick<BroadcastJobs, 'enqueueSendLink'>;
  clock: Clock;
  /** Waits `ms` (the link's last report flush); tests pass a fake. */
  sleep?: (ms: number) => Promise<void>;
  logger?: BroadcastLogger;
}

/** What one link did, for its `broadcast.link` log line and the tests. */
export interface LinkSummary {
  staleResolved: number;
  claimed: number;
  outcomes: Partial<Record<RecordedOutcome['state'] | 'requeued' | 'aborted', number>>;
  /** The successor's start: null when nothing sends any more (no successor). */
  successor: { startAfter: Date | null } | null;
}

export interface SendLink {
  /**
   * One link of the workspace's sending chain (ADR-0007, ADR-0008, sad.md §6 flows 12–14). The
   * caller is the `broadcasts.send` job of `workspaceId`: only one runs per workspace.
   */
  runSendLink(workspaceId: string): Promise<LinkSummary>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The bots answer in the domain's terms: a 429 and the stored pause both wait until a time. */
function toAnswer(o: BroadcastSendOutcome): SendAnswer {
  switch (o.outcome) {
    case 'delivered':
      return { kind: 'delivered', messageId: o.messageId };
    case 'not_confirmed':
      return { kind: 'no_answer' };
    case 'rate_limited':
      return { kind: 'paused', until: o.retryAfter };
    case 'paused':
      return { kind: 'paused', until: o.until };
    default:
      return { kind: o.outcome };
  }
}

export function createSendLink(deps: SendLinkDeps): SendLink {
  const { transaction, broadcasts, recipients, contacts, bots, conversations } = deps;
  const { settle, reports, jobs, clock, logger } = deps;
  const sleep = deps.sleep ?? defaultSleep;

  return {
    async runSendLink(workspaceId) {
      const deadline = clock.now().getTime() + LINK_MS;
      const summary: LinkSummary = { staleResolved: 0, claimed: 0, outcomes: {}, successor: null };
      const count = (k: keyof LinkSummary['outcomes']) => {
        summary.outcomes[k] = (summary.outcomes[k] ?? 0) + 1;
      };

      const sending = await broadcasts.sendingBroadcasts(workspaceId);
      const byId = new Map(sending.map((b) => [b.id, b]));
      const order = sending.map((b) => b.id);

      // Only one link runs per workspace, so a recipient still `sending` was left by a dead link:
      // not confirmed, with its item at its claim time (AC-11, AC-16).
      if (order.length > 0) {
        summary.staleResolved = await transaction(async (tx) => {
          const stale = await recipients.resolveStaleInFlight(workspaceId, order, clock.now(), tx);
          for (const s of stale) {
            await conversations.recordBroadcastItem(tx, {
              workspaceId,
              contactId: s.contactId,
              broadcastId: s.broadcastId,
              state: 'not_confirmed',
              positionAt: s.claimedAt,
              telegramMessageId: null,
            });
          }
          for (const id of new Set(stale.map((s) => s.broadcastId))) {
            await reports.report(tx, workspaceId, id);
          }
          return stale.length;
        });
      }

      const done = new Set<string>();
      /** The latest send pause seen: the link stops claiming and its successor waits for it. */
      const pause: { until: Date | null } = { until: null };
      const inFlight = new Set<Promise<void>>();
      /** The first error of a turn: claiming stops, and the link fails after its sends settle. */
      const failures: unknown[] = [];

      /** The answer → outcome (ADR-0009), each in its own transaction. */
      async function settleTurn(b: BroadcastRecord, r: RecipientRecord, claimedAt: Date) {
        const answer = await bots.sendBroadcastMessage({
          workspaceId,
          telegramBotId: b.launchTelegramBotId!,
          chatId: r.telegramUserId,
          text: b.text,
        });
        const outcome = outcomeOf(toAnswer(answer));
        if ('record' in outcome) {
          const at = answer.outcome === 'delivered' ? answer.at : clock.now();
          await record(b.id, r, outcome.record, at, claimedAt);
          count(outcome.record.state);
        } else if ('requeue' in outcome) {
          // Nothing was sent: back to waiting, and the link stops at the pause (AC-15).
          await recipients.backToWaiting(workspaceId, r.id);
          const until =
            'until' in outcome.requeue
              ? outcome.requeue.until
              : new Date(clock.now().getTime() + outcome.requeue.retryAfterSeconds * 1000);
          if (pause.until === null || until > pause.until) pause.until = until;
          count('requeued');
        } else {
          done.add(b.id);
          await abort(b.id, r, outcome.abort);
          count('aborted');
        }
      }

      async function record(
        broadcastId: string,
        r: RecipientRecord,
        o: RecordedOutcome,
        at: Date,
        claimedAt: Date | null,
      ) {
        await transaction(async (tx) => {
          const written = await recipients.recordOutcome(workspaceId, r.id, o, at, tx);
          if (!written) return;
          if (o.state === 'delivered' || o.state === 'not_confirmed') {
            await conversations.recordBroadcastItem(tx, {
              workspaceId,
              contactId: r.contactId,
              broadcastId,
              state: o.state,
              positionAt: o.state === 'delivered' ? at : (claimedAt ?? at),
              telegramMessageId: o.state === 'delivered' ? o.telegramMessageId : null,
            });
          }
          await reports.report(tx, workspaceId, broadcastId);
          await reports.flush(tx, workspaceId);
        });
      }

      /**
       * A refused text or a lost bot (AC-12). Nothing was sent to `r`, so it goes back to waiting
       * and the settling transaction fails it with the others — under the row lock, so a
       * broadcast ended meanwhile still settles it.
       */
      async function abort(broadcastId: string, r: RecipientRecord, reason: AbortReason) {
        const ended = await transaction(async (tx) => {
          const row = await broadcasts.lockForUpdate(workspaceId, broadcastId, tx);
          if (row === null) return null;
          await recipients.backToWaiting(workspaceId, r.id, tx);
          if (await settle.endInTx(tx, row, { kind: 'abort', reason })) return row;
          await recipients.settleWaiting(
            workspaceId,
            broadcastId,
            { state: 'failed', reason },
            clock.now(),
            tx,
          );
          return null;
        });
        if (ended !== null) await settle.logEnded(ended, reason);
      }

      /** The next sending broadcast after `last` that still has waiting recipients. */
      const pickTurn = (last: string | null): string | null => {
        let cur = last;
        for (let i = 0; i < order.length; i += 1) {
          const next = nextTurn(order, cur);
          if (next === null) return null;
          if (!done.has(next)) return next;
          cur = next;
        }
        return null;
      };

      // Turns: the lowest waiting position of each sending broadcast, oldest launch first (AC-15).
      let lastServed: string | null = null;
      while (failures.length === 0 && pause.until === null && clock.now().getTime() < deadline) {
        if (inFlight.size >= MAX_IN_FLIGHT) {
          await Promise.race(inFlight);
          continue;
        }
        const id = pickTurn(lastServed);
        if (id === null) break;
        lastServed = id;
        const b = byId.get(id)!;
        const r = await recipients.nextWaiting(workspaceId, id);
        if (r === null) {
          done.add(id);
          continue;
        }
        // The block mark at the turn decides (AC-11, AC-14).
        if (await contacts.isBlocked(workspaceId, r.contactId, b.launchTelegramBotId!)) {
          await record(id, r, { state: 'blocked' }, clock.now(), null);
          count('blocked');
          continue;
        }
        const claimedAt = clock.now();
        // Committed before the send: a recipient is never sent twice (ADR-0007).
        if (!(await recipients.claim(workspaceId, r.id, claimedAt))) continue;
        summary.claimed += 1;
        const p: Promise<void> = settleTurn(b, r, claimedAt)
          .catch((error: unknown) => {
            failures.push(error);
          })
          .finally(() => inFlight.delete(p));
        inFlight.add(p);
      }
      await Promise.all(inFlight);
      // A failed turn leaves its recipient `sending`; the retried link resolves it (ADR-0007).
      if (failures.length > 0) throw failures[0];

      for (const id of order) await settle.finishIfDone(workspaceId, id);

      const still = await broadcasts.sendingBroadcasts(workspaceId);
      const owed = reports.msUntilDue(workspaceId, clock.now());
      if (owed > 0) await sleep(owed);
      const startAfter = pause.until !== null && pause.until > clock.now() ? pause.until : null;
      await transaction(async (tx) => {
        await reports.flush(tx, workspaceId);
        if (still.length > 0) await jobs.enqueueSendLink(tx, workspaceId, startAfter ?? undefined);
      });
      summary.successor = still.length > 0 ? { startAfter } : null;
      logger?.info(
        {
          workspace_id: workspaceId,
          sending: order.length,
          stale_resolved: summary.staleResolved,
          claimed: summary.claimed,
          outcomes: summary.outcomes,
          successor: summary.successor !== null,
          paused_until: startAfter?.toISOString() ?? null,
        },
        'broadcast.link',
      );
      return summary;
    },
  };
}
