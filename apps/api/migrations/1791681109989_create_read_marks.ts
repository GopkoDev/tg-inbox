import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/shared-inbox/migrations/07_create_read_marks.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- read_marks: per member and conversation, the arrival point (messages.received_at) read through (ADR-0005).
-- Unread = customer messages with received_at > GREATEST(read_through_at, memberships.active_since).
-- Upserted with GREATEST so it never moves back. Owned by conversations; account_id is a cross-module FK
-- (conversations -> auth), constraint only.
CREATE TABLE IF NOT EXISTS read_marks (
  id              uuid        NOT NULL,
  workspace_id    uuid        NOT NULL,
  conversation_id uuid        NOT NULL,
  account_id      uuid        NOT NULL,
  read_through_at timestamptz NOT NULL,
  created_at      timestamptz NOT NULL,
  CONSTRAINT read_marks_pkey PRIMARY KEY (id),
  CONSTRAINT read_marks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT read_marks_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations (id),
  CONSTRAINT read_marks_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts (id),
  -- Mark read: upsert ON CONFLICT (flows 2, 5); this member's watermark per list row (flow 4);
  -- FK index for conversation_id.
  CONSTRAINT read_marks_conversation_id_account_id_key UNIQUE (conversation_id, account_id)
);

-- FK index for workspace_id.
CREATE INDEX IF NOT EXISTS read_marks_workspace_id_idx ON read_marks (workspace_id);
-- FK index for account_id.
CREATE INDEX IF NOT EXISTS read_marks_account_id_idx ON read_marks (account_id);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS read_marks_account_id_idx;
DROP INDEX IF EXISTS read_marks_workspace_id_idx;
DROP TABLE IF EXISTS read_marks;
  `.execute(db);
}
