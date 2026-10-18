import { AssigneeLens, StatusLens, type ConversationStatus, type MemberRef } from '@tg/shared';

/** The two inbox lenses; they live in the page address (`?status=closed&assignee=mine`). */
export interface InboxLens {
  status: StatusLens;
  assignee: AssigneeLens;
}

export const DEFAULT_LENS: InboxLens = { status: 'open', assignee: 'all' };

export const sameLens = (a: InboxLens, b: InboxLens) =>
  a.status === b.status && a.assignee === b.assignee;

/**
 * Reads the lenses from the address. An unknown value is the default; `canonical` is false when
 * the address must be rewritten in place (an unknown value, or a default spelled out).
 */
export function parseLens(params: URLSearchParams): { lens: InboxLens; canonical: boolean } {
  const status = StatusLens.safeParse(params.get('status'));
  const assignee = AssigneeLens.safeParse(params.get('assignee'));
  const lens: InboxLens = {
    status: status.success ? status.data : DEFAULT_LENS.status,
    assignee: assignee.success ? assignee.data : DEFAULT_LENS.assignee,
  };
  const written = withLens(params, lens);
  return {
    lens,
    canonical:
      written.get('status') === params.get('status') &&
      written.get('assignee') === params.get('assignee'),
  };
}

/** The address parameters for `lens`: defaults omitted, other parameters kept. */
export function withLens(params: URLSearchParams, lens: InboxLens): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('status');
  next.delete('assignee');
  if (lens.status !== DEFAULT_LENS.status) next.set('status', lens.status);
  if (lens.assignee !== DEFAULT_LENS.assignee) next.set('assignee', lens.assignee);
  return next;
}

/**
 * Whether a row belongs in the list of `lens` for the signed-in account. While searching, the
 * status lens is set aside (matches of both statuses) and only the assignee lens counts.
 */
export function belongsToLens(
  row: { status: ConversationStatus; assignee: MemberRef | null },
  lens: InboxLens,
  accountId: string | null,
  searching: boolean,
): boolean {
  if (!searching && row.status !== lens.status) return false;
  switch (lens.assignee) {
    case 'all':
      return true;
    case 'unassigned':
      return row.assignee === null;
    case 'mine':
      return accountId !== null && row.assignee?.account_id === accountId;
  }
}
