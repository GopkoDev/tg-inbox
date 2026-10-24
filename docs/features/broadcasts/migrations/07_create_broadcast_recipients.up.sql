-- broadcast_recipients: the frozen recipient list of a launched broadcast and each recipient's outcome (ADR-0006,
-- ADR-0007, ADR-0009, AC-06, AC-11, AC-12, AC-18). Owned by broadcasts. Inserted only by the launch, in the launch
-- transaction; never inserted or deleted afterwards (spec §6 frozen recipients).
--   position         — 1…n in the order the fingerprint sorts the reachable contact ids (by contact id): the send
--                      order within a broadcast and the report's keyset (flows 10, 11, 14).
--   telegram_user_id — the private chat to send to, copied from the contact at launch.
--   state            — 'waiting' → 'sending' (the claim, committed before the Telegram call: a conditional
--                      single-row UPDATE … WHERE state = 'waiting', the at-most-once key) → 'delivered' / 'blocked'
--                      (blocked the bot) / 'failed' / 'not_confirmed' (no answer, never sent again); 'waiting' →
--                      'stopped' (settled by a stop) / 'failed' (settled by an abort) / 'blocked' (blocked at the
--                      turn, no send); 'sending' → 'waiting' only on a rate limit (nothing was sent).
--   failure_reason   — only for 'failed': 'account_gone', 'chat_not_found', 'telegram_error' (one recipient) or
--                      'text_refused', 'bot_stopped' (the abort, ADR-0009).
--   claimed_at       — the claim time of the current attempt: the not confirmed broadcast item sits there (AC-16).
--   outcome_at       — when the outcome was recorded (the report's time).
--   telegram_message_id — Telegram's id of the delivered message.
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id                  uuid        NOT NULL,
  workspace_id        uuid        NOT NULL,
  broadcast_id        uuid        NOT NULL,
  contact_id          uuid        NOT NULL,
  position            integer     NOT NULL,
  telegram_user_id    bigint      NOT NULL,
  state               text        NOT NULL,
  failure_reason      text        NULL,
  claimed_at          timestamptz NULL,
  outcome_at          timestamptz NULL,
  telegram_message_id bigint      NULL,
  CONSTRAINT broadcast_recipients_pkey PRIMARY KEY (id),
  CONSTRAINT broadcast_recipients_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT broadcast_recipients_broadcast_fkey
    FOREIGN KEY (workspace_id, broadcast_id) REFERENCES broadcasts (workspace_id, id),
  CONSTRAINT broadcast_recipients_contact_fkey
    FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts (workspace_id, id),
  -- A contact is a recipient of a broadcast at most once (AC-06 "each recipient one message"); the duplicate's
  -- group from recipients (flow 15); FK index for workspace_id and the broadcast composite FK.
  CONSTRAINT broadcast_recipients_broadcast_contact_key UNIQUE (workspace_id, broadcast_id, contact_id),
  -- The report's recipients in position order after a cursor (flow 11).
  CONSTRAINT broadcast_recipients_broadcast_position_key UNIQUE (workspace_id, broadcast_id, position),
  CONSTRAINT broadcast_recipients_position_check CHECK (position >= 1),
  CONSTRAINT broadcast_recipients_state_check CHECK (
    state IN ('waiting', 'sending', 'delivered', 'blocked', 'failed', 'not_confirmed', 'stopped')
  ),
  CONSTRAINT broadcast_recipients_failure_reason_check CHECK (
    failure_reason IN ('account_gone', 'chat_not_found', 'telegram_error', 'text_refused', 'bot_stopped')
  ),
  -- Only a failed recipient carries a reason, and every failed one does (AC-11, AC-12).
  CONSTRAINT broadcast_recipients_failure_reason_state_check CHECK ((state = 'failed') = (failure_reason IS NOT NULL)),
  -- A recipient with an outcome has its time; a waiting or in-flight one has none.
  CONSTRAINT broadcast_recipients_outcome_at_state_check CHECK (
    (state IN ('waiting', 'sending')) = (outcome_at IS NULL)
  ),
  -- Claimed exactly for the states that only a send reaches; never for waiting or stopped ones.
  CONSTRAINT broadcast_recipients_claimed_at_state_check CHECK (
    (state NOT IN ('sending', 'delivered', 'not_confirmed') OR claimed_at IS NOT NULL)
    AND (state NOT IN ('waiting', 'stopped') OR claimed_at IS NULL)
  ),
  -- Only a delivered recipient holds Telegram's message id, and every delivered one does.
  CONSTRAINT broadcast_recipients_telegram_message_id_state_check CHECK (
    (state = 'delivered') = (telegram_message_id IS NOT NULL)
  )
);

-- Totals by state (flow 11), the next waiting recipient in position order (flow 14), recipients still sending
-- after a dead link (flow 14), the report narrowed to one outcome (flow 11), the settling update of a stop or an
-- abort (seeded flow 4, flow 13), "nothing waiting or in flight" (flow 13), the duplicate's "did not reach" set
-- (flow 15) and the blocked-share measure over delivered recipients (SAD §4).
CREATE INDEX IF NOT EXISTS broadcast_recipients_state_position_idx
  ON broadcast_recipients (workspace_id, broadcast_id, state, position);
-- FK index for (workspace_id, contact_id); the hand erasure of a contact (spec OQ-4).
CREATE INDEX IF NOT EXISTS broadcast_recipients_workspace_id_contact_id_idx
  ON broadcast_recipients (workspace_id, contact_id);
