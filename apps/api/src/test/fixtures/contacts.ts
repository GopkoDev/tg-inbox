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
    /**
     * Opt-in: also writes a "wrote" reach row for this Telegram bot (wrote_at = first wrote,
     * changed_at = last wrote), and gives the contact wrote times like `firstWroteAt` would.
     */
    reachForBot?: bigint;
  },
): Promise<string> {
  const id = newId();
  const seen = o.profileSeenAt ?? new Date('2026-10-11T10:00:00Z');
  const given =
    o.firstWroteAt !== undefined || o.lastWroteAt !== undefined || o.reachForBot !== undefined;
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
  if (o.reachForBot !== undefined) {
    await insertReach(db, {
      workspaceId: o.workspaceId,
      contactId: id,
      telegramBotId: o.reachForBot,
      wroteAt: firstWroteAt ?? seen,
      changedAt: lastWroteAt ?? seen,
    });
  }
  return id;
}

/**
 * A contact_bot_reach row written directly. `changedAt` defaults to the latest of `wroteAt` and
 * `blockedAt`, or now when neither is given (the `<= changed_at` checks hold).
 */
export async function insertReach(
  db: Kysely<DB>,
  o: {
    workspaceId: string;
    contactId: string;
    telegramBotId: bigint;
    wroteAt?: Date | null;
    blockedAt?: Date | null;
    changedAt?: Date;
  },
): Promise<void> {
  const facts = [o.wroteAt, o.blockedAt].filter((d): d is Date => d instanceof Date);
  const changedAt =
    o.changedAt ??
    (facts.length > 0 ? new Date(Math.max(...facts.map((d) => d.getTime()))) : new Date());
  await db
    .insertInto('contact_bot_reach')
    .values({
      workspace_id: o.workspaceId,
      contact_id: o.contactId,
      telegram_bot_id: o.telegramBotId,
      wrote_at: o.wroteAt ?? null,
      blocked_at: o.blockedAt ?? null,
      changed_at: changedAt,
    })
    .execute();
}
