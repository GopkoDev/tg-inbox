/**
 * The waiting period of a conversation (ADR-0007, AC-07, AC-08): the stretch in which a customer
 * is waiting for a reply. It starts at the arrival of a customer message ('message') or, when a
 * reopen finds the customer still waiting, at the reopen ('reopen'). A reply marked sent and a
 * close end it; an assignee change never touches it. `null` is "not waiting".
 */
export type WaitingStartedBy = 'message' | 'reopen';

export interface WaitingPeriod {
  since: Date;
  startedBy: WaitingStartedBy;
}

/** A customer message arrived at `arrival`: a running period stays, otherwise a message period starts. */
export function startOnMessage(current: WaitingPeriod | null, arrival: Date): WaitingPeriod {
  return current ?? { since: arrival, startedBy: 'message' };
}

/** A close ends the period in the same write. */
export function endOnClose(): null {
  return null;
}

/** A reopen at `now`: a period starts only when the customer is still waiting for a reply. */
export function restartOnReopen(waitingNow: boolean, now: Date): WaitingPeriod | null {
  return waitingNow ? { since: now, startedBy: 'reopen' } : null;
}
