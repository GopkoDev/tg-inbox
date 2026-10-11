-- auth: one signed-in device; only the SHA-256 hash of the cookie token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  id           uuid        NOT NULL,
  account_id   uuid        NOT NULL,
  token_hash   bytea       NOT NULL,
  created_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  CONSTRAINT sessions_pkey PRIMARY KEY (id),
  CONSTRAINT sessions_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
  CONSTRAINT sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT sessions_token_hash_length_check CHECK (octet_length(token_hash) = 32),
  CONSTRAINT sessions_last_seen_at_check CHECK (last_seen_at >= created_at)
);

-- Password reset ends every session of the account (flow 12); FK index.
CREATE INDEX IF NOT EXISTS sessions_account_id_idx ON sessions (account_id);
