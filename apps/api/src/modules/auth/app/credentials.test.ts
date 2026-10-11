import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { InvalidCredentialsError, TooManyRequestsError } from '../../../platform/errors.js';
import { createAccountUseCases } from './accounts.js';
import { createCredentialUseCases } from './credentials.js';
import {
  fakeAccountRepo,
  fakeEmailLock,
  fakeFailureRepo,
  fakeHasher,
  fakeSessionRepo,
} from './fakes.js';
import { createSessionUseCases } from './sessions.js';

async function setup() {
  const clock = fixedClock(new Date('2026-01-01T10:00:00Z'));
  const accounts = fakeAccountRepo();
  const failures = fakeFailureRepo();
  const sessions = fakeSessionRepo();
  const hasher = fakeHasher();
  const sessionUseCases = createSessionUseCases({ sessions, clock });
  const creds = createCredentialUseCases({
    accounts,
    failures,
    hasher,
    clock,
    sessionUseCases,
    emailLock: fakeEmailLock(),
  });
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

describe('contract message and atomic lockout', () => {
  const MESSAGE = 'Email or password is incorrect';

  it('AC-08: sign-in and verifyPassword both fail with the contract message', async () => {
    const { creds } = await setup();
    const a = await creds.signIn('bob@x.com', 'nope-nope-nope').catch((e) => e);
    const b = await creds.verifyPassword('ghost@x.com', 'nope-nope-nope').catch((e) => e);
    expect(a).toBeInstanceOf(InvalidCredentialsError);
    expect(a.message).toBe(MESSAGE);
    expect(b.message).toBe(MESSAGE);
  });

  it('AC-09: 20 parallel wrong passwords record at most 10 failures, the rest are locked out', async () => {
    const { creds, failures } = await setup();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        creds.signIn('bob@x.com', 'wrong-password-1').catch((e: unknown) => e),
      ),
    );
    expect(failures.rows).toHaveLength(10);
    expect(results.filter((e) => e instanceof TooManyRequestsError)).toHaveLength(10);
    await expect(creds.signIn('bob@x.com', 'correct-horse-1')).rejects.toBeInstanceOf(
      TooManyRequestsError,
    );
  });

  it('AC-09: the same holds for an email without an account', async () => {
    const { creds, failures, hasher } = await setup();
    await Promise.all(
      Array.from({ length: 20 }, () =>
        creds.signIn('ghost@x.com', 'wrong-password-1').catch(() => 0),
      ),
    );
    expect(failures.rows).toHaveLength(10);
    expect(hasher.dummyCalls).toBe(10);
  });
});

describe('no lock held while hashing', () => {
  it('AC-09: the email lock is released before the hash is verified, and a pending attempt already counts', async () => {
    const clock = fixedClock(new Date('2026-01-01T10:00:00Z'));
    const accounts = fakeAccountRepo();
    const failures = fakeFailureRepo();
    const base = fakeHasher();
    const lock = fakeEmailLock();
    let held = 0;
    const heldDuringHash: number[] = [];
    const recentDuringHash: number[] = [];
    const hasher = {
      ...base,
      async verify(hash: string, password: string) {
        heldDuringHash.push(held);
        recentDuringHash.push((await failures.listRecent('bob@x.com', clock.now())).length);
        return base.verify(hash, password);
      },
    };
    const creds = createCredentialUseCases({
      accounts,
      failures,
      hasher,
      clock,
      sessionUseCases: createSessionUseCases({ sessions: fakeSessionRepo(), clock }),
      emailLock: (email, fn) =>
        lock(email, async (tx) => {
          held += 1;
          try {
            return await fn(tx);
          } finally {
            held -= 1;
          }
        }),
    });
    await createAccountUseCases({ accounts, hasher: base, clock }).createAccount({
      email: 'bob@x.com',
      displayName: 'Bob',
      password: 'correct-horse-1',
    });
    await creds.signIn('bob@x.com', 'correct-horse-1');
    expect(heldDuringHash).toEqual([0]);
    expect(recentDuringHash).toEqual([1]);
    // success cleared the provisional attempt
    expect(await failures.listRecent('bob@x.com', clock.now())).toHaveLength(0);
  });
});
