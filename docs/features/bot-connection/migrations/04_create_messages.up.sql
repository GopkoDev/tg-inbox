-- messages: what an end customer sent to the business bot, captured once and ordered by Telegram's message id
-- (ADR-0003, ADR-0004). telegram_message holds Telegram's message object (media references, AC-09).
CREATE TABLE IF NOT EXISTS messages (
  id                  uuid        NOT NULL,
  workspace_id        uuid        NOT NULL,
  conversation_id     uuid        NOT NULL,
  telegram_message_id bigint      NOT NULL,
  kind                text        NOT NULL,
  body                text        NULL,
  telegram_message    jsonb       NOT NULL,
  sent_at             timestamptz NOT NULL,
  received_at         timestamptz NOT NULL,
  edited_at           timestamptz NULL,
  edit_update_id      bigint      NULL,
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations (id),
  -- Idempotent insert ON CONFLICT DO NOTHING (AC-11, flow 2); edit lookup + conditional update (flow 8);
  -- order within a conversation (ADR-0004); FK index for conversation_id.
  CONSTRAINT messages_conversation_id_telegram_message_id_key UNIQUE (conversation_id, telegram_message_id),
  CONSTRAINT messages_kind_check CHECK (kind IN (
    'text', 'photo', 'video', 'animation', 'voice', 'audio', 'video_note', 'document',
    'sticker', 'location', 'venue', 'contact', 'poll', 'dice', 'other'
  )),
  CONSTRAINT messages_body_text_check CHECK (kind <> 'text' OR body IS NOT NULL),
  CONSTRAINT messages_telegram_message_object_check CHECK (jsonb_typeof(telegram_message) = 'object'),
  -- An edit is applied with its edit time and update id together (AC-10 tie-break).
  CONSTRAINT messages_edit_check CHECK ((edited_at IS NULL) = (edit_update_id IS NULL))
);

-- Newest message of a workspace: "last message received" on the Bot settings page (flow 4); FK index for workspace_id.
CREATE INDEX IF NOT EXISTS messages_workspace_id_received_at_idx ON messages (workspace_id, received_at);
