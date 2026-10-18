import type { Membership, PendingInvitation } from '@tg/shared';

export interface TeamFilter {
  query: string;
  role: 'all' | 'owner' | 'operator';
  state: 'all' | 'active' | 'deactivated';
}

export const NO_FILTER: TeamFilter = { query: '', role: 'all', state: 'all' };

export interface TeamRows {
  members: Membership[];
  invitations: PendingInvitation[];
}

/** Narrows the loaded rows: query + role apply to both lists, state to members only. */
export function filterTeam({ members, invitations }: TeamRows, filter: TeamFilter): TeamRows {
  const q = filter.query.trim().toLowerCase();
  const has = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));
  const roleOk = (role: string) => filter.role === 'all' || role === filter.role;
  return {
    members: members.filter(
      (m) =>
        has(m.display_name, m.email) &&
        roleOk(m.role) &&
        (filter.state === 'all' || m.state === filter.state),
    ),
    invitations: invitations.filter((i) => has(i.email) && roleOk(i.role)),
  };
}
