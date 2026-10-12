import { describe, expect, it } from 'vitest';
import { ErrorCode, ErrorEnvelope } from './errors.js';

describe('ErrorCode', () => {
  it('declares the 26 codes', () => {
    expect(Object.keys(ErrorCode)).toHaveLength(26);
    for (const c of [
      'UNSUPPORTED_MEDIA_TYPE',
      'PAYLOAD_TOO_LARGE',
      'UNAUTHENTICATED',
      'INVALID_CREDENTIALS',
      'ACCESS_REMOVED',
      'OWNER_ONLY',
      'INVITATION_FOR_ANOTHER_EMAIL',
      'INVITATION_INVALID',
      'RESET_LINK_INVALID',
      'ALREADY_A_MEMBER',
      'LAST_ACTIVE_OWNER',
      'OWNER_ALREADY_JOINED',
      'TOO_MANY_ATTEMPTS',
      'BOT_TOKEN_INVALID',
      'BOT_BELONGS_TO_ANOTHER_WORKSPACE',
      'WORKSPACE_KEEPS_ONE_BOT',
      'TAKEOVER_CONFIRMATION_REQUIRED',
      'NOTHING_TO_RECONNECT',
      'BOT_NEEDS_NEW_TOKEN',
      'NO_BOT_CONNECTED',
      'TELEGRAM_UNAVAILABLE',
    ]) {
      expect(ErrorCode).toHaveProperty(c, c);
    }
  });
});

describe('ErrorEnvelope', () => {
  it('accepts the documented envelope shape', () => {
    const body = { error: { code: ErrorCode.NOT_FOUND, message: 'nope' } };
    expect(ErrorEnvelope.parse(body)).toEqual(body);
  });

  it('rejects a body without the error object', () => {
    expect(ErrorEnvelope.safeParse({ code: 'NOT_FOUND' }).success).toBe(false);
  });
});
