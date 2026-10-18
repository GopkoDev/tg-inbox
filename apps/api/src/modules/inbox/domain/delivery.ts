import { RETRY_WINDOW_MS } from './rules.js';

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
      if (now.getTime() - positionAt.getTime() <= RETRY_WINDOW_MS) {
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
