export type Role = 'owner' | 'operator';
export type MembershipState = 'active' | 'deactivated';

export interface Membership {
  id: string;
  role: Role;
  state: MembershipState;
  deactivatedAt: Date | null;
}

/** Idempotent: an already-deactivated membership is returned unchanged. */
export function deactivate(m: Membership, now: Date): Membership {
  if (m.state === 'deactivated') return m;
  return { ...m, state: 'deactivated', deactivatedAt: now };
}

/** Idempotent; the role is kept (AC-19). */
export function reactivate(m: Membership): Membership {
  if (m.state === 'active') return m;
  return { ...m, state: 'active', deactivatedAt: null };
}
