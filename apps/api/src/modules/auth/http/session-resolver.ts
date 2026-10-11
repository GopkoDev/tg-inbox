import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { UnauthenticatedError } from '../../../platform/errors.js';
import type { AccountUseCases } from '../app/accounts.js';
import type { Account } from '../app/ports.js';
import type { SessionUseCases } from '../app/sessions.js';
import { SESSION_COOKIE } from '../../../platform/session-cookie.js';

/** The signed-in account as exposed to routes; never carries the password hash. */
export type AuthenticatedAccount = Omit<Account, 'passwordHash'>;

declare module 'fastify' {
  interface FastifyRequest {
    account: AuthenticatedAccount;
    sessionId: string;
  }
}

export interface SessionResolverDeps {
  sessionUseCases: Pick<SessionUseCases, 'resolveSession'>;
  accountUseCases: Pick<AccountUseCases, 'getAccount'>;
}

const SIGN_IN_REQUIRED = 'Sign in to continue';

/**
 * preHandler for every authenticated route: reads the session cookie, resolves it (a request marked
 * `X-Background-Request: 1` does not extend the idle window) and attaches `request.account`.
 */
export function createSessionResolver({
  sessionUseCases,
  accountUseCases,
}: SessionResolverDeps): preHandlerAsyncHookHandler {
  return async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) throw new UnauthenticatedError(SIGN_IN_REQUIRED);
    const background = request.headers['x-background-request'] === '1';
    const session = await sessionUseCases
      .resolveSession(token, { background })
      .catch((err: unknown) => {
        throw err instanceof UnauthenticatedError
          ? new UnauthenticatedError(SIGN_IN_REQUIRED)
          : err;
      });
    const found = await accountUseCases.getAccount(session.accountId);
    if (!found) throw new UnauthenticatedError(SIGN_IN_REQUIRED);
    request.account = {
      id: found.id,
      email: found.email,
      displayName: found.displayName,
      createdAt: found.createdAt,
    };
    request.sessionId = session.id;
  };
}

/** Resolves the request's session if there is a valid one; any failure to resolve means anonymous. */
export type OptionalAccountResolver = (
  request: FastifyRequest,
) => Promise<{ id: string; email: string } | undefined>;

/** Background resolution (never extends the idle window), for public routes. */
export function createOptionalAccountResolver({
  sessionUseCases,
  accountUseCases,
}: SessionResolverDeps): OptionalAccountResolver {
  return async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return undefined;
    try {
      const session = await sessionUseCases.resolveSession(token, { background: true });
      const account = await accountUseCases.getAccount(session.accountId);
      return account ? { id: account.id, email: account.email } : undefined;
    } catch {
      return undefined;
    }
  };
}
