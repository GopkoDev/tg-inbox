-- broadcast_items: a broadcast as shown in one recipient's conversation thread (ADR-0010, AC-16). Owned by
-- conversations: written through conversations.recordBroadcastItem(tx, …) in the recipient's outcome transaction
-- (delivered, or not confirmed — also when a dead link's in-flight send is resolved, flow 14). Never updates a
-- column of conversations: status, assignee, state version, waiting, last activity and read marks stay.
--   state       — 'delivered' (position_at = when the answer was recorded) or 'not_confirmed' (position_at = the
--                 claim time, the time the send was made).
--   position_at — the thread position, in the same keyset as messages, replies and activity entries.
--   telegram_message_id — Telegram's id of the delivered message.
-- broadcast_id is a cross-module composite FK to broadcasts, constraint only: inbox adds the name, text and
-- launching owner from the broadcasts app layer (itemDetails). conversations never reads broadcasts.
CREATE TABLE IF NOT EXISTS broadcast_items (
  id                  uuid        NOT NULL,
  workspace_id        uuid        NOT NULL,
  conversation_id     uuid        NOT NULL,
  broadcast_id        uuid        NOT NULL,
  state               text        NOT NULL,
  position_at         timestamptz NOT NULL,
  telegram_message_id bigint      NULL,
  created_at          timestamptz NOT NULL,
  CONSTRAINT broadcast_items_pkey PRIMARY KEY (id),
  CONSTRAINT broadcast_items_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT broadcast_items_conversation_fkey
    FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversations (workspace_id, id),
  CONSTRAINT broadcast_items_broadcast_fkey
    FOREIGN KEY (workspace_id, broadcast_id) REFERENCES broadcasts (workspace_id, id),
  -- One item per broadcast and conversation: a recipient never shows the same broadcast twice (SAD §8 integrity
  -- "recipients with more than one broadcast item"); FK index for the broadcast composite FK.
  CONSTRAINT broadcast_items_broadcast_conversation_key UNIQUE (workspace_id, broadcast_id, conversation_id),
  CONSTRAINT broadcast_items_state_check CHECK (state IN ('delivered', 'not_confirmed')),
  -- Only a delivered item holds Telegram's message id, and every delivered one does.
  CONSTRAINT broadcast_items_telegram_message_id_state_check CHECK (
    (state = 'delivered') = (telegram_message_id IS NOT NULL)
  )
);

-- Thread page before/after a (position_at, kind, id) cursor, the broadcast-item part of the thread merge (flow 18,
-- ADR-0010); FK index for workspace_id and the conversation composite FK.
CREATE INDEX IF NOT EXISTS broadcast_items_conversation_position_at_idx
  ON broadcast_items (workspace_id, conversation_id, position_at, id);
