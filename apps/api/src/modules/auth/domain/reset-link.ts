export const RESET_LINK_TTL = 24 * 3_600_000;

export interface ResetLink {
  state: 'pending' | 'used' | 'superseded';
  expiresAt: Date;
}

export function resetLinkIsUsable(link: ResetLink, now: Date): boolean {
  return link.state === 'pending' && link.expiresAt.getTime() > now.getTime();
}
