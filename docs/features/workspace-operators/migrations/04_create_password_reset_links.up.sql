-- auth: admin-issued, single-use, 24-hour password-reset links; only the token hash is stored.
CREATE TABLE IF NOT EXISTS password_reset_links (
  id         uuid        NOT NULL,
  account_id uuid        NOT NULL,
  token_hash bytea       NOT NULL,
  state      text        NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  closed_at  timestamptz NULL,
  CONSTRAINT password_reset_links_pkey PRIMARY KEY (id),
  CONSTRAINT password_reset_links_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
  CONSTRAINT password_reset_links_token_hash_key UNIQUE (token_hash),
  CONSTRAINT password_reset_links_token_hash_length_check CHECK (octet_length(token_hash) = 32),
  CONSTRAINT password_reset_links_state_check CHECK (state IN ('pending', 'used', 'superseded')),
  CONSTRAINT password_reset_links_expires_at_check CHECK (expires_at > created_at),
  CONSTRAINT password_reset_links_closed_at_check CHECK ((state = 'pending') = (closed_at IS NULL))
);

-- Supersede the account's pending links on a new issue (flow 11); FK index.
CREATE INDEX IF NOT EXISTS password_reset_links_account_id_idx ON password_reset_links (account_id);
