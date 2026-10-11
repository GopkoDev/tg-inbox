import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { ValidationError } from '../../../platform/errors.js';
import { createAccountUseCases } from './accounts.js';
import { fakeAccountRepo, fakeHasher } from './fakes.js';

function setup() {
  const accounts = fakeAccountRepo();
  const clock = fixedClock(new Date('2026-01-01T10:00:00Z'));
  return { accounts, clock, uc: createAccountUseCases({ accounts, hasher: fakeHasher(), clock }) };
}

describe('createAccount', () => {
  it('normalises the email, hashes the password and stamps the clock', async () => {
    const { uc, clock } = setup();
    const a = await uc.createAccount({
      email: ' Bob@X.com ',
      displayName: 'Bob',
      password: 'correct-horse-1',
    });
    expect(a.email).toBe('bob@x.com');
    expect(a.passwordHash).not.toBe('correct-horse-1');
    expect(a.createdAt).toEqual(clock.now());
  });

  it('rejects passwords outside 10-1024 characters', async () => {
    const { uc, accounts } = setup();
    await expect(
      uc.createAccount({ email: 'a@x.com', displayName: 'A', password: 'short' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      uc.createAccount({ email: 'a@x.com', displayName: 'A', password: 'x'.repeat(1025) }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(accounts.rows).toHaveLength(0);
  });

  it('passes the transaction handle through', async () => {
    const { clock } = setup();
    const accounts = fakeAccountRepo();
    const seen: unknown[] = [];
    const orig = accounts.insert.bind(accounts);
    accounts.insert = async (input, tx) => {
      seen.push(tx);
      return orig(input, tx);
    };
    const tx = {} as never;
    await createAccountUseCases({ accounts, hasher: fakeHasher(), clock }).createAccount(
      { email: 'a@x.com', displayName: 'A', password: 'correct-horse-1' },
      tx,
    );
    expect(seen).toEqual([tx]);
  });
});

describe('lookups', () => {
  it('finds an id by un-normalised email, gets one and many', async () => {
    const { uc } = setup();
    const a = await uc.createAccount({
      email: 'a@x.com',
      displayName: 'A',
      password: 'correct-horse-1',
    });
    const b = await uc.createAccount({
      email: 'b@x.com',
      displayName: 'B',
      password: 'correct-horse-1',
    });
    await expect(uc.findAccountIdByEmail(' A@X.com')).resolves.toBe(a.id);
    await expect(uc.findAccountIdByEmail('zzz@x.com')).resolves.toBeUndefined();
    await expect(uc.getAccount(b.id)).resolves.toEqual(b);
    await expect(uc.getAccountsByIds([a.id, b.id])).resolves.toHaveLength(2);
  });
});

describe('prepareAccount / insertPreparedAccount', () => {
  it('prepares a hashed account without writing, then inserts it later', async () => {
    const { uc, accounts, clock } = setup();
    const p = await uc.prepareAccount({
      email: ' Bob@X.com ',
      displayName: 'Bob',
      password: 'correct-horse-1',
    });
    expect(p.email).toBe('bob@x.com');
    expect(p.passwordHash).not.toBe('correct-horse-1');
    expect(accounts.rows).toHaveLength(0);
    const a = await uc.insertPreparedAccount(p);
    expect(a.passwordHash).toBe(p.passwordHash);
    expect(a.createdAt).toEqual(clock.now());
  });

  it('refuses a short password before anything is hashed or written', async () => {
    const { uc, accounts } = setup();
    await expect(
      uc.prepareAccount({ email: 'a@x.com', displayName: 'A', password: 'short' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(accounts.rows).toHaveLength(0);
  });
});
