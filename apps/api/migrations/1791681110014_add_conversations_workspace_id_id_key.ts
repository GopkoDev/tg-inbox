import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/broadcasts/migrations/03_add_conversations_workspace_id_id_key.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- Target of the composite FK (workspace_id, conversation_id) from broadcast_items (ADR-0010, SAD §8 tenancy):
-- a broadcast item can only name a conversation of its own workspace. Owned by conversations.
-- A unique index, not a constraint, so a re-run is a no-op (IF NOT EXISTS) even once an FK depends on it
-- (the contacts_workspace_id_id_key precedent).
-- Plain CREATE INDEX: the Kysely Migrator wraps every migration in a transaction, so CONCURRENTLY is unavailable
-- (pre-pilot table sizes; see the audit report).
CREATE UNIQUE INDEX IF NOT EXISTS conversations_workspace_id_id_key ON conversations (workspace_id, id);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS conversations_workspace_id_id_key;
  `.execute(db);
}
