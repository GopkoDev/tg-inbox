import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { LinkTokenBody, PasswordResetRedeem, SignIn } from '@tg/shared';
import type { CredentialUseCases } from '../app/credentials.js';
import type { ResetLinkUseCases } from '../app/reset-links.js';
import type { SessionUseCases } from '../app/sessions.js';
import {
  clearSessionCookie,
  SESSION_COOKIE,
  setSessionCookie,
  type CookieOptions,
} from '../../../platform/session-cookie.js';

export interface AuthDeps {
  credentialUseCases: Pick<CredentialUseCases, 'signIn'>;
  sessionUseCases: Pick<SessionUseCases, 'signOut'>;
  resetLinkUseCases: Pick<ResetLinkUseCases, 'lookUpResetLink' | 'redeemResetLink'>;
  cookie: CookieOptions;
}

/** Registers the public auth routes; the caller supplies the `/api` prefix. */
export async function registerAuth(app: FastifyInstance, deps: AuthDeps): Promise<void> {
  const { credentialUseCases, sessionUseCases, resetLinkUseCases, cookie } = deps;
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/auth/sign-in', { schema: { body: SignIn } }, async (request, reply) => {
    const { email, password } = request.body;
    const token = await credentialUseCases.signIn(email, password);
    const previous = request.cookies[SESSION_COOKIE];
    if (previous) await sessionUseCases.signOut(previous);
    setSessionCookie(reply, token, cookie);
    return reply.status(204).send();
  });

  r.post('/auth/sign-out', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await sessionUseCases.signOut(token);
    clearSessionCookie(reply, cookie);
    return reply.status(204).send();
  });

  r.post(
    '/password-reset-links/lookup',
    { schema: { body: LinkTokenBody } },
    async (request, reply) => {
      await resetLinkUseCases.lookUpResetLink(request.body.token);
      return reply.status(204).send();
    },
  );

  r.post(
    '/password-reset-links/redeem',
    { schema: { body: PasswordResetRedeem } },
    async (request, reply) => {
      const { token, password } = request.body;
      const session = await resetLinkUseCases.redeemResetLink(token, password);
      const previous = request.cookies[SESSION_COOKIE];
      if (previous) await sessionUseCases.signOut(previous);
      setSessionCookie(reply, session, cookie);
      return reply.status(204).send();
    },
  );
}
