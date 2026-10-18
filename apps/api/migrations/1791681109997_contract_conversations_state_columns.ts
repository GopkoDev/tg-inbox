import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/assignment-statuses/migrations/05_contract_conversations_state_columns.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- Contract (3/3): apply only after the code that writes the columns is deployed — capture inserts a new
-- conversation as status 'open', state_version 0, customer_message_seq 0 and raises the counter under the row
-- lock; every change raises state_version — and the test fixtures write them (02 backfilled existing rows).
-- assignee_account_id stays nullable: "unassigned" is a valid state.
ALTER TABLE conversations
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN state_version SET NOT NULL,
  ALTER COLUMN customer_message_seq SET NOT NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
ALTER TABLE conversations
  ALTER COLUMN customer_message_seq DROP NOT NULL,
  ALTER COLUMN state_version DROP NOT NULL,
  ALTER COLUMN status DROP NOT NULL;
  `.execute(db);
}
