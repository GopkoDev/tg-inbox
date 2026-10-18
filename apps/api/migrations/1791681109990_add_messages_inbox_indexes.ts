import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/shared-inbox/migrations/08_add_messages_inbox_indexes.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- Two read paths on the existing messages table. Plain CREATE INDEX: the Kysely Migrator wraps every
-- migration in a transaction, so CONCURRENTLY is unavailable (pre-pilot table sizes; see the audit report).

-- Unread count per list row: customer messages arrived after the member's floor (flows 4, 10, ADR-0005);
-- the list row's last message by arrival (flow 4).
CREATE INDEX IF NOT EXISTS messages_conversation_id_received_at_idx
  ON messages (conversation_id, received_at);
-- Thread page before/after a (sent_at, telegram_message_id) cursor, merged with replies (flow 5, ADR-0008;
-- spec §6 thread p95 <= 500 ms on a 5 000-message conversation).
CREATE INDEX IF NOT EXISTS messages_conversation_id_sent_at_idx
  ON messages (conversation_id, sent_at, telegram_message_id);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS messages_conversation_id_sent_at_idx;
DROP INDEX IF EXISTS messages_conversation_id_received_at_idx;
  `.execute(db);
}
