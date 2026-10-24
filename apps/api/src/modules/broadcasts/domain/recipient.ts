// A recipient's outcome from the bots module's answer (ADR-0009; AC-11, AC-12, AC-13, AC-15).

export type RecipientState =
  'waiting' | 'sending' | 'delivered' | 'blocked' | 'failed' | 'not_confirmed' | 'stopped';

export type FailureReason =
  'account_gone' | 'chat_not_found' | 'telegram_error' | 'text_refused' | 'bot_stopped';

/** Why a broadcast was aborted: every waiting recipient fails with this reason. */
export type AbortReason = 'text_refused' | 'bot_stopped';

/** What `bots.sendBroadcastMessage` answers for one recipient. */
export type SendAnswer =
  | { kind: 'delivered'; messageId: bigint }
  | { kind: 'blocked' }
  | { kind: 'account_gone' }
  | { kind: 'chat_not_found' }
  | { kind: 'telegram_error' }
  | { kind: 'no_answer' }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'paused'; until: Date }
  | { kind: 'text_refused' }
  | { kind: 'bot_unavailable' }
  | { kind: 'bot_changed' };

export type RecordedOutcome =
  | { state: 'delivered'; telegramMessageId: bigint }
  | { state: 'blocked' }
  | { state: 'failed'; reason: 'account_gone' | 'chat_not_found' | 'telegram_error' }
  | { state: 'not_confirmed' };

/**
 * `record` — the recipient's outcome; `requeue` — nothing was sent, back to waiting (a rate limit
 * or the bot's send pause); `abort` — the whole broadcast ends with that reason.
 */
export type Outcome =
  | { record: RecordedOutcome }
  | { requeue: { retryAfterSeconds: number } | { until: Date } }
  | { abort: AbortReason };

export const outcomeOf = (answer: SendAnswer): Outcome => {
  switch (answer.kind) {
    case 'delivered':
      return { record: { state: 'delivered', telegramMessageId: answer.messageId } };
    case 'blocked':
      return { record: { state: 'blocked' } };
    case 'account_gone':
    case 'chat_not_found':
    case 'telegram_error':
      return { record: { state: 'failed', reason: answer.kind } };
    case 'no_answer':
      return { record: { state: 'not_confirmed' } };
    case 'rate_limited':
      return { requeue: { retryAfterSeconds: answer.retryAfterSeconds } };
    case 'paused':
      return { requeue: { until: answer.until } };
    case 'text_refused':
      return { abort: 'text_refused' };
    case 'bot_unavailable':
    case 'bot_changed':
      return { abort: 'bot_stopped' };
  }
};

/** Failures a new attempt can fix: copied by "only recipients it did not reach" (AC-13). */
export const FIXABLE_REASONS: readonly FailureReason[] = [
  'bot_stopped',
  'text_refused',
  'telegram_error',
];

/** The recipient rows "only recipients it did not reach" copies. */
export const notReachedStates = (
  includeNotConfirmed: boolean,
): { states: RecipientState[]; failedReasons: readonly FailureReason[] } => ({
  states: includeNotConfirmed ? ['stopped', 'not_confirmed'] : ['stopped'],
  failedReasons: FIXABLE_REASONS,
});

export const isNotReached = (
  r: { state: RecipientState; failureReason: FailureReason | null },
  includeNotConfirmed: boolean,
): boolean => {
  const { states, failedReasons } = notReachedStates(includeNotConfirmed);
  if (r.state === 'failed')
    return r.failureReason !== null && failedReasons.includes(r.failureReason);
  return states.includes(r.state);
};
