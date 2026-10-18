import { DEFAULT_BACKOFF_MS, RETRY_WINDOW_MS } from './rules.js';

export type GatewayOutcome =
  | { outcome: 'accepted'; messageId: bigint; at: Date }
  | { outcome: 'refused'; reason: 'blocked' | 'account_gone' | 'chat_not_found' }
  | { outcome: 'bot_unauthorized' }
  | { outcome: 'not_accepted'; retryAfterMs?: number }
  | { outcome: 'unknown' };

export type AttemptOutcome = GatewayOutcome['outcome'];
export type ReplyState = 'sending' | 'sent' | 'not_delivered' | 'not_confirmed';
export type FailureReason =
  | 'customer_blocked'
  | 'customer_account_gone'
  | 'chat_not_found'
  | 'bot_not_working'
  | 'telegram_not_accepted';

export interface OutcomeDecision {
  attemptOutcome: AttemptOutcome;
  replyState: ReplyState;
  failureReason?: FailureReason;
  drainContinues: boolean;
  retryAfterMs?: number;
}

const REFUSED_REASON = {
  blocked: 'customer_blocked',
  account_gone: 'customer_account_gone',
  chat_not_found: 'chat_not_found',
} as const;

export function decideOutcome(o: GatewayOutcome, positionAt: Date, now: Date): OutcomeDecision {
  switch (o.outcome) {
    case 'accepted':
      return { attemptOutcome: 'accepted', replyState: 'sent', drainContinues: true };
    case 'refused':
      return {
        attemptOutcome: 'refused',
        replyState: 'not_delivered',
        failureReason: REFUSED_REASON[o.reason],
        drainContinues: true,
      };
    case 'bot_unauthorized':
      return {
        attemptOutcome: 'bot_unauthorized',
        replyState: 'not_delivered',
        failureReason: 'bot_not_working',
        drainContinues: true,
      };
    case 'not_accepted':
      // Retried only when the next try (after the back-off, in whole seconds like the delayed job)
      // still lands inside the 5-minute window; otherwise it is final now (AC-12).
      if (nextTryAt(o.retryAfterMs, now) - positionAt.getTime() <= RETRY_WINDOW_MS) {
        const d: OutcomeDecision = {
          attemptOutcome: 'not_accepted',
          replyState: 'sending',
          drainContinues: false,
        };
        if (o.retryAfterMs !== undefined) d.retryAfterMs = o.retryAfterMs;
        return d;
      }
      return {
        attemptOutcome: 'not_accepted',
        replyState: 'not_delivered',
        failureReason: 'telegram_not_accepted',
        drainContinues: true,
      };
    case 'unknown':
      return { attemptOutcome: 'unknown', replyState: 'not_confirmed', drainContinues: true };
  }
}

/** Whole seconds of back-off before the next try, as the delayed drain job is scheduled. */
export function backoffSeconds(retryAfterMs: number | undefined): number {
  return Math.max(1, Math.ceil((retryAfterMs ?? DEFAULT_BACKOFF_MS) / 1000));
}

function nextTryAt(retryAfterMs: number | undefined, now: Date): number {
  return now.getTime() + backoffSeconds(retryAfterMs) * 1000;
}

/** A reply refused earlier whose window has closed is final before another try (AC-12). */
export function retryWindowClosed(positionAt: Date, now: Date): boolean {
  return now.getTime() - positionAt.getTime() > RETRY_WINDOW_MS;
}
