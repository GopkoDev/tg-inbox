-- bots: the workspace's business bot (ADR-0007). One row per workspace and per Telegram bot; a row with
-- captured conversations outlives a disconnect (state 'disconnected', no token, no secret, no capture epoch).
-- The row id is the webhook id in /api/telegram/webhook/<id> (ADR-0002).
CREATE TABLE IF NOT EXISTS bots (
  id                  uuid        NOT NULL,
  workspace_id        uuid        NOT NULL,
  telegram_bot_id     bigint      NOT NULL,
  name                text        NOT NULL,
  username            text        NOT NULL,
  state               text        NOT NULL,
  token_encrypted     bytea       NULL,
  webhook_secret_hash bytea       NULL,
  connected_at        timestamptz NULL,
  last_checked_at     timestamptz NULL,
  created_at          timestamptz NOT NULL,
  CONSTRAINT bots_pkey PRIMARY KEY (id),
  CONSTRAINT bots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  -- A workspace has at most one business bot (AC-05); settings read by workspace (flows 1, 4-7); FK index.
  CONSTRAINT bots_workspace_id_key UNIQUE (workspace_id),
  -- A bot belongs to at most one workspace (AC-04): the violation IS the "belongs to another workspace" refusal.
  CONSTRAINT bots_telegram_bot_id_key UNIQUE (telegram_bot_id),
  CONSTRAINT bots_state_check CHECK (state IN ('connected', 'needs_token', 'taken_over', 'disconnected')),
  -- AES-256-GCM envelope: key id + 12-byte nonce + ciphertext + 16-byte tag (ADR-0006).
  CONSTRAINT bots_token_encrypted_length_check CHECK (octet_length(token_encrypted) > 28),
  -- SHA-256 of the per-bot webhook secret; the secret itself is never stored (ADR-0002).
  CONSTRAINT bots_webhook_secret_hash_length_check CHECK (octet_length(webhook_secret_hash) = 32),
  -- Only a disconnected row drops its token, secret and capture epoch (AC-18); every other state holds all three.
  CONSTRAINT bots_token_encrypted_state_check CHECK ((state = 'disconnected') = (token_encrypted IS NULL)),
  CONSTRAINT bots_webhook_secret_hash_state_check CHECK ((state = 'disconnected') = (webhook_secret_hash IS NULL)),
  CONSTRAINT bots_connected_at_state_check CHECK ((state = 'disconnected') = (connected_at IS NULL)),
  -- Every Bot API exchange writes its outcome, so a live row has always been checked (ADR-0008).
  CONSTRAINT bots_last_checked_at_state_check CHECK (state = 'disconnected' OR last_checked_at IS NOT NULL)
);

-- Bots due for a health check: connected or taken over, last checked >= 3 min ago (flow 3, controlled tenancy exception).
CREATE INDEX IF NOT EXISTS bots_due_for_check_idx
  ON bots (last_checked_at) WHERE state IN ('connected', 'taken_over');
