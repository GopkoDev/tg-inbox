import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/contacts/migrations/01_add_contacts_wrote_times.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- Expand: when the contact first and last wrote (ADR-0005, SAD §4 choice 5).
--   first_wrote_at / last_wrote_at — the Telegram send times (messages.sent_at) of the contact's oldest and newest
--   own messages. Replies and edits never move them. Capture's contacts.upsertFromProfile(…, sentAt, tx) keeps
--   them with LEAST / GREATEST in the capture transaction (flow 14), so a redelivered duplicate changes nothing.
-- They stay nullable for good: a contact whose messages are all gone has neither and sorts last (SAD §11).
-- 02 backfills them; no contract step.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS first_wrote_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_wrote_at  timestamptz NULL;

-- Both or neither, and never in the wrong order.
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_wrote_pair_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_wrote_pair_check
  CHECK ((first_wrote_at IS NULL) = (last_wrote_at IS NULL));
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_wrote_order_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_wrote_order_check
  CHECK (first_wrote_at <= last_wrote_at);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_wrote_order_check;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_wrote_pair_check;
ALTER TABLE contacts
  DROP COLUMN IF EXISTS last_wrote_at,
  DROP COLUMN IF EXISTS first_wrote_at;
  `.execute(db);
}
