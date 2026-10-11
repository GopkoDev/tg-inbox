import type { Clock } from '../../../platform/clock.js';
import { InvalidCredentialsError, TooManyRequestsError } from '../../../platform/errors.js';
import { normaliseEmail } from '../domain/email.js';
import { lockoutState } from '../domain/lockout.js';
import type { AccountRepo, PasswordHasher, SignInFailureRepo } from './ports.js';
import type { SessionUseCases } from './sessions.js';

export interface CredentialDeps {
  accounts: AccountRepo;
  failures: SignInFailureRepo;
  hasher: PasswordHasher;
  clock: Clock;
  sessionUseCases: Pick<SessionUseCases, 'openSession'>;
}

export interface CredentialUseCases {
  /** Returns the raw session token. */
  signIn(email: string, password: string): Promise<string>;
  /**
   * Checks an existing account's password for invitation acceptance. Failures are written on the
   * default connection (never joined to a caller transaction) so they survive a rollback.
   * Returns the account id.
   */
  verifyPassword(email: string, password: string): Promise<string>;
}

export function createCredentialUseCases(deps: CredentialDeps): CredentialUseCases {
  const { accounts, failures, hasher, clock, sessionUseCases } = deps;

  /** Lockout check, then hash verification; records/clears failures. Returns the account id or throws. */
  async function check(rawEmail: string, password: string, lockedError: () => Error) {
    const email = normaliseEmail(rawEmail);
    const state = lockoutState(await failures.listRecent(email, clock.now()), clock.now());
    if (state.locked) throw lockedError();

    const account = await accounts.findByEmail(email);
    const ok = account
      ? await hasher.verify(account.passwordHash, password)
      : await hasher.verifyDummy(password);
    if (!account || !ok) {
      await failures.record(email, clock.now());
      throw new InvalidCredentialsError('Invalid email or password');
    }
    await failures.clear(email);
    return account.id;
  }

  return {
    async signIn(email, password) {
      const accountId = await check(
        email,
        password,
        () => new TooManyRequestsError('Too many failed attempts, try again later'),
      );
      return sessionUseCases.openSession(accountId);
    },
    verifyPassword: (email, password) =>
      check(email, password, () => new InvalidCredentialsError('Invalid email or password')),
  };
}
