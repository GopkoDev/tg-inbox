import { describe, expect, it } from 'vitest';
import { hashToken, issueLinkToken } from './tokens.js';

describe('link tokens', () => {
  it('issues a 43-char base64url token and its 32-byte sha-256 hash', () => {
    const { token, hash } = issueLinkToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBeInstanceOf(Buffer);
    expect(hash).toHaveLength(32);
    expect(hashToken(token).equals(hash)).toBe(true);
  });

  it('issues distinct tokens', () => {
    expect(issueLinkToken().token).not.toBe(issueLinkToken().token);
  });
});
