-- contacts: an end customer as known to one workspace, built from their Telegram profile (AC-07, AC-08, AC-13).
CREATE TABLE IF NOT EXISTS contacts (
  id               uuid        NOT NULL,
  workspace_id     uuid        NOT NULL,
  telegram_user_id bigint      NOT NULL,
  first_name       text        NOT NULL,
  last_name        text        NULL,
  username         text        NULL,
  language_code    text        NULL,
  profile_seen_at  timestamptz NOT NULL,
  created_at       timestamptz NOT NULL,
  CONSTRAINT contacts_pkey PRIMARY KEY (id),
  CONSTRAINT contacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  -- One contact per person per workspace; capture upsert ON CONFLICT (flow 2); contacts count per workspace
  -- (flow 4, index-only); FK index for workspace_id.
  CONSTRAINT contacts_workspace_id_telegram_user_id_key UNIQUE (workspace_id, telegram_user_id)
);
