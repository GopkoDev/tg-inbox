import { AlreadyAMemberError, LastActiveOwnerError } from './errors.js';
import type { MembershipState, Role } from './membership.js';

export interface TeamMember {
  id: string;
  role: Role;
  state: MembershipState;
}

/** Throws when deactivating `targetId` would leave the team with no active business owner. */
export function assertKeepsActiveOwner(members: readonly TeamMember[], targetId: string): void {
  const remaining = members.filter(
    (m) => m.id !== targetId && m.role === 'owner' && m.state === 'active',
  );
  if (remaining.length === 0) throw new LastActiveOwnerError();
}

/** An existing membership, active or deactivated, blocks a new invitation. */
export function assertNotAMember(
  existing: { id: string; state: MembershipState } | null | undefined,
): void {
  if (existing) throw new AlreadyAMemberError(existing.id, existing.state);
}
