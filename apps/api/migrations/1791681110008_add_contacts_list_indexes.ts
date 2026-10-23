import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/contacts/migrations/03_add_contacts_list_indexes.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- The Contacts list's keyset (flows 4, 5, ADR-0005, SAD §10 QG-3 "EXPLAIN checks that the list uses the keyset
-- index"): contacts of one workspace by last wrote, newest first, ties by id, contacts that never wrote last.
-- The page after a cursor (t, id) reads
--   (last_wrote_at < t OR (last_wrote_at = t AND id < $id) OR last_wrote_at IS NULL)  -- cursor in the dated part
--   (last_wrote_at IS NULL AND id < $id)                                              -- cursor in the NULL tail
-- Matching and total counts scan the same workspace prefix (bounded at pilot scale, SAD §7).
-- Plain CREATE INDEX: the Kysely Migrator wraps every migration in a transaction, so CONCURRENTLY is unavailable
-- (pre-pilot table sizes; see the audit report).
CREATE INDEX IF NOT EXISTS contacts_workspace_id_last_wrote_at_id_idx
  ON contacts (workspace_id, last_wrote_at DESC NULLS LAST, id DESC);

-- Target of the composite FKs (workspace_id, contact_id) from contact_tags and contact_tag_history (ADR-0004):
-- a link or entry can only name a contact of its own workspace. Also the profile's read of a contact by
-- (workspace, id) (flow 6) and the member add / remove "lock the contact row of K in W" (flows 8, 10).
-- A unique index, not a constraint, so a re-run is a no-op (IF NOT EXISTS) even once FKs depend on it.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_workspace_id_id_key ON contacts (workspace_id, id);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS contacts_workspace_id_id_key;
DROP INDEX IF EXISTS contacts_workspace_id_last_wrote_at_id_idx;
  `.execute(db);
}
