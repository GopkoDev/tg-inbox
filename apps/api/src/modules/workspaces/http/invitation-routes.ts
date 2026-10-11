import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { InvitationAccept, LinkTokenBody } from '@tg/shared';
import type { AccountUseCases } from '../../auth/app/accounts.js';
import type { SessionUseCases } from '../../auth/app/sessions.js';
import { SESSION_COOKIE, setSessionCookie, type CookieOptions } from '../../auth/http/cookie.js';
import type { createAcceptInvitation, SignedInAccount } from '../app/accept-invitation.js';

type AcceptInvitation = ReturnType<typeof createAcceptInvitation>;

export interface InvitationRoutesDeps {
  invitations: Pick<AcceptInvitation, 'lookUpInvitation' | 'acceptInvitation'>;
  sessionUseCases: Pick<SessionUseCases, 'resolveSession' | 'signOut'>;
  accountUseCases: Pick<AccountUseCases, 'getAccount'>;
  cookie: CookieOptions;
}

/**
 * The password policy and the display-name rule are enforced by the use case (so the error carries
 * `details.field`); the body schema only bounds the size.
 */
const AcceptBody = InvitationAccept.extend({
  password: z.string().max(1024),
  display_name: z.string().max(1024).optional(),
});

/** Public routes: they read an optional session and treat any failure to resolve it as anonymous. */
export async function registerInvitationRoutes(
  app: FastifyInstance,
  deps: InvitationRoutesDeps,
): Promise<void> {
  const { invitations, sessionUseCases, accountUseCases, cookie } = deps;
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function optionalAccount(request: FastifyRequest): Promise<SignedInAccount | undefined> {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return undefined;
    try {
      const session = await sessionUseCases.resolveSession(token, { background: true });
      const account = await accountUseCases.getAccount(session.accountId);
      return account ? { id: account.id, email: account.email } : undefined;
    } catch {
      return undefined;
    }
  }

  r.post('/invitations/lookup', { schema: { body: LinkTokenBody } }, async (request) => {
    const view = await invitations.lookUpInvitation(
      request.body.token,
      await optionalAccount(request),
    );
    return {
      workspace_name: view.workspaceName,
      email: view.email,
      role: view.role,
      account_exists: view.accountExists,
    };
  });

  r.post('/invitations/accept', { schema: { body: AcceptBody } }, async (request, reply) => {
    const { token, password, display_name: displayName } = request.body;
    const signedIn = await optionalAccount(request);
    const accepted = await invitations.acceptInvitation({ token, password, displayName }, signedIn);
    const previous = request.cookies[SESSION_COOKIE];
    if (previous) await sessionUseCases.signOut(previous);
    setSessionCookie(reply, accepted.sessionToken, cookie);
    return accepted.workspace;
  });
}
