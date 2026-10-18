DROP INDEX IF EXISTS reply_attempts_initiated_by_account_id_idx;
DROP INDEX IF EXISTS reply_attempts_reply_id_idx;
DROP INDEX IF EXISTS reply_attempts_conversation_id_started_at_idx;
DROP INDEX IF EXISTS reply_attempts_workspace_id_initiator_created_at_idx;
DROP TABLE IF EXISTS reply_attempts;
