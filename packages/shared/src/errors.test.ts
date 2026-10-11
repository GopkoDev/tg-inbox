import { describe, expect, it } from 'vitest';
import { ErrorCode, ErrorEnvelope } from './errors.js';

describe('ErrorEnvelope', () => {
  it('accepts the documented envelope shape', () => {
    const body = { error: { code: ErrorCode.NOT_FOUND, message: 'nope' } };
    expect(ErrorEnvelope.parse(body)).toEqual(body);
  });

  it('rejects a body without the error object', () => {
    expect(ErrorEnvelope.safeParse({ code: 'NOT_FOUND' }).success).toBe(false);
  });
});
