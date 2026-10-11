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

export interface AccountUseCases {
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
  return {
    async createAccount({ email, displayName, password }, tx) {
      const check = checkPasswordPolicy(password);
      if (!check.ok) throw new ValidationError(check.message, { field: check.field });
      const passwordHash = await hasher.hash(password);
      return accounts.insert(
        { email: normaliseEmail(email), displayName, passwordHash, now: clock.now() },
        tx,
      );
    },
    async findAccountIdByEmail(email, tx) {
      return (await accounts.findByEmail(normaliseEmail(email), tx))?.id;
    },
    getAccount: (id, tx) => accounts.findById(id, tx),
    getAccountsByIds: (ids, tx) => accounts.findByIds(ids, tx),
  };
}
