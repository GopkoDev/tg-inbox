import { createHash, randomBytes } from 'node:crypto';

/** SHA-256 of a link token; only this hash is ever stored. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/** 32 random bytes as base64url (43 chars) plus the hash to persist. */
export function issueLinkToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
