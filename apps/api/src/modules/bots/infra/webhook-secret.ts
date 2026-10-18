import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookSecrets } from '../app/ports.js';

/**
 * Per-bot webhook secrets (ADR-0002). Only the SHA-256 hash is stored, yet rotation and reconnect
 * after a takeover must register the *same* secret again with setWebhook. So the secret is
 * derived, not drawn: HMAC-SHA256(server key, bot row id ‖ capture epoch), base64url — 32
 * unpredictable bytes in Telegram's allowed alphabet `[A-Za-z0-9_-]`. It stays the same while
 * the capture epoch does (rotation, reconnect) and changes when a disconnected bot is connected
 * again (a new epoch), as ADR-0002 requires.
 */
export function createWebhookSecrets(serverKey: Buffer): WebhookSecrets {
  return {
    secretFor(botId, connectedAt) {
      return createHmac('sha256', serverKey)
        .update(`tg-inbox webhook secret\0${botId}\0${connectedAt.getTime()}`)
        .digest('base64url');
    },
  };
}

export function hashSecret(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** Constant-time comparison of a presented secret with the stored hash. */
export function secretMatches(secret: string | undefined, hash: Buffer | null): boolean {
  if (!secret || !hash || hash.length !== 32) return false;
  return timingSafeEqual(hashSecret(secret), hash);
}
