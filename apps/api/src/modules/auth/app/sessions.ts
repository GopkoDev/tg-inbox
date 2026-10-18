import type { Clock } from '../../../platform/clock.js';
import { UnauthenticatedError } from '../../../platform/errors.js';
import { hashToken, issueLinkToken } from '../../../platform/tokens.js';
import { sessionIsExpired, shouldRefreshLastSeen } from '../domain/session.js';
import type { Executor, Session, SessionRepo } from './ports.js';

export interface SessionDeps {
  sessions: SessionRepo;
  clock: Clock;
}

export interface SessionUseCases {
  /** Creates a session and returns the raw token (stored only as a hash). */
  openSession(accountId: string, tx?: Executor): Promise<string>;
  /** Ends the session of this token; silent when there is none. */
  signOut(token: string): Promise<void>;
  resolveSession(token: string, options: { background: boolean }): Promise<Session>;
  /** Of `sessionIds`, those still valid (present and not idle-expired); touches nothing. */
  liveSessionIds(sessionIds: readonly string[]): Promise<string[]>;
}

export function createSessionUseCases({ sessions, clock }: SessionDeps): SessionUseCases {
  return {
    async openSession(accountId, tx) {
      const { token, hash } = issueLinkToken();
      await sessions.insert({ accountId, tokenHash: hash, now: clock.now() }, tx);
      return token;
    },

    async signOut(token) {
      await sessions.deleteByTokenHash(hashToken(token));
    },

    async liveSessionIds(sessionIds) {
      const now = clock.now();
      const found = await sessions.findByIds(sessionIds);
      return found.filter((s) => !sessionIsExpired(s.lastSeenAt, now)).map((s) => s.id);
    },

    async resolveSession(token, { background }) {
      const hash = hashToken(token);
      const session = await sessions.findByTokenHash(hash);
      if (!session) throw new UnauthenticatedError('Not signed in');
      const now = clock.now();
      if (sessionIsExpired(session.lastSeenAt, now)) {
        await sessions.deleteByTokenHash(hash);
        throw new UnauthenticatedError('Not signed in');
      }
      if (shouldRefreshLastSeen(session.lastSeenAt, now, background)) {
        await sessions.touch(session.id, now);
        return { ...session, lastSeenAt: now };
      }
      return session;
    },
  };
}
