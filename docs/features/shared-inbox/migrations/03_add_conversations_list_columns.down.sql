DROP INDEX IF EXISTS conversations_workspace_id_last_activity_at_idx;
ALTER TABLE conversations
  DROP COLUMN IF EXISTS last_reply_sent_at,
  DROP COLUMN IF EXISTS last_message_received_at,
  DROP COLUMN IF EXISTS last_activity_at;
