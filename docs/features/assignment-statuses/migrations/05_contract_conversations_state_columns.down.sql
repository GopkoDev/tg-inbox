ALTER TABLE conversations
  ALTER COLUMN customer_message_seq DROP NOT NULL,
  ALTER COLUMN state_version DROP NOT NULL,
  ALTER COLUMN status DROP NOT NULL;
