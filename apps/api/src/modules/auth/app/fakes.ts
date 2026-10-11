import { newId } from '../../../platform/ids.js';
import type {
  Account,
  AccountRepo,
  EmailLock,
  PasswordHasher,
  ResetLinkRecord,
  ResetLinkRepo,
  Session,
  SessionRepo,
  SignInFailureRepo,
  Transaction,
} from './ports.js';

/** In-memory port fakes for unit tests of the auth use cases. */
export function fakeAccountRepo(): AccountRepo & { rows: Account[] } {
  const rows: Account[] = [];
  return {
    rows,
    async insert(input) {
      const account: Account = {
        id: newId(),
        email: input.email,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        createdAt: input.now,
      };
      rows.push(account);
      return account;
    },
    async findByEmail(email) {
      return rows.find((a) => a.email === email);
    },
    async findById(id) {
      return rows.find((a) => a.id === id);
    },
    async findByIds(ids) {
      return rows.filter((a) => ids.includes(a.id));
    },
    async updatePasswordHash(id, passwordHash) {
      const a = rows.find((r) => r.id === id);
      if (a) a.passwordHash = passwordHash;
    },
  };
}

export function fakeSessionRepo(): SessionRepo & { rows: Session[]; touches: number } {
  const rows: Session[] = [];
  const repo = {
    rows,
    touches: 0,
    async insert(input: { accountId: string; tokenHash: Buffer; now: Date }) {
      const s: Session = {
        id: newId(),
        accountId: input.accountId,
        tokenHash: input.tokenHash,
        createdAt: input.now,
        lastSeenAt: input.now,
      };
      rows.push(s);
      return s;
    },
    async findByTokenHash(hash: Buffer) {
      return rows.find((s) => s.tokenHash.equals(hash));
    },
    async deleteByTokenHash(hash: Buffer) {
      const i = rows.findIndex((s) => s.tokenHash.equals(hash));
      if (i >= 0) rows.splice(i, 1);
    },
    async deleteByAccount(accountId: string, options?: { exceptSessionId?: string }) {
      const keep = rows.filter(
        (s) => s.accountId !== accountId || s.id === options?.exceptSessionId,
      );
      const removed = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return removed;
    },
    async touch(sessionId: string, now: Date) {
      const s = rows.find((r) => r.id === sessionId);
      if (s) s.lastSeenAt = now;
      repo.touches += 1;
    },
  };
  return repo;
}

export function fakeFailureRepo(): SignInFailureRepo & { rows: { email: string; at: Date }[] } {
  const rows: { email: string; at: Date }[] = [];
  return {
    rows,
    async record(email, now) {
      rows.push({ email, at: now });
    },
    async listRecent(email, now) {
      const from = now.getTime() - 30 * 60_000;
      return rows.filter((r) => r.email === email && r.at.getTime() >= from).map((r) => r.at);
    },
    async clear(email) {
      const keep = rows.filter((r) => r.email !== email);
      rows.splice(0, rows.length, ...keep);
    },
  };
}

/** Trivial hasher: no argon2 cost in unit tests. */
export function fakeHasher(): PasswordHasher & { dummyCalls: number } {
  const h = {
    dummyCalls: 0,
    async hash(password: string) {
      return `fake$${password}`;
    },
    async verify(passwordHash: string, password: string) {
      return passwordHash === `fake$${password}`;
    },
    async verifyDummy() {
      h.dummyCalls += 1;
      return false as const;
    },
  };
  return h;
}

export function fakeResetLinkRepo(): ResetLinkRepo & { rows: ResetLinkRecord[] } {
  const rows: ResetLinkRecord[] = [];
  return {
    rows,
    async insert(input) {
      const r: ResetLinkRecord = {
        id: newId(),
        accountId: input.accountId,
        tokenHash: input.tokenHash,
        state: 'pending',
        expiresAt: input.expiresAt,
        createdAt: input.now,
        closedAt: null,
      };
      rows.push(r);
      return r;
    },
    async supersedePending(accountId, now) {
      for (const r of rows) {
        if (r.accountId === accountId && r.state === 'pending') {
          r.state = 'superseded';
          r.closedAt = now;
        }
      }
    },
    async findByTokenHash(tokenHash) {
      return rows.find((r) => r.tokenHash.equals(tokenHash));
    },
    async consume(tokenHash, now) {
      const r = rows.find((x) => x.tokenHash.equals(tokenHash));
      if (!r || r.state !== 'pending' || r.expiresAt.getTime() <= now.getTime()) return undefined;
      r.state = 'used';
      r.closedAt = now;
      return r;
    },
  };
}

/** Runs the unit of work without a real transaction. */
export const fakeTransaction: Transaction = (fn) => fn(undefined);

/** Per-email mutex: queued callers run one at a time, in order. */
export function fakeEmailLock(): EmailLock {
  const tails = new Map<string, Promise<unknown>>();
  return async (email, fn) => {
    const prev = tails.get(email) ?? Promise.resolve();
    const run = prev.then(() => fn(undefined));
    tails.set(
      email,
      run.catch(() => undefined),
    );
    return run;
  };
}
