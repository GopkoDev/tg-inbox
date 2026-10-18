ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_last_activity_at_check;
ALTER TABLE conversations
  ALTER COLUMN last_message_received_at DROP NOT NULL,
  ALTER COLUMN last_activity_at DROP NOT NULL;
