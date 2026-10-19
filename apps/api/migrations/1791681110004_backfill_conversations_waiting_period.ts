import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/operator-notifications/migrations/02_backfill_conversations_waiting_period.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- Backfill: give every open conversation that is waiting today (the shared-inbox marker:
-- last_reply_sent_at IS NULL OR last_message_received_at > last_reply_sent_at) the start of its current period,
-- by the rules ADR-0007 now applies in the writing transactions:
--   * the last end of a period is the later of the last sent reply and the last close entry;
--   * a member reopen or a failed-reply reopen after that end starts a period at its position_at ('reopen'),
--     if a customer message was already waiting then (received after the last sent reply, at or before the
--     reopen) and no new message arrived after the end before it;
--   * otherwise the period began with the first customer message received after that end ('message');
--     a customer's reopening message is such a first message.
-- Closed conversations, and open ones that are answered, stay NULL (not waiting).
-- Touches only rows still NULL, so a re-run is a no-op for rows already set and fills any row the old code left
-- unset (safe: under the new code an open waiting conversation always has a start).
WITH waiting AS (
  SELECT c.id,
         c.last_reply_sent_at,
         GREATEST(
           c.last_reply_sent_at,
           (SELECT max(a.position_at) FROM conversation_activities a
             WHERE a.conversation_id = c.id AND a.kind = 'closed')
         ) AS ended_at
  FROM conversations c
  WHERE c.status = 'open'
    AND c.waiting_since IS NULL
    AND (c.last_reply_sent_at IS NULL OR c.last_message_received_at > c.last_reply_sent_at)
), starts AS (
  SELECT w.id,
         w.last_reply_sent_at,
         (SELECT min(m.received_at) FROM messages m
           WHERE m.conversation_id = w.id
             AND (w.ended_at IS NULL OR m.received_at > w.ended_at)) AS first_arrival,
         (SELECT max(a.position_at) FROM conversation_activities a
           WHERE a.conversation_id = w.id
             AND a.kind = 'reopened'
             AND a.cause IN ('member', 'reply_not_delivered')
             AND (w.ended_at IS NULL OR a.position_at > w.ended_at)) AS reopened_at
  FROM waiting w
), decided AS (
  SELECT s.id,
         CASE
           WHEN s.reopened_at IS NOT NULL
            AND (s.first_arrival IS NULL OR s.reopened_at < s.first_arrival)
            AND EXISTS (SELECT 1 FROM messages m
                         WHERE m.conversation_id = s.id
                           AND (s.last_reply_sent_at IS NULL OR m.received_at > s.last_reply_sent_at)
                           AND m.received_at <= s.reopened_at)
             THEN 'reopen'
           WHEN s.first_arrival IS NOT NULL
             THEN 'message'
         END AS started_by,
         s.reopened_at,
         s.first_arrival
  FROM starts s
)
UPDATE conversations c
SET waiting_since      = CASE d.started_by WHEN 'reopen' THEN d.reopened_at ELSE d.first_arrival END,
    waiting_started_by = d.started_by
FROM decided d
WHERE c.id = d.id
  AND d.started_by IS NOT NULL
  AND c.waiting_since IS NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
-- No-op: the backfilled values go away with the columns in 01's down.
SELECT 1;
  `.execute(db);
}
