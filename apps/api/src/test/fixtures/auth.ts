import { newId } from '../../platform/ids.js';
import type { Db } from '../../platform/db.js';
import { issueLinkToken } from '../../platform/tokens.js';

const DEFAULT_NOW = new Date('2026-01-01T00:00:00Z');

export async function insertAccount(
  db: Db,
  overrides: Partial<{
    id: string;
    email: string;
    displayName: string;
    passwordHash: string;
    createdAt: Date;
  }> = {},
) {
  const row = {
    id: overrides.id ?? newId(),
    email: overrides.email ?? `user-${newId()}@example.test`,
    display_name: overrides.displayName ?? 'Test User',
    password_hash: overrides.passwordHash ?? '$argon2id$test',
    created_at: overrides.createdAt ?? DEFAULT_NOW,
  };
  await db.insertInto('accounts').values(row).execute();
  return row;
}

/** Inserts a session and returns the raw token alongside the row. */
export async function insertSession(
  db: Db,
  accountId: string,
  overrides: Partial<{ createdAt: Date; lastSeenAt: Date }> = {},
) {
  const { token, hash } = issueLinkToken();
  const createdAt = overrides.createdAt ?? DEFAULT_NOW;
  const row = {
    id: newId(),
    account_id: accountId,
    token_hash: hash,
    created_at: createdAt,
    last_seen_at: overrides.lastSeenAt ?? createdAt,
  };
  await db.insertInto('sessions').values(row).execute();
  return { token, row };
}

/** Inserts a reset link and returns the raw token alongside the row. */
export async function insertResetLink(
  db: Db,
  accountId: string,
  overrides: Partial<{
    state: 'pending' | 'used' | 'superseded';
    expiresAt: Date;
    createdAt: Date;
  }> = {},
) {
  const { token, hash } = issueLinkToken();
  const createdAt = overrides.createdAt ?? DEFAULT_NOW;
  const state = overrides.state ?? 'pending';
  const row = {
    id: newId(),
    account_id: accountId,
    token_hash: hash,
    state,
    expires_at: overrides.expiresAt ?? new Date(createdAt.getTime() + 24 * 3_600_000),
    created_at: createdAt,
    closed_at: state === 'pending' ? null : createdAt,
  };
  await db.insertInto('password_reset_links').values(row).execute();
  return { token, row };
}

export async function insertSignInFailures(db: Db, email: string, times: readonly Date[]) {
  if (times.length === 0) return;
  await db
    .insertInto('sign_in_failures')
    .values(times.map((failed_at) => ({ id: newId(), email, failed_at })))
    .execute();
}
