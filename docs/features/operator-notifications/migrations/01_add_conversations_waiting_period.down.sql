ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_waiting_open_check;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_waiting_pair_check;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_waiting_started_by_check;
ALTER TABLE conversations
  DROP COLUMN IF EXISTS waiting_started_by,
  DROP COLUMN IF EXISTS waiting_since;
