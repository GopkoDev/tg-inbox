import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { InvalidCredentialsError, TooManyRequestsError } from '../../../platform/errors.js';
import { createAccountUseCases } from './accounts.js';
import { createCredentialUseCases } from './credentials.js';
import { fakeAccountRepo, fakeFailureRepo, fakeHasher, fakeSessionRepo } from './fakes.js';
import { createSessionUseCases } from './sessions.js';

async function setup() {
  const clock = fixedClock(new Date('2026-01-01T10:00:00Z'));
  const accounts = fakeAccountRepo();
  const failures = fakeFailureRepo();
  const sessions = fakeSessionRepo();
  const hasher = fakeHasher();
  const sessionUseCases = createSessionUseCases({ sessions, clock });
  const creds = createCredentialUseCases({ accounts, failures, hasher, clock, sessionUseCases });
  await createAccountUseCases({ accounts, hasher, clock }).createAccount({
    email: 'Bob@x.com',
    displayName: 'Bob',
    password: 'correct-horse-1',
  });
  return { clock, accounts, failures, sessions, hasher, creds };
}

async function fail(creds: { signIn: (e: string, p: string) => Promise<string> }, email: string) {
  await creds.signIn(email, 'wrong-password-1').catch(() => undefined);
}

describe('signIn', () => {
  it('opens a session and returns a raw token for correct credentials (email normalised)', async () => {
    const { creds, sessions } = await setup();
    const token = await creds.signIn(' BOB@x.com ', 'correct-horse-1');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessions.rows).toHaveLength(1);
  });

  it('AC-08: unknown email and wrong password give the same error', async () => {
    const { creds, hasher } = await setup();
    const wrong = await creds.signIn('bob@x.com', 'nope-nope-nope').catch((e) => e);
    const unknown = await creds.signIn('ghost@x.com', 'nope-nope-nope').catch((e) => e);
    expect(wrong).toBeInstanceOf(InvalidCredentialsError);
    expect(unknown).toBeInstanceOf(InvalidCredentialsError);
    expect(unknown.message).toBe(wrong.message);
    expect(unknown.code).toBe(wrong.code);
    expect(hasher.dummyCalls).toBe(1);
  });

  it('AC-09: locks at the 10th failure and refuses even the correct password', async () => {
    const { creds } = await setup();
    for (let i = 0; i < 9; i++) await fail(creds, 'bob@x.com');
    await expect(creds.signIn('bob@x.com', 'correct-horse-1')).resolves.toBeTruthy();
    for (let i = 0; i < 10; i++) await fail(creds, 'bob@x.com');
    await expect(creds.signIn('bob@x.com', 'correct-horse-1')).rejects.toBeInstanceOf(
      TooManyRequestsError,
    );
  });

  it('AC-09: lock lifts 15 minutes after the 10th failure', async () => {
    const { creds, clock } = await setup();
    for (let i = 0; i < 10; i++) await fail(creds, 'bob@x.com');
    clock.advance(15 * 60_000 - 1);
    await expect(creds.signIn('bob@x.com', 'correct-horse-1')).rejects.toBeInstanceOf(
      TooManyRequestsError,
    );
    clock.advance(1);
    await expect(creds.signIn('bob@x.com', 'correct-horse-1')).resolves.toBeTruthy();
  });

  it('AC-09: an email without an account locks identically', async () => {
    const { creds } = await setup();
    for (let i = 0; i < 10; i++) await fail(creds, 'ghost@x.com');
    await expect(creds.signIn('ghost@x.com', 'whatever-123')).rejects.toBeInstanceOf(
      TooManyRequestsError,
    );
  });

  it('AC-09: success clears the failure count', async () => {
    const { creds, failures } = await setup();
    for (let i = 0; i < 9; i++) await fail(creds, 'bob@x.com');
    await creds.signIn('bob@x.com', 'correct-horse-1');
    expect(failures.rows).toHaveLength(0);
    await fail(creds, 'bob@x.com');
    expect(failures.rows).toHaveLength(1);
  });
});

describe('verifyPassword', () => {
  it('returns the account id for the right password and clears failures', async () => {
    const { creds, accounts, failures } = await setup();
    await fail(creds, 'bob@x.com');
    await expect(creds.verifyPassword('bob@x.com', 'correct-horse-1')).resolves.toBe(
      accounts.rows[0]!.id,
    );
    expect(failures.rows).toHaveLength(0);
  });

  it('records a failure on a wrong password and counts toward lockout', async () => {
    const { creds, failures } = await setup();
    await expect(creds.verifyPassword('bob@x.com', 'wrong-password-1')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(failures.rows).toHaveLength(1);
    for (let i = 0; i < 9; i++) await creds.verifyPassword('bob@x.com', 'x').catch(() => undefined);
    const err = await creds.verifyPassword('bob@x.com', 'correct-horse-1').catch((e) => e);
    expect(err).toBeInstanceOf(InvalidCredentialsError);
    expect(err).not.toBeInstanceOf(TooManyRequestsError);
    expect(failures.rows).toHaveLength(10);
  });
});
