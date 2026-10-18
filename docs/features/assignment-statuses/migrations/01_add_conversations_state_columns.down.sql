ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_workspace_id_assignee_account_id_fkey;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_customer_message_seq_check;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_state_version_check;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_status_check;
ALTER TABLE conversations
  DROP COLUMN IF EXISTS customer_message_seq,
  DROP COLUMN IF EXISTS state_version,
  DROP COLUMN IF EXISTS assignee_account_id,
  DROP COLUMN IF EXISTS status;
