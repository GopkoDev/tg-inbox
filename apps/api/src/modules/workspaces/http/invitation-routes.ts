import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  DISPLAY_NAME_MESSAGE,
  InvitationAccept,
  InvitationPreview,
  LinkTokenBody,
  WorkspaceSummary,
} from '@tg/shared';
import type { SessionUseCases } from '../../auth/app/sessions.js';
import {
  SESSION_COOKIE,
  setSessionCookie,
  type CookieOptions,
} from '../../../platform/session-cookie.js';
import type { createAcceptInvitation, SignedInAccount } from '../app/accept-invitation.js';

type AcceptInvitation = ReturnType<typeof createAcceptInvitation>;

export interface InvitationRoutesDeps {
  invitations: Pick<AcceptInvitation, 'lookUpInvitation' | 'acceptInvitation'>;
  sessionUseCases: Pick<SessionUseCases, 'resolveSession' | 'signOut'>;
  /** The auth module's optional-session resolver; anonymous when absent or invalid. */
  optionalAccount: (request: FastifyRequest) => Promise<SignedInAccount | undefined>;
  cookie: CookieOptions;
}

/**
 * The display-name rule is enforced by the use case (so the error carries `details.field`); the body
 * schema only bounds its size. The shared `InvitationAccept` already bounds the password only.
 */
const AcceptBody = InvitationAccept.extend({
  display_name: z.string().max(1024, DISPLAY_NAME_MESSAGE).optional(),
});

/** Public routes: they read an optional session and treat any failure to resolve it as anonymous. */
export async function registerInvitationRoutes(
  app: FastifyInstance,
  deps: InvitationRoutesDeps,
): Promise<void> {
  const { invitations, sessionUseCases, optionalAccount, cookie } = deps;
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/invitations/lookup',
    { schema: { body: LinkTokenBody, response: { 200: InvitationPreview } } },
    async (request) => {
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
    },
  );

  r.post(
    '/invitations/accept',
    { schema: { body: AcceptBody, response: { 200: WorkspaceSummary } } },
    async (request, reply) => {
      const { token, password, display_name: displayName } = request.body;
      const signedIn = await optionalAccount(request);
      const accepted = await invitations.acceptInvitation(
        { token, password, displayName },
        signedIn,
      );
      const previous = request.cookies[SESSION_COOKIE];
      if (previous) await sessionUseCases.signOut(previous);
      setSessionCookie(reply, accepted.sessionToken, cookie);
      return accepted.workspace;
    },
  );
}
