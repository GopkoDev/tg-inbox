import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { BotTokenEncryptionKey } from '../../../platform/config.js';
import type { TokenCipher } from '../app/ports.js';

const KEY_ID_BYTES = 4;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** A stored token that cannot be decrypted. Its message never carries the token or the blob. */
export class TokenDecryptError extends Error {
  constructor(reason: 'unknown_key' | 'malformed' | 'authentication_failed') {
    super(`bot token could not be decrypted (${reason})`);
    this.name = 'TokenDecryptError';
  }
}

/**
 * AES-256-GCM for bot tokens at rest (ADR-0006): `keyId(4) ‖ nonce(12) ‖ ciphertext ‖ tag(16)`.
 * The key-id prefix lets a later key rotation find and re-encrypt old tokens.
 */
export function createTokenCipher({ id, key }: BotTokenEncryptionKey): TokenCipher {
  if (!/^[0-9a-f]{8}$/.test(id) || key.length !== 32) {
    throw new Error('the bot token encryption key needs a 4-byte hex id and 32 bytes');
  }
  const keyId = Buffer.from(id, 'hex');

  return {
    encrypt(token) {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
      return Buffer.concat([keyId, nonce, ciphertext, cipher.getAuthTag()]);
    },

    decrypt(blob) {
      if (blob.length <= KEY_ID_BYTES + NONCE_BYTES + TAG_BYTES) {
        throw new TokenDecryptError('malformed');
      }
      if (!blob.subarray(0, KEY_ID_BYTES).equals(keyId)) throw new TokenDecryptError('unknown_key');
      const nonce = blob.subarray(KEY_ID_BYTES, KEY_ID_BYTES + NONCE_BYTES);
      const ciphertext = blob.subarray(KEY_ID_BYTES + NONCE_BYTES, blob.length - TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAuthTag(blob.subarray(blob.length - TAG_BYTES));
      try {
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch {
        throw new TokenDecryptError('authentication_failed');
      }
    },
  };
}
