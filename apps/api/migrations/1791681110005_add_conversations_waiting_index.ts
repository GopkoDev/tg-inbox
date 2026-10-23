import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/operator-notifications/migrations/03_add_conversations_waiting_index.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- The sweep's read of one workspace's open waiting conversations, every 20 s (flow 13, ADR-0005, SAD §7
-- "indexed by waiting_since"): conversations.waitingForPings(workspaceId, …) filters waiting_since IS NOT NULL
-- (only open rows can hold one, conversations_waiting_open_check) and orders by the period start.
-- Partial: answered and closed conversations, the large majority, are left out.
-- Plain CREATE INDEX: the Kysely Migrator wraps every migration in a transaction, so CONCURRENTLY is unavailable
-- (pre-pilot table sizes; see the audit report).
CREATE INDEX IF NOT EXISTS conversations_workspace_id_waiting_since_idx
  ON conversations (workspace_id, waiting_since)
  WHERE waiting_since IS NOT NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS conversations_workspace_id_waiting_since_idx;
  `.execute(db);
}
