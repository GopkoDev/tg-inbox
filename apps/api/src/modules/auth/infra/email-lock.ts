import { sql } from 'kysely';
import type { Db } from '../../../platform/db.js';
import type { EmailLock } from '../app/ports.js';

/**
 * Serialises sign-in work per normalised email with a transaction-scoped Postgres advisory lock.
 * Everything `fn` does through the handed executor runs in that transaction and commits with it.
 */
export function createEmailLock(db: Db): EmailLock {
  return (email, fn) =>
    db.transaction().execute(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'sign-in:' + email}))`.execute(tx);
      return fn(tx);
    });
}
