import type { Clock } from '../../../platform/clock.js';
import type { ReplyDelivery } from '../../conversations/app/replies.js';
import {
  backoffSeconds,
  decideOutcome,
  retryWindowClosed,
  type GatewayOutcome,
} from '../domain/delivery.js';
import { CHAT_PACE_MS, DRAIN_BUDGET_MS, SEND_TIMEOUT_MS } from '../domain/rules.js';

export interface DeliverDeps {
  delivery: ReplyDelivery;
  workspaces: {
    activeMembersAmong(workspaceId: string, ids: readonly string[]): Promise<string[]>;
  };
  bots: {
    canCarryReplies(workspaceId: string): Promise<boolean>;
    sendText(request: {
      workspaceId: string;
      chatId: bigint;
      text: string;
    }): Promise<GatewayOutcome>;
  };
  /** A new delayed drain job for the conversation (never a pg-boss retry). */
  enqueueDelayed(
    workspaceId: string,
    conversationId: string,
    startAfterSeconds: number,
  ): Promise<void>;
  sleep(ms: number): Promise<void>;
  clock: Clock;
}

/**
 * The drain of one conversation (flow 9, ADR-0004): replies go out one at a time, oldest first. An
 * attempt is committed as started before Telegram is called, and a reply whose attempt started and
 * did not finish is never sent again (it ends `not_confirmed`).
 *
 * A run starts attempts for at most `DRAIN_BUDGET_MS`, then hands the rest to a follow-up drain, so
 * it ends (even after a 10 s send) before its job expires at 60 s and pg-boss starts a second run.
 * Once `signal` is aborted (the job expired or the worker stops) no further attempt starts.
 */
export function createDeliver(deps: DeliverDeps) {
  const { delivery, workspaces, bots, enqueueDelayed, sleep, clock } = deps;

  return {
    async deliverConversation(input: {
      workspaceId: string;
      conversationId: string;
      signal?: AbortSignal;
    }) {
      const { workspaceId, conversationId, signal } = input;
      const startedAt = clock.now().getTime();

      await delivery.resolveStaleInFlight(
        workspaceId,
        conversationId,
        new Date(clock.now().getTime() - SEND_TIMEOUT_MS),
      );

      // An attempt younger than the threshold may still be running or may have reached Telegram.
      // Nothing is sent until it is old enough to be resolved as not confirmed (ADR-0004).
      const inFlightSince = await delivery.inFlightSince(workspaceId, conversationId);
      if (inFlightSince) {
        const remainingMs = inFlightSince.getTime() + SEND_TIMEOUT_MS - clock.now().getTime();
        await enqueueDelayed(
          workspaceId,
          conversationId,
          Math.max(1, Math.ceil((remainingMs + 1) / 1000)),
        );
        return;
      }

      const pending = await delivery.pendingReplies(workspaceId, conversationId);
      if (pending.length === 0) return;
      const chatId = await delivery.chatIdOf(workspaceId, conversationId);
      if (chatId === null) return;

      for (const reply of pending) {
        const skip = async (failureReason: string) => {
          await delivery.skipReply({
            workspaceId,
            conversationId,
            replyId: reply.id,
            failureReason,
          });
        };

        if (signal?.aborted) return;
        if (clock.now().getTime() - startedAt >= DRAIN_BUDGET_MS) {
          await enqueueDelayed(workspaceId, conversationId, 1);
          return;
        }

        if (
          retryWindowClosed(reply.positionAt, clock.now()) &&
          (await delivery.wasNotAccepted(workspaceId, conversationId, reply.id, reply.positionAt))
        ) {
          await skip('telegram_not_accepted');
          continue;
        }

        const active = await workspaces.activeMembersAmong(workspaceId, [reply.authorAccountId]);
        if (!active.includes(reply.authorAccountId)) {
          await skip('author_access_removed');
          continue;
        }
        if (!(await bots.canCarryReplies(workspaceId))) {
          await skip('bot_not_working');
          continue;
        }

        const last = await delivery.lastStartedAt(workspaceId, conversationId);
        if (last) {
          const wait = CHAT_PACE_MS - (clock.now().getTime() - last.getTime());
          if (wait > 0) await sleep(wait);
        }
        if (signal?.aborted) return;

        const started = await delivery.startAttempt({
          workspaceId,
          conversationId,
          replyId: reply.id,
        });
        if (!started) continue;

        let outcome: GatewayOutcome;
        try {
          outcome = await bots.sendText({ workspaceId, chatId, text: reply.body });
        } catch {
          // The call may have reached Telegram: the answer is unknown, never retried (AC-11).
          outcome = { outcome: 'unknown' };
        }

        const decision = decideOutcome(outcome, reply.positionAt, clock.now());
        await delivery.finishAttempt({
          workspaceId,
          conversationId,
          attemptId: started.attemptId,
          attemptOutcome: decision.attemptOutcome,
          replyState: decision.replyState,
          ...(decision.failureReason && { failureReason: decision.failureReason }),
          // Our clock, not Telegram's second-truncated date: the reply must sort after the customer
          // message it answers, or "waiting for a reply" stays set (data-model.md).
          ...(outcome.outcome === 'accepted' && {
            telegramMessageId: outcome.messageId,
            sentAt: clock.now(),
          }),
        });

        if (!decision.drainContinues) {
          await enqueueDelayed(workspaceId, conversationId, backoffSeconds(decision.retryAfterMs));
          return;
        }
      }
    },
  };
}

export type Deliver = ReturnType<typeof createDeliver>;
