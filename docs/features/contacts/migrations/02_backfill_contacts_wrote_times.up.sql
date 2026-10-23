-- Backfill: first and last wrote from the send times of the messages already captured (ADR-0005).
-- One-time data migration that reads conversations and messages, which the conversations module owns: the SAD §1
-- decision override. No runtime code reads them for this; capture passes the send time to contacts.
-- A contact has at most one conversation per workspace (conversations_contact_id_key), and messages holds only
-- customer messages (the team's replies live in replies), so min / max of messages.sent_at is exactly
-- "first wrote" / "last wrote". Edits keep sent_at, so they never count.
-- LEAST / GREATEST with the stored value make it safe to re-run after the capture code is deployed: a value
-- capture wrote in the gap is kept when it is wider. Contacts with no message stay NULL.
UPDATE contacts AS c
SET first_wrote_at = LEAST(c.first_wrote_at, w.first_sent_at),
    last_wrote_at  = GREATEST(c.last_wrote_at, w.last_sent_at)
FROM (
  SELECT conv.workspace_id, conv.contact_id, min(m.sent_at) AS first_sent_at, max(m.sent_at) AS last_sent_at
  FROM conversations AS conv
  JOIN messages AS m ON m.conversation_id = conv.id AND m.workspace_id = conv.workspace_id
  GROUP BY conv.workspace_id, conv.contact_id
) AS w
WHERE c.id = w.contact_id
  AND c.workspace_id = w.workspace_id
  AND (c.first_wrote_at IS DISTINCT FROM LEAST(c.first_wrote_at, w.first_sent_at)
       OR c.last_wrote_at IS DISTINCT FROM GREATEST(c.last_wrote_at, w.last_sent_at));
