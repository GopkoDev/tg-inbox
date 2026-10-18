import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createWebhookSecrets, hashSecret, secretMatches } from './webhook-secret.js';

const secrets = createWebhookSecrets(Buffer.alloc(32, 0x33));
const BOT = '0199e000-0000-7000-8000-000000000001';
const EPOCH = new Date('2026-10-11T10:00:00.123Z');

describe('webhook secrets (ADR-0002)', () => {
  it('derives a 32-byte secret in Telegram’s allowed alphabet', () => {
    const secret = secrets.secretFor(BOT, EPOCH);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
  });

  it('keeps the secret for the same bot and capture epoch (rotation, reconnect)', () => {
    expect(secrets.secretFor(BOT, new Date(EPOCH))).toBe(secrets.secretFor(BOT, EPOCH));
  });

  it('changes the secret with a new capture epoch (connect again) or another bot', () => {
    const base = secrets.secretFor(BOT, EPOCH);
    expect(secrets.secretFor(BOT, new Date(EPOCH.getTime() + 1))).not.toBe(base);
    expect(secrets.secretFor('0199e000-0000-7000-8000-000000000002', EPOCH)).not.toBe(base);
    expect(createWebhookSecrets(Buffer.alloc(32, 0x34)).secretFor(BOT, EPOCH)).not.toBe(base);
  });

  it('hashes with SHA-256 to 32 bytes', () => {
    const secret = secrets.secretFor(BOT, EPOCH);
    expect(hashSecret(secret)).toEqual(createHash('sha256').update(secret).digest());
    expect(hashSecret(secret)).toHaveLength(32);
  });

  it('matches only the right secret, and never a missing hash or secret', () => {
    const secret = secrets.secretFor(BOT, EPOCH);
    const hash = hashSecret(secret);
    expect(secretMatches(secret, hash)).toBe(true);
    expect(secretMatches(`${secret}x`, hash)).toBe(false);
    expect(secretMatches('', hash)).toBe(false);
    expect(secretMatches(undefined, hash)).toBe(false);
    expect(secretMatches(secret, null)).toBe(false);
  });
});
