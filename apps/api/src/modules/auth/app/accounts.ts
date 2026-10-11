import type { Clock } from '../../../platform/clock.js';
import { ValidationError } from '../../../platform/errors.js';
import { normaliseEmail } from '../domain/email.js';
import { checkPasswordPolicy } from '../domain/password-policy.js';
import type { Account, AccountRepo, Executor, PasswordHasher } from './ports.js';

export interface AccountDeps {
  accounts: AccountRepo;
  hasher: PasswordHasher;
  clock: Clock;
}

/** A validated account whose password is already hashed; insert it later, inside a transaction. */
export interface PreparedAccount {
  email: string;
  displayName: string;
  passwordHash: string;
}

export interface AccountUseCases {
  /** Checks the password policy and hashes the password; writes nothing. */
  prepareAccount(input: {
    email: string;
    displayName: string;
    password: string;
  }): Promise<PreparedAccount>;
  /** Rejects with a Postgres unique violation when the email already has an account. */
  insertPreparedAccount(prepared: PreparedAccount, tx?: Executor): Promise<Account>;
  /** Rejects with a Postgres unique violation when the email already has an account. */
  createAccount(
    input: { email: string; displayName: string; password: string },
    tx?: Executor,
  ): Promise<Account>;
  findAccountIdByEmail(email: string, tx?: Executor): Promise<string | undefined>;
  getAccount(id: string, tx?: Executor): Promise<Account | undefined>;
  getAccountsByIds(ids: readonly string[], tx?: Executor): Promise<Account[]>;
}

export function createAccountUseCases({ accounts, hasher, clock }: AccountDeps): AccountUseCases {
  async function prepareAccount({
    email,
    displayName,
    password,
  }: {
    email: string;
    displayName: string;
    password: string;
  }): Promise<PreparedAccount> {
    const check = checkPasswordPolicy(password);
    if (!check.ok) throw new ValidationError(check.message, { field: check.field });
    return {
      email: normaliseEmail(email),
      displayName,
      passwordHash: await hasher.hash(password),
    };
  }
  const insertPreparedAccount = (prepared: PreparedAccount, tx?: Executor) =>
    accounts.insert({ ...prepared, now: clock.now() }, tx);

  return {
    prepareAccount,
    insertPreparedAccount,
    async createAccount(input, tx) {
      return insertPreparedAccount(await prepareAccount(input), tx);
    },
    async findAccountIdByEmail(email, tx) {
      return (await accounts.findByEmail(normaliseEmail(email), tx))?.id;
    },
    getAccount: (id, tx) => accounts.findById(id, tx),
    getAccountsByIds: (ids, tx) => accounts.findByIds(ids, tx),
  };
}
