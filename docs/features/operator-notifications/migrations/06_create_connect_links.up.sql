-- connect_links: a single-use, 10-minute link bound to one membership, opened in Telegram as
-- /start tgi_<token> (ADR-0004). Owned by notifications. Only the SHA-256 of the 32-byte random token is stored,
-- like sessions and invitations; the token itself is shown once and never stored or logged.
-- A link is usable while used_at IS NULL AND replaced_at IS NULL AND expires_at > now (re-checked under FOR UPDATE
-- at redeem). Every redeem, refusals included, sets used_at (AC-05, AC-06). A newer link, a deactivation and
-- nothing else set replaced_at, and only on an unused link. Rows are kept: they are the 5-per-10-minutes count
-- (AC-13) and hold no personal data beyond the membership.
CREATE TABLE IF NOT EXISTS connect_links (
  id           uuid        NOT NULL,
  workspace_id uuid        NOT NULL,
  account_id   uuid        NOT NULL,
  token_hash   bytea       NOT NULL,
  created_at   timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz NULL,
  replaced_at  timestamptz NULL,
  CONSTRAINT connect_links_pkey PRIMARY KEY (id),
  CONSTRAINT connect_links_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT connect_links_membership_fkey
    FOREIGN KEY (workspace_id, account_id) REFERENCES memberships (workspace_id, account_id),
  -- The redeem's plain read by hash, scoped by the workspace of the authenticated webhook's bot (flow 2).
  CONSTRAINT connect_links_workspace_id_token_hash_key UNIQUE (workspace_id, token_hash),
  CONSTRAINT connect_links_token_hash_length_check CHECK (octet_length(token_hash) = 32),
  CONSTRAINT connect_links_expires_at_check CHECK (expires_at > created_at),
  CONSTRAINT connect_links_used_at_check CHECK (used_at >= created_at),
  CONSTRAINT connect_links_replaced_at_check CHECK (replaced_at >= created_at),
  -- Used and replaced are exclusive: only an unused link is replaced, and a replaced one is never redeemed.
  CONSTRAINT connect_links_used_or_replaced_check CHECK (used_at IS NULL OR replaced_at IS NULL)
);

-- Connect-link issue under the connect-links:<ws>:<account> advisory lock: count this member's links of the last
-- 10 min and the oldest of them for the retry time (AC-13), then mark the previous unused one replaced (flow 8);
-- deactivation marks the member's unused links replaced (flow 15). FK index for workspace_id and
-- (workspace_id, account_id).
CREATE INDEX IF NOT EXISTS connect_links_workspace_id_account_id_created_at_idx
  ON connect_links (workspace_id, account_id, created_at);
