-- reply_attempts: the delivery log of a reply (ADR-0004). A member-initiated attempt (send / try again /
-- send again) is inserted in the request's transaction and counts toward the per-member limit (AC-12b);
-- the drain fills in started_at (the "in flight" mark, committed before calling Telegram) and the outcome.
-- An automatic retry ('retry') has no initiator and is inserted by the drain when it starts it.
-- Feeds the duplicate reconciliation of spec §6. Owned by conversations.
CREATE TABLE IF NOT EXISTS reply_attempts (
  id                      uuid        NOT NULL,
  workspace_id            uuid        NOT NULL,
  conversation_id         uuid        NOT NULL,
  reply_id                uuid        NOT NULL,
  kind                    text        NOT NULL,
  initiated_by_account_id uuid        NULL,
  created_at              timestamptz NOT NULL,
  started_at              timestamptz NULL,
  finished_at             timestamptz NULL,
  outcome                 text        NULL,
  CONSTRAINT reply_attempts_pkey PRIMARY KEY (id),
  CONSTRAINT reply_attempts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT reply_attempts_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations (id),
  CONSTRAINT reply_attempts_reply_id_fkey FOREIGN KEY (reply_id) REFERENCES replies (id),
  CONSTRAINT reply_attempts_initiated_by_account_id_fkey
    FOREIGN KEY (initiated_by_account_id) REFERENCES accounts (id),
  CONSTRAINT reply_attempts_kind_check CHECK (kind IN ('send', 'try_again', 'send_again', 'retry')),
  -- Automatic retries have no initiator and never count toward the per-member limit (AC-12b).
  CONSTRAINT reply_attempts_initiator_check CHECK ((kind = 'retry') = (initiated_by_account_id IS NULL)),
  -- accepted / refused permanently / bot unauthorised / not accepted (429, 5xx) / unknown (timeout,
  -- broken connection, stale in-flight) / skipped (a pre-check or the dead-letter handler ended it uncalled).
  CONSTRAINT reply_attempts_outcome_check CHECK (outcome IN (
    'accepted', 'refused', 'bot_unauthorized', 'not_accepted', 'unknown', 'skipped'
  )),
  CONSTRAINT reply_attempts_finished_check CHECK ((outcome IS NULL) = (finished_at IS NULL)),
  -- Only a skipped attempt finishes without having started (no Telegram call was made).
  CONSTRAINT reply_attempts_skipped_check
    CHECK (finished_at IS NULL OR (outcome = 'skipped') = (started_at IS NULL))
);

-- Per-member limit: this member's initiated attempts in this workspace over the last 60 s, under the
-- (workspace, member) advisory lock (flows 1, 7, AC-12b); FK index for workspace_id.
CREATE INDEX IF NOT EXISTS reply_attempts_workspace_id_initiator_created_at_idx
  ON reply_attempts (workspace_id, initiated_by_account_id, created_at);
-- The drain's per-chat pace (newest started attempt of the conversation, >= 1 s ago) and its stale in-flight
-- check (that attempt unfinished and older than the 10 s timeout) (flow 9); FK index for conversation_id.
CREATE INDEX IF NOT EXISTS reply_attempts_conversation_id_started_at_idx
  ON reply_attempts (conversation_id, started_at);
-- The reply's unstarted member-initiated attempt the drain picks up (flow 9); the reconciliation's accepted
-- attempts per reply (spec §6); FK index for reply_id.
CREATE INDEX IF NOT EXISTS reply_attempts_reply_id_idx ON reply_attempts (reply_id);
-- FK index for initiated_by_account_id (the limit index leads with workspace_id).
CREATE INDEX IF NOT EXISTS reply_attempts_initiated_by_account_id_idx
  ON reply_attempts (initiated_by_account_id) WHERE initiated_by_account_id IS NOT NULL;
