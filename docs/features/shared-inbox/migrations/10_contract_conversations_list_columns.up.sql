-- Contract (3/3): apply only after the capture and reply-sent code that maintains the columns is deployed
-- (04 backfilled the existing rows).
ALTER TABLE conversations
  ALTER COLUMN last_activity_at SET NOT NULL,
  ALTER COLUMN last_message_received_at SET NOT NULL;

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_last_activity_at_check;
-- Activity = the later of the newest customer message and the newest "sent" reply (AC-01); both are written
-- in the same UPDATE, so the list order can never disagree with the markers.
ALTER TABLE conversations ADD CONSTRAINT conversations_last_activity_at_check
  CHECK (last_activity_at = GREATEST(last_message_received_at, last_reply_sent_at));
