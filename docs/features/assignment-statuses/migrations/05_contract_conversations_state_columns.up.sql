-- Contract (3/3): apply only after the code that writes the columns is deployed — capture inserts a new
-- conversation as status 'open', state_version 0, customer_message_seq 0 and raises the counter under the row
-- lock; every change raises state_version — and the test fixtures write them (02 backfilled existing rows).
-- assignee_account_id stays nullable: "unassigned" is a valid state.
ALTER TABLE conversations
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN state_version SET NOT NULL,
  ALTER COLUMN customer_message_seq SET NOT NULL;
