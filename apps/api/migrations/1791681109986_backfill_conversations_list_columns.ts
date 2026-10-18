import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/shared-inbox/migrations/04_backfill_conversations_list_columns.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- Backfill (2/3): no reply exists before this feature, so activity = the newest customer message's arrival.
-- Every captured conversation has at least one message (created in the same capture transaction); the
-- COALESCE to created_at only covers rows written outside capture (none expected).
UPDATE conversations c
SET last_message_received_at = n.newest,
    last_activity_at         = n.newest
FROM (
  SELECT c2.id,
         COALESCE((SELECT max(m.received_at) FROM messages m WHERE m.conversation_id = c2.id), c2.created_at) AS newest
  FROM conversations c2
  WHERE c2.last_activity_at IS NULL
) n
WHERE c.id = n.id;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
-- No-op: the backfilled values go away with the columns in 03's down.
SELECT 1;
  `.execute(db);
}
