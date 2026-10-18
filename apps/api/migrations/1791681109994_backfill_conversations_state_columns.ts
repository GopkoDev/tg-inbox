import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/assignment-statuses/migrations/02_backfill_conversations_state_columns.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- Backfill (2/3): no assignee or status exists before this feature, so every existing conversation is open,
-- unassigned, at version 0. The customer message counter starts at the number of captured messages (one row
-- per Telegram message; an edit updates its row in place, so it is never counted twice). The counter only has
-- to grow with every new capture — the close snapshot compares it for equality (ADR-0003).
-- Touches only rows still NULL, so a re-run is a no-op.
UPDATE conversations c
SET status               = COALESCE(c.status, 'open'),
    state_version        = COALESCE(c.state_version, 0),
    customer_message_seq = COALESCE(
      c.customer_message_seq,
      (SELECT count(*)::integer FROM messages m WHERE m.conversation_id = c.id)
    )
WHERE c.status IS NULL
   OR c.state_version IS NULL
   OR c.customer_message_seq IS NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
-- No-op: the backfilled values go away with the columns in 01's down.
SELECT 1;
  `.execute(db);
}
