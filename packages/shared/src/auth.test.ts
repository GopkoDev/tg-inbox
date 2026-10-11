import { describe, expect, it } from 'vitest';
import { LinkTokenBody, PasswordResetRedeem, SignIn } from './index.js';

const token = 'A1_-'.repeat(10) + 'abc';

describe('auth schemas', () => {
  it('SignIn normalises email and accepts a short password', () => {
    expect(SignIn.parse({ email: ' Bob@X.com', password: 'abc' })).toEqual({
      email: 'bob@x.com',
      password: 'abc',
    });
  });
  it('SignIn rejects empty / >1024 password and extra keys', () => {
    expect(SignIn.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
    expect(SignIn.safeParse({ email: 'a@b.co', password: 'x'.repeat(1025) }).success).toBe(false);
    expect(SignIn.safeParse({ email: 'a@b.co', password: 'x', extra: 1 }).success).toBe(false);
  });
  it('LinkTokenBody validates the token shape', () => {
    expect(LinkTokenBody.safeParse({ token }).success).toBe(true);
    expect(LinkTokenBody.safeParse({ token: 'short' }).success).toBe(false);
  });
  it('PasswordResetRedeem enforces the policy', () => {
    const r = PasswordResetRedeem.safeParse({ token, password: 'x'.repeat(9) });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('The password must be at least 10 characters long');
    expect(PasswordResetRedeem.safeParse({ token, password: 'x'.repeat(10) }).success).toBe(true);
  });
});
