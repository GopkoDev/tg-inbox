import type { Kysely } from 'kysely';
import type { DB } from '../../platform/db.types.gen.js';
import { newId } from '../../platform/ids.js';

let nextTelegramUserId = 800000n;

/** A contacts row inserted directly (PII guard: `Test User`, synthetic ids). Returns its id. */
export async function insertContact(
  db: Kysely<DB>,
  o: {
    workspaceId: string;
    telegramUserId?: bigint;
    firstName?: string;
    username?: string | null;
    languageCode?: string | null;
    profileSeenAt?: Date;
    /** Both default to null, or to `profileSeenAt` when either is given (the pair check). */
    firstWroteAt?: Date | null;
    lastWroteAt?: Date | null;
  },
): Promise<string> {
  const id = newId();
  const seen = o.profileSeenAt ?? new Date('2026-10-11T10:00:00Z');
  const given = o.firstWroteAt !== undefined || o.lastWroteAt !== undefined;
  const firstWroteAt = o.firstWroteAt === undefined ? (given ? seen : null) : o.firstWroteAt;
  const lastWroteAt = o.lastWroteAt === undefined ? (given ? seen : null) : o.lastWroteAt;
  await db
    .insertInto('contacts')
    .values({
      id,
      workspace_id: o.workspaceId,
      telegram_user_id: o.telegramUserId ?? nextTelegramUserId++,
      first_name: o.firstName ?? 'Test User',
      last_name: null,
      username: o.username ?? null,
      language_code: o.languageCode === undefined ? 'en' : o.languageCode,
      profile_seen_at: seen,
      created_at: seen,
      first_wrote_at: firstWroteAt,
      last_wrote_at: lastWroteAt,
    })
    .execute();
  return id;
}
