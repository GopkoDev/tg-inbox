-- Expand (1/3): the conversation's owner and done-state, its optimistic-concurrency version and its
-- close-snapshot counter, kept on the conversation (SAD §4 choices 1-3, ADR-0001, ADR-0002, ADR-0003).
--   status               — 'open' | 'closed' (AC-05); a new conversation is captured 'open'
--   assignee_account_id  — at most one assignee, or none (AC-02); always a member of the same workspace
--                          (composite FK below); "active" is guaranteed by the lock protocol (ADR-0005)
--   state_version        — raised in the same UPDATE as every assignee or status change, member or
--                          automatic; the client echoes it with each change (ADR-0002)
--   customer_message_seq — raised by capture, under the row lock, for every newly captured customer
--                          message; follows commit order, unlike arrival timestamps (ADR-0003)
-- status / state_version / customer_message_seq are nullable until the backfill (02) and the code that writes
-- them are in; 05 makes them NOT NULL. A NULL passes the value CHECKs, so the CHECKs can land now.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS status               text    NULL,
  ADD COLUMN IF NOT EXISTS assignee_account_id  uuid    NULL,
  ADD COLUMN IF NOT EXISTS state_version        integer NULL,
  ADD COLUMN IF NOT EXISTS customer_message_seq integer NULL;

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_status_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('open', 'closed'));

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_state_version_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_state_version_check
  CHECK (state_version >= 0);

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_customer_message_seq_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_customer_message_seq_check
  CHECK (customer_message_seq >= 0);

-- An assignee is a member of the conversation's own workspace (AC-04, spec §6 "Single assignee"): a
-- cross-module FK (conversations -> workspaces' memberships), constraint only — conversations never reads
-- memberships; active members come through workspaces.lockActiveMembers (ADR-0005). MATCH SIMPLE: an
-- unassigned row (NULL) is not checked. The FK index is conversations_workspace_id_assignee_status_idx (04).
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_workspace_id_assignee_account_id_fkey;
ALTER TABLE conversations ADD CONSTRAINT conversations_workspace_id_assignee_account_id_fkey
  FOREIGN KEY (workspace_id, assignee_account_id) REFERENCES memberships (workspace_id, account_id);
