-- Expand: when the conversation's current waiting period began, and what began it (ADR-0007, SAD §4).
--   waiting_since      — the arrival of the customer message that made the conversation waiting ('message'), or
--                        the reopen time when a reopen found the customer still waiting ('reopen'). The period's
--                        identity in the ping ledger (ping_items unique key) and the start of its 5 / 30 min marks.
--   waiting_started_by — 'message' | 'reopen'. Having read the messages holds a ping back only after 'message'
--                        (AC-07).
-- Both are set and cleared together, in the transactions that start and end a period: capture (start by message,
-- unless already waiting), reply marked sent and close (end), member reopen and failed-reply reopen while the
-- customer still waits (start by reopen). An assignee change never touches them (AC-08). They stay nullable for
-- good: NULL means "not waiting". 02 backfills them; no contract step.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS waiting_since      timestamptz NULL,
  ADD COLUMN IF NOT EXISTS waiting_started_by text        NULL;

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_waiting_started_by_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_waiting_started_by_check
  CHECK (waiting_started_by IN ('message', 'reopen'));

-- A period has a start and a start kind, or neither.
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_waiting_pair_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_waiting_pair_check
  CHECK ((waiting_since IS NULL) = (waiting_started_by IS NULL));

-- A close ends the period in the same UPDATE, so a closed conversation is never waiting. Every reopen sets
-- status 'open' first, so this holds on every path (existing rows: both NULL until 02).
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_waiting_open_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_waiting_open_check
  CHECK (status = 'open' OR waiting_since IS NULL);
