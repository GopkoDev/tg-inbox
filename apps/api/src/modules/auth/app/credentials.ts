import type { Clock } from '../../../platform/clock.js';
import { InvalidCredentialsError, TooManyRequestsError } from '../../../platform/errors.js';
import { normaliseEmail } from '../domain/email.js';
import { lockoutState } from '../domain/lockout.js';
import type { AccountRepo, EmailLock, PasswordHasher, SignInFailureRepo } from './ports.js';
import type { SessionUseCases } from './sessions.js';

export interface CredentialDeps {
  accounts: AccountRepo;
  failures: SignInFailureRepo;
  hasher: PasswordHasher;
  clock: Clock;
  sessionUseCases: Pick<SessionUseCases, 'openSession'>;
  emailLock: EmailLock;
}

/** The credential refusal text from the API contract (SCR-01 / SCR-02). */
const CREDENTIALS_MESSAGE = 'Email or password is incorrect';

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
  const { accounts, failures, hasher, clock, sessionUseCases, emailLock } = deps;

  /**
   * Reserve-then-verify, so no database connection is held while argon2 runs:
   * 1. under the per-email lock (short transaction) check the lockout and record a provisional
   *    failure, so the attempt counts immediately and parallel bursts cannot exceed the limit;
   * 2. verify the hash outside any transaction;
   * 3. on success clear the failures (which removes the provisional row); on failure the
   *    provisional row simply stays as the recorded failure.
   * Returns the account id or throws.
   */
  async function check(rawEmail: string, password: string, lockedError: () => Error) {
    const email = normaliseEmail(rawEmail);
    // The outcome is returned, not thrown, so the reservation written inside the lock is committed.
    const reservation = await emailLock(email, async (tx) => {
      const now = clock.now();
      if (lockoutState(await failures.listRecent(email, now, tx), now).locked) {
        return { kind: 'locked' } as const;
      }
      const account = await accounts.findByEmail(email, tx);
      await failures.record(email, now, tx);
      return { kind: 'reserved', account } as const;
    });
    if (reservation.kind === 'locked') throw lockedError();
    const { account } = reservation;
    const ok = account
      ? await hasher.verify(account.passwordHash, password)
      : await hasher.verifyDummy(password);
    if (!account || !ok) throw new InvalidCredentialsError(CREDENTIALS_MESSAGE);
    await emailLock(email, (tx) => failures.clear(email, tx));
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
      check(email, password, () => new InvalidCredentialsError(CREDENTIALS_MESSAGE)),
  };
}
