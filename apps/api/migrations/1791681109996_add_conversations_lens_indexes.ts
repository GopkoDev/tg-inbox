import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/assignment-statuses/migrations/04_add_conversations_lens_indexes.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- Two list-lens read paths on the existing conversations table (SAD §4 "List lenses", flow 4, AC-01;
-- spec §6 list p95 <= 500 ms per lens at 1 000 conversations). Plain CREATE INDEX: the Kysely Migrator wraps
-- every migration in a transaction, so CONCURRENTLY is unavailable (pre-pilot table sizes; see the audit report).
-- The existing conversations_workspace_id_last_activity_at_idx stays: search sets the status lens aside.

-- Status lens with assignee "all": a workspace's open (or closed) conversations, newest activity first,
-- keyset on (last_activity_at, id).
CREATE INDEX IF NOT EXISTS conversations_workspace_id_status_idx
  ON conversations (workspace_id, status, last_activity_at DESC, id DESC);
-- Assignee lens "mine" (= the caller) or "unassigned" (IS NULL) within a status, same order (flow 4); the
-- deactivation unassign of one account's conversations in one workspace, open and closed (flow 12, ADR-0005);
-- FK index for (workspace_id, assignee_account_id).
CREATE INDEX IF NOT EXISTS conversations_workspace_id_assignee_status_idx
  ON conversations (workspace_id, assignee_account_id, status, last_activity_at DESC, id DESC);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS conversations_workspace_id_assignee_status_idx;
DROP INDEX IF EXISTS conversations_workspace_id_status_idx;
  `.execute(db);
}
