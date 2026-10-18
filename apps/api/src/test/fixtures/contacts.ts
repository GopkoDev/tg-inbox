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
  },
): Promise<string> {
  const id = newId();
  const seen = o.profileSeenAt ?? new Date('2026-10-11T10:00:00Z');
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
    })
    .execute();
  return id;
}
