-- replies: a text a member wrote in a conversation, sent by the business bot (ADR-0008), with its delivery
-- state machine (ADR-0004). Owned by conversations. author_account_id is a cross-module FK (conversations ->
-- auth): constraint only, names come through the workspaces app layer.
CREATE TABLE IF NOT EXISTS replies (
  id                  uuid        NOT NULL,
  workspace_id        uuid        NOT NULL,
  conversation_id     uuid        NOT NULL,
  author_account_id   uuid        NOT NULL,
  client_key          uuid        NOT NULL,
  body                text        NOT NULL,
  state               text        NOT NULL,
  failure_reason      text        NULL,
  position_at         timestamptz NOT NULL,
  sent_at             timestamptz NULL,
  telegram_message_id bigint      NULL,
  created_at          timestamptz NOT NULL,
  CONSTRAINT replies_pkey PRIMARY KEY (id),
  CONSTRAINT replies_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT replies_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations (id),
  CONSTRAINT replies_author_account_id_fkey FOREIGN KEY (author_account_id) REFERENCES accounts (id),
  -- A double press finds the same reply: insert ON CONFLICT DO NOTHING + read back (flow 1, AC-11);
  -- FK index for conversation_id.
  CONSTRAINT replies_conversation_id_client_key_key UNIQUE (conversation_id, client_key),
  -- AC-07: not empty, not only whitespace, at most 4096 characters (the domain checks first, in UTF-16 units).
  CONSTRAINT replies_body_check CHECK (char_length(body) BETWEEN 1 AND 4096 AND body ~ '\S'),
  CONSTRAINT replies_state_check CHECK (state IN ('sending', 'sent', 'not_delivered', 'not_confirmed')),
  CONSTRAINT replies_failure_reason_check CHECK (failure_reason IN (
    'customer_blocked', 'customer_account_gone', 'chat_not_found', 'bot_not_working',
    'author_access_removed', 'telegram_not_accepted', 'delivery_interrupted'
  )),
  -- Only a not-delivered reply carries a reason (AC-09, AC-10, AC-12, AC-13).
  CONSTRAINT replies_failure_reason_state_check CHECK ((state = 'not_delivered') = (failure_reason IS NOT NULL)),
  -- A sent reply holds Telegram's message id and our clock's sent time, nothing else does.
  CONSTRAINT replies_sent_at_state_check CHECK ((state = 'sent') = (sent_at IS NOT NULL)),
  CONSTRAINT replies_telegram_message_id_state_check CHECK ((state = 'sent') = (telegram_message_id IS NOT NULL))
);

-- Thread page before/after a (position_at, id) cursor, merged with messages (flow 5, ADR-0008); the teammate
-- check — another member's reply after the one the composer saw (flows 1, 6, AC-16); the newest "sent" reply
-- for the list row's last item (backward scan, state filter; flow 4).
CREATE INDEX IF NOT EXISTS replies_conversation_id_position_at_idx
  ON replies (conversation_id, position_at, id);
-- The drain: a conversation's pending replies, oldest position first (flow 9, ADR-0004).
CREATE INDEX IF NOT EXISTS replies_pending_idx
  ON replies (conversation_id, position_at, id) WHERE state = 'sending';
-- KPI query: "sent" replies of a workspace per day / first reply times (SAD §7); FK index for workspace_id.
CREATE INDEX IF NOT EXISTS replies_workspace_id_sent_at_idx ON replies (workspace_id, sent_at);
-- FK index for author_account_id.
CREATE INDEX IF NOT EXISTS replies_author_account_id_idx ON replies (author_account_id);
