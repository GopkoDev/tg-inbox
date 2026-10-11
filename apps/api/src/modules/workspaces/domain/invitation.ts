export const INVITATION_TTL = 7 * 86_400_000;

export interface Invitation {
  state: 'pending' | 'accepted' | 'revoked' | 'superseded';
  expiresAt: Date;
}

export function invitationIsUsable(inv: Invitation, now: Date): boolean {
  return inv.state === 'pending' && inv.expiresAt.getTime() > now.getTime();
}

/** Who to point a person at when their invitation is no longer valid (AC-06). */
export function askFor(workspaceHasMembers: boolean): 'tg_inbox_team' | 'business_owner' {
  return workspaceHasMembers ? 'business_owner' : 'tg_inbox_team';
}
