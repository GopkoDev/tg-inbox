import { hashToken } from '../../../platform/tokens.js';

export { hashToken };

/** A connect link lives 10 minutes (AC-05). */
export const CONNECT_LINK_TTL_MS = 10 * 60_000;
/** At most 5 links per member per workspace in this window (AC-13). */
export const CONNECT_LINK_WINDOW_MS = 10 * 60_000;
export const CONNECT_LINK_LIMIT = 5;

const PAYLOAD_PREFIX = 'tgi_';
const START = /^\/start(?:@\w+)? tgi_([A-Za-z0-9_-]{43})$/;

/** 32 random bytes as 43 base64url characters. `random` comes from the caller's entropy source. */
export function newConnectToken(random: Uint8Array): string {
  if (random.length !== 32) throw new Error('a connect token is 32 bytes');
  return Buffer.from(random).toString('base64url');
}

/** The start payload (47 characters, within Telegram's 64): `tgi_<token>`. */
export function startPayload(token: string): string {
  return `${PAYLOAD_PREFIX}${token}`;
}

/** The token of `/start tgi_<43>`; null for anything else, a campaign payload included. */
export function parseStartPayload(text: string): string | null {
  return START.exec(text.trim())?.[1] ?? null;
}

export interface ConnectLinkState {
  usedAt: Date | null;
  replacedAt: Date | null;
  expiresAt: Date;
}

/** Unused, not replaced and not yet expired. */
export function isUsable(link: ConnectLinkState, now: Date): boolean {
  return (
    link.usedAt === null && link.replacedAt === null && link.expiresAt.getTime() > now.getTime()
  );
}

export type LimitDecision =
  { allowed: true } | { allowed: false; retryAt: Date; retryAfterSeconds: number };

/**
 * 5 links per 10 minutes. `createdAts` are the member's links; those older than the window do not count.
 * When refused, `retryAt` is when enough counted links have left the window for a new one to fit.
 */
export function limitDecision(createdAts: readonly Date[], now: Date): LimitDecision {
  const from = now.getTime() - CONNECT_LINK_WINDOW_MS;
  const counted = createdAts
    .map((d) => d.getTime())
    .filter((t) => t > from)
    .sort((a, b) => a - b);
  if (counted.length < CONNECT_LINK_LIMIT) return { allowed: true };
  const freeing = counted[counted.length - CONNECT_LINK_LIMIT] as number;
  const retryAt = new Date(freeing + CONNECT_LINK_WINDOW_MS);
  return {
    allowed: false,
    retryAt,
    retryAfterSeconds: Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000)),
  };
}
