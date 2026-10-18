import type { Kysely } from 'kysely';
import type { DB } from '../../platform/db.types.gen.js';
import { newId } from '../../platform/ids.js';
import { issueLinkToken } from '../../platform/tokens.js';

export const T0 = new Date('2026-03-01T00:00:00Z');
export const WEEK = 7 * 86_400_000;

/** Minimal account row (FK target of memberships) inserted directly — no dependency on auth repos. */
export async function insertAccountRow(
  db: Kysely<DB>,
  email = `${newId()}@x.com`,
): Promise<string> {
  const id = newId();
  await db
    .insertInto('accounts')
    .values({ id, email, display_name: 'Test', password_hash: 'h', created_at: T0 })
    .execute();
  return id;
}

export async function insertWorkspace(db: Kysely<DB>, name = 'Acme'): Promise<string> {
  const id = newId();
  await db.insertInto('workspaces').values({ id, name, created_at: T0 }).execute();
  return id;
}

export async function insertMembership(
  db: Kysely<DB>,
  workspaceId: string,
  opts: {
    accountId?: string;
    role?: 'owner' | 'operator';
    state?: 'active' | 'deactivated';
    lastUsedAt?: Date | null;
    activeSince?: Date;
  } = {},
): Promise<{ id: string; accountId: string }> {
  const id = newId();
  const accountId = opts.accountId ?? (await insertAccountRow(db));
  const state = opts.state ?? 'active';
  await db
    .insertInto('memberships')
    .values({
      id,
      workspace_id: workspaceId,
      account_id: accountId,
      role: opts.role ?? 'operator',
      state,
      last_used_at: opts.lastUsedAt ?? null,
      deactivated_at: state === 'deactivated' ? T0 : null,
      created_at: T0,
      active_since: opts.activeSince ?? T0,
    })
    .execute();
  return { id, accountId };
}

/** Returns the raw token alongside the invitation id and hash. */
export async function insertInvitation(
  db: Kysely<DB>,
  workspaceId: string,
  opts: {
    email?: string;
    role?: 'owner' | 'operator';
    state?: 'pending' | 'accepted' | 'revoked' | 'superseded';
    expiresAt?: Date;
  } = {},
): Promise<{ id: string; token: string; tokenHash: Buffer; email: string }> {
  const { token, hash } = issueLinkToken();
  const id = newId();
  const email = opts.email ?? `${newId()}@x.com`;
  const state = opts.state ?? 'pending';
  await db
    .insertInto('invitations')
    .values({
      id,
      workspace_id: workspaceId,
      email,
      role: opts.role ?? 'operator',
      token_hash: hash,
      state,
      expires_at: opts.expiresAt ?? new Date(T0.getTime() + WEEK),
      created_at: T0,
      closed_at: state === 'pending' ? null : T0,
    })
    .execute();
  return { id, token, tokenHash: hash, email };
}

export async function twoWorkspaces(db: Kysely<DB>): Promise<{ a: string; b: string }> {
  return { a: await insertWorkspace(db, 'A'), b: await insertWorkspace(db, 'B') };
}
