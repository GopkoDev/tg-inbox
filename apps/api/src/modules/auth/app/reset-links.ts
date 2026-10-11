import type { Clock } from '../../../platform/clock.js';
import { NotFoundError, ResetLinkInvalidError, ValidationError } from '../../../platform/errors.js';
import { hashToken, issueLinkToken } from '../../../platform/tokens.js';
import { normaliseEmail } from '../domain/email.js';
import { checkPasswordPolicy } from '../domain/password-policy.js';
import { RESET_LINK_TTL, resetLinkIsUsable } from '../domain/reset-link.js';
import type {
  AccountRepo,
  PasswordHasher,
  ResetLinkRepo,
  SessionRepo,
  SignInFailureRepo,
  Transaction,
} from './ports.js';
import type { SessionUseCases } from './sessions.js';

export interface ResetLinkDeps {
  accounts: AccountRepo;
  links: ResetLinkRepo;
  sessions: SessionRepo;
  failures: SignInFailureRepo;
  hasher: PasswordHasher;
  clock: Clock;
  sessionUseCases: Pick<SessionUseCases, 'openSession'>;
  transaction: Transaction;
  /** `PUBLIC_WEB_URL`, used to build the link. */
  publicWebUrl: string;
}

export interface IssuedResetLink {
  accountId: string;
  resetLinkId: string;
  /** Shown exactly once; only its hash is stored. */
  link: string;
  expiresAt: Date;
}

export interface ResetLinkUseCases {
  /** Throws NotFoundError when no account has this email. Supersedes the account's earlier pending links. */
  issueResetLink(email: string): Promise<IssuedResetLink>;
  /** Resolves when the link is usable; otherwise throws ResetLinkInvalidError. Never reveals the account. */
  lookUpResetLink(token: string): Promise<void>;
  /** Consumes the link, sets the password, ends every session; returns the raw token of the new session. */
  redeemResetLink(token: string, password: string): Promise<string>;
}

export function createResetLinkUseCases(deps: ResetLinkDeps): ResetLinkUseCases {
  const { accounts, links, sessions, failures, hasher, clock, sessionUseCases, transaction } = deps;
  const invalid = () => new ResetLinkInvalidError('This reset link is no longer valid');

  return {
    async issueResetLink(rawEmail) {
      const account = await accounts.findByEmail(normaliseEmail(rawEmail));
      if (!account) throw new NotFoundError('No account with this email');
      const { token, hash } = issueLinkToken();
      const now = clock.now();
      const expiresAt = new Date(now.getTime() + RESET_LINK_TTL);
      const record = await transaction(async (tx) => {
        await links.supersedePending(account.id, now, tx);
        return links.insert({ accountId: account.id, tokenHash: hash, expiresAt, now }, tx);
      });
      return {
        accountId: account.id,
        resetLinkId: record.id,
        link: `${deps.publicWebUrl.replace(/\/+$/, '')}/reset-password/${token}`,
        expiresAt,
      };
    },

    async lookUpResetLink(token) {
      const link = await links.findByTokenHash(hashToken(token));
      if (!link || !resetLinkIsUsable(link, clock.now())) throw invalid();
    },

    async redeemResetLink(token, password) {
      const check = checkPasswordPolicy(password);
      if (!check.ok) throw new ValidationError(check.message, { field: check.field });
      const passwordHash = await hasher.hash(password);
      return transaction(async (tx) => {
        const link = await links.consume(hashToken(token), clock.now(), tx);
        if (!link) throw invalid();
        const account = await accounts.findById(link.accountId, tx);
        if (!account) throw invalid();
        await accounts.updatePasswordHash(account.id, passwordHash, tx);
        await sessions.deleteByAccount(account.id, undefined, tx);
        await failures.clear(account.email, tx);
        return sessionUseCases.openSession(account.id, tx);
      });
    },
  };
}
