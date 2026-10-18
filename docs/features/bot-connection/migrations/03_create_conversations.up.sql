-- conversations: the one continuous thread between a workspace and one contact (AC-07, AC-08, AC-19).
-- contact_id is a cross-module FK (conversations -> contacts): constraint only, conversations never queries contacts.
CREATE TABLE IF NOT EXISTS conversations (
  id               uuid        NOT NULL,
  workspace_id     uuid        NOT NULL,
  contact_id       uuid        NOT NULL,
  telegram_chat_id bigint      NOT NULL,
  created_at       timestamptz NOT NULL,
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT conversations_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts (id),
  -- One conversation per contact (a contact belongs to one workspace, so this is one per (workspace, contact));
  -- FK index for contact_id.
  CONSTRAINT conversations_contact_id_key UNIQUE (contact_id),
  -- Capture upsert and edit lookup by the private chat (flows 2, 8); "has conversations" per workspace (flow 7);
  -- FK index for workspace_id.
  CONSTRAINT conversations_workspace_id_telegram_chat_id_key UNIQUE (workspace_id, telegram_chat_id)
);
