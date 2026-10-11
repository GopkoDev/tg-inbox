import type { FastifyReply } from 'fastify';

export const SESSION_COOKIE = 'session';

export interface CookieOptions {
  /** False only in local development, where the panel is served over plain http. */
  secure: boolean;
}

const base = (secure: boolean) => ({ httpOnly: true, sameSite: 'lax', path: '/', secure }) as const;

/** Sets the session cookie: a browser-session cookie; the idle limit is enforced server-side. */
export function setSessionCookie(reply: FastifyReply, token: string, { secure }: CookieOptions) {
  reply.setCookie(SESSION_COOKIE, token, base(secure));
}

export function clearSessionCookie(reply: FastifyReply, { secure }: CookieOptions) {
  reply.setCookie(SESSION_COOKIE, '', { ...base(secure), maxAge: 0 });
}
