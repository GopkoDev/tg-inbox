import { describe, expect, it } from 'vitest';
import { botTokenEncryptionKey } from '../../../platform/config.js';
import { createTokenCipher, TokenDecryptError } from './token-cipher.js';

const key = botTokenEncryptionKey(Buffer.alloc(32, 0x11));
const otherKey = botTokenEncryptionKey(Buffer.alloc(32, 0x22));
const TOKEN = '100001:TEST-fake-token-not-real-aaaaaaaaaaaaaaaaaa';

describe('token cipher (ADR-0006)', () => {
  const cipher = createTokenCipher(key);

  it('round-trips a token', () => {
    expect(cipher.decrypt(cipher.encrypt(TOKEN))).toBe(TOKEN);
  });

  it('lays out key id ‖ nonce(12) ‖ ciphertext ‖ tag(16) and never contains the token', () => {
    const blob = cipher.encrypt(TOKEN);
    expect(blob.subarray(0, 4).toString('hex')).toBe(key.id);
    expect(blob.length).toBe(4 + 12 + Buffer.byteLength(TOKEN) + 16);
    expect(blob.length).toBeGreaterThan(28);
    expect(blob.includes(Buffer.from(TOKEN))).toBe(false);
    expect(blob.includes(Buffer.from('TEST-fake'))).toBe(false);
  });

  it('uses a fresh nonce per encryption', () => {
    expect(cipher.encrypt(TOKEN).equals(cipher.encrypt(TOKEN))).toBe(false);
  });

  it.each([
    ['a wrong key id', () => createTokenCipher(otherKey).encrypt(TOKEN)],
    [
      'a tampered tag',
      () => {
        const blob = cipher.encrypt(TOKEN);
        blob[blob.length - 1]! ^= 0xff;
        return blob;
      },
    ],
    [
      'a tampered ciphertext',
      () => {
        const blob = cipher.encrypt(TOKEN);
        blob[20]! ^= 0x01;
        return blob;
      },
    ],
    ['a truncated blob', () => cipher.encrypt(TOKEN).subarray(0, 20)],
  ])('refuses %s with a typed error that carries no token', (_name, make) => {
    let error: unknown;
    try {
      cipher.decrypt(make());
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(TokenDecryptError);
    expect(String((error as Error).message)).not.toContain(TOKEN);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });

  it('rejects a key whose id is not 4 bytes of hex', () => {
    expect(() => createTokenCipher({ id: 'nothex!!', key: Buffer.alloc(32) })).toThrow();
  });
});
