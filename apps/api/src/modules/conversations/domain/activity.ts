export type ActivityKind = 'assigned' | 'reassigned' | 'unassigned' | 'closed' | 'reopened';
export type ActivityCause =
  'member' | 'customer_wrote' | 'reply_not_delivered' | 'member_deactivated';

/** Recorded changes allowed per member per workspace in any rolling window (AC-12). */
export const CHANGE_LIMIT = 60;
export const CHANGE_WINDOW_MS = 60_000;

/** The assignment kind for an assignee move; null when nothing moved. */
export function activityKindFor(
  previous: string | null,
  next: string | null,
): 'assigned' | 'reassigned' | 'unassigned' | null {
  if (previous === next) return null;
  if (previous === null) return 'assigned';
  if (next === null) return 'unassigned';
  return 'reassigned';
}

/** Automatic causes are allowed only on these kinds; `member` fits every kind. */
const AUTOMATIC_KINDS: Record<Exclude<ActivityCause, 'member'>, ActivityKind> = {
  customer_wrote: 'reopened',
  reply_not_delivered: 'reopened',
  member_deactivated: 'unassigned',
};

export interface ActivityShape {
  kind: ActivityKind;
  cause: ActivityCause;
  actor: string | null;
  previous: string | null;
  next: string | null;
}

/** Mirrors the data-model CHECKs: kind <-> cause, actor <-> cause, assignee pair per kind. */
export function isValidActivity(a: ActivityShape): boolean {
  if ((a.cause === 'member') !== (a.actor !== null)) return false;
  if (a.cause !== 'member' && AUTOMATIC_KINDS[a.cause] !== a.kind) return false;
  switch (a.kind) {
    case 'assigned':
      return a.previous === null && a.next !== null;
    case 'reassigned':
      return a.previous !== null && a.next !== null && a.previous !== a.next;
    case 'unassigned':
      return a.previous !== null && a.next === null;
    case 'closed':
    case 'reopened':
      return a.previous === null && a.next === null;
  }
}

/** The position time: the clock, never earlier than the conversation's latest entry. */
export function positionAt(now: Date, latestPositionAt: Date | null): Date {
  return latestPositionAt && latestPositionAt.getTime() > now.getTime() ? latestPositionAt : now;
}

export function limitReached(countedChanges: number): boolean {
  return countedChanges >= CHANGE_LIMIT;
}

/** When the oldest counted change leaves the window, i.e. when the member can continue. */
export function changeRetryAt(oldestCreatedAt: Date): Date {
  return new Date(oldestCreatedAt.getTime() + CHANGE_WINDOW_MS);
}
