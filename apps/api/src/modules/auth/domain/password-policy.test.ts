import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy } from './password-policy.js';

describe('checkPasswordPolicy (AC-05)', () => {
  it('rejects fewer than 10 characters with the field message', () => {
    expect(checkPasswordPolicy('123456789')).toEqual({
      ok: false,
      field: 'password',
      message: 'The password must be at least 10 characters long',
    });
  });
  it('accepts exactly 10 and exactly 1024 characters', () => {
    expect(checkPasswordPolicy('x'.repeat(10))).toEqual({ ok: true });
    expect(checkPasswordPolicy('x'.repeat(1024))).toEqual({ ok: true });
  });
  it('rejects more than 1024 characters', () => {
    expect(checkPasswordPolicy('x'.repeat(1025)).ok).toBe(false);
  });
});
