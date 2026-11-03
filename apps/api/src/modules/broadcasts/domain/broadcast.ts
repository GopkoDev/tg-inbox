// A broadcast's life and who may act on it (sad.md §5 domain; AC-03, AC-07, AC-09, AC-18).

export const BROADCAST_STATUSES = ['draft', 'sending', 'sent', 'stopped'] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

export type MemberRole = 'owner' | 'operator';

/** draft → sending (launch) → sent (every recipient has an outcome) | stopped (an owner's stop). */
const MOVES: Readonly<Record<BroadcastStatus, readonly BroadcastStatus[]>> = {
  draft: ['sending'],
  sending: ['sent', 'stopped'],
  sent: [],
  stopped: [],
};

export const canMove = (from: BroadcastStatus, to: BroadcastStatus): boolean =>
  MOVES[from].includes(to);

/** Only a draft's name, text and audience can change; a launched broadcast is read-only. */
export const isEditable = (status: BroadcastStatus): boolean => status === 'draft';

/** A draft is deleted by its author or a business owner. */
export const canDelete = (o: { role: MemberRole; accountId: string; authorId: string }): boolean =>
  o.role === 'owner' || o.accountId === o.authorId;

/** Only a business owner launches. */
export const canLaunch = (role: MemberRole): boolean => role === 'owner';

/** Only a business owner stops. */
export const canStop = (role: MemberRole): boolean => role === 'owner';

/**
 * One change of a draft. Name, text, audience kind and a tag audience's tags are versioned; group
 * adds and removes are commutative row writes outside the version (ADR-0005).
 */
export type DraftChange = 'name' | 'text' | 'kind' | 'tags' | 'group_add' | 'group_remove';

const VERSIONED: ReadonlySet<DraftChange> = new Set(['name', 'text', 'kind', 'tags']);

/** The version after a save: raised by one when any versioned field changed. */
export const nextVersion = (version: number, changes: readonly DraftChange[]): number =>
  changes.some((c) => VERSIONED.has(c)) ? version + 1 : version;

/** A save made against another version than the current one is refused (AC-03). */
export const isStaleVersion = (o: { expected: number; current: number }): boolean =>
  o.expected !== o.current;
