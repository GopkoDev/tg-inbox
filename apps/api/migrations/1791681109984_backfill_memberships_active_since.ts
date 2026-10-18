import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/shared-inbox/migrations/02_backfill_memberships_active_since.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- Backfill (2/3): an existing membership became active when it was created. A membership reactivated before
-- this step gets its creation time (under-estimates the floor; pre-pilot data only — see the audit report).
UPDATE memberships SET active_since = created_at WHERE active_since IS NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
-- No-op: the backfilled values go away with the column in 01's down.
SELECT 1;
  `.execute(db);
}
