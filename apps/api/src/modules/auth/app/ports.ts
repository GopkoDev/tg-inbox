import type { Db } from '../../../platform/db.js';

/** A Kysely handle or a transaction (Transaction extends Kysely); callers pass it to join their unit of work. */
export type Executor = Db;

export interface Account {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: Date;
}

export interface Session {
  id: string;
  accountId: string;
  tokenHash: Buffer;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface ResetLinkRecord {
  id: string;
  accountId: string;
  tokenHash: Buffer;
  state: 'pending' | 'used' | 'superseded';
  expiresAt: Date;
  createdAt: Date;
  closedAt: Date | null;
}

/** Accounts are platform-level; `email` is always the normalised form. */
export interface AccountRepo {
  /** Rejects with a Postgres unique violation (23505) when the email is taken. */
  insert(
    input: { email: string; displayName: string; passwordHash: string; now: Date },
    tx?: Executor,
  ): Promise<Account>;
  findByEmail(email: string, tx?: Executor): Promise<Account | undefined>;
  findById(id: string, tx?: Executor): Promise<Account | undefined>;
  findByIds(ids: readonly string[], tx?: Executor): Promise<Account[]>;
  updatePasswordHash(id: string, passwordHash: string, tx?: Executor): Promise<void>;
}

export interface SessionRepo {
  insert(
    input: { accountId: string; tokenHash: Buffer; now: Date },
    tx?: Executor,
  ): Promise<Session>;
  findByTokenHash(tokenHash: Buffer, tx?: Executor): Promise<Session | undefined>;
  findByIds(ids: readonly string[], tx?: Executor): Promise<Session[]>;
  deleteByTokenHash(tokenHash: Buffer, tx?: Executor): Promise<void>;
  /** Deletes every session of the account, optionally sparing one; returns the number removed. */
  deleteByAccount(
    accountId: string,
    options?: { exceptSessionId?: string },
    tx?: Executor,
  ): Promise<number>;
  touch(sessionId: string, now: Date, tx?: Executor): Promise<void>;
}

export interface SignInFailureRepo {
  record(email: string, now: Date, tx?: Executor): Promise<void>;
  /** Failure times of the email within the 30 minutes before `now`. */
  listRecent(email: string, now: Date, tx?: Executor): Promise<Date[]>;
  clear(email: string, tx?: Executor): Promise<void>;
}

/**
 * Serialises work per normalised email: runs `fn` while holding an exclusive lock on the email,
 * handing it the executor (a transaction) to pass to every repo call. `fn` must return its outcome
 * rather than throw, so the writes it made are committed.
 */
export type EmailLock = <T>(
  email: string,
  fn: (tx: Executor | undefined) => Promise<T>,
) => Promise<T>;

export interface ResetLinkRepo {
  insert(
    input: { accountId: string; tokenHash: Buffer; expiresAt: Date; now: Date },
    tx?: Executor,
  ): Promise<ResetLinkRecord>;
  /** Marks every pending link of the account superseded; no-op when there is none. */
  supersedePending(accountId: string, now: Date, tx?: Executor): Promise<void>;
  findByTokenHash(tokenHash: Buffer, tx?: Executor): Promise<ResetLinkRecord | undefined>;
  /** Atomically pending -> used if unexpired at `now`; returns the link, or undefined if not consumed. */
  consume(tokenHash: Buffer, now: Date, tx?: Executor): Promise<ResetLinkRecord | undefined>;
}

/** Runs `fn` in one database transaction, handing it the executor to pass to every repo call. */
export type Transaction = <T>(fn: (tx: Executor | undefined) => Promise<T>) => Promise<T>;

export interface PasswordHasher {
  /** Returns an argon2id PHC string. */
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
  /** One real verification against a fixed hash, for unknown emails; always false. */
  verifyDummy(password: string): Promise<false>;
}
