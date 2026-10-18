import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/shared-inbox/migrations/03_add_conversations_list_columns.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- Expand (1/3): the inbox list's sort and markers, kept on the conversation (SAD §4 supporting choices).
--   last_message_received_at — arrival of the newest customer message (capture; edits never move it)
--   last_reply_sent_at       — when the newest reply was marked "sent" (null until the first one)
--   last_activity_at         — GREATEST of the two: the list order, newest first (AC-01)
-- "Waiting for a reply" = last_reply_sent_at IS NULL OR last_message_received_at > last_reply_sent_at.
-- Nullable until the backfill (04) and the capture/send code that writes them are in; 10 makes them NOT NULL.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_activity_at         timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_message_received_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_reply_sent_at       timestamptz NULL;

-- Inbox list page: a workspace's conversations, newest activity first, keyset on (last_activity_at, id)
-- (flow 4, AC-01; spec §6 list p95 <= 500 ms at 1 000 conversations). Plain CREATE INDEX: the Kysely
-- Migrator runs every migration in a transaction, so CONCURRENTLY is unavailable (see the audit report).
CREATE INDEX IF NOT EXISTS conversations_workspace_id_last_activity_at_idx
  ON conversations (workspace_id, last_activity_at DESC, id DESC);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS conversations_workspace_id_last_activity_at_idx;
ALTER TABLE conversations
  DROP COLUMN IF EXISTS last_reply_sent_at,
  DROP COLUMN IF EXISTS last_message_received_at,
  DROP COLUMN IF EXISTS last_activity_at;
  `.execute(db);
}
