-- Backfill (2/3): no reply exists before this feature, so activity = the newest customer message's arrival.
-- Every captured conversation has at least one message (created in the same capture transaction); the
-- COALESCE to created_at only covers rows written outside capture (none expected).
UPDATE conversations c
SET last_message_received_at = n.newest,
    last_activity_at         = n.newest
FROM (
  SELECT c2.id,
         COALESCE((SELECT max(m.received_at) FROM messages m WHERE m.conversation_id = c2.id), c2.created_at) AS newest
  FROM conversations c2
  WHERE c2.last_activity_at IS NULL
) n
WHERE c.id = n.id;
