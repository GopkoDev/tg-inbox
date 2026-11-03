import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/group-posts/migrations/03_create_destination_codes.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- destination_codes: single-use 10-minute connect codes (ADR-0002), the connect-link pattern of notifications.
-- Owned by posts. Only the SHA-256 of the code is stored; the code is shown once to the owner who created it.
--   result      — what the connect dialog shows: NULL while waiting, 'connected', 'no_post_right' (the bot may not
--                 post there; the code stays usable until it expires so the owner can fix rights and post it again).
--                 Expiry is not stored: the dialog shows "expired" once expires_at passes with no use.
--   destination_id — the destination it connected or revived.
--   replaced_at — a newer code of the same owner replaced this one (one live code per owner).
-- Redeem looks the hash up within the receiving bot's workspace: no tenancy exception.
CREATE TABLE IF NOT EXISTS destination_codes (
  id             uuid        NOT NULL,
  workspace_id   uuid        NOT NULL,
  account_id     uuid        NOT NULL,
  code_hash      bytea       NOT NULL,
  created_at     timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz NULL,
  replaced_at    timestamptz NULL,
  result         text        NULL,
  result_at      timestamptz NULL,
  destination_id uuid        NULL,
  CONSTRAINT destination_codes_pkey PRIMARY KEY (id),
  CONSTRAINT destination_codes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT destination_codes_workspace_id_id_key UNIQUE (workspace_id, id),
  -- Redeem: the code by hash in the receiving bot's workspace (flow 1).
  CONSTRAINT destination_codes_workspace_id_code_hash_key UNIQUE (workspace_id, code_hash),
  CONSTRAINT destination_codes_membership_fkey
    FOREIGN KEY (workspace_id, account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT destination_codes_destination_fkey
    FOREIGN KEY (workspace_id, destination_id) REFERENCES destinations (workspace_id, id),
  CONSTRAINT destination_codes_code_hash_length_check CHECK (octet_length(code_hash) = 32),
  CONSTRAINT destination_codes_expires_at_check CHECK (expires_at > created_at),
  CONSTRAINT destination_codes_used_check CHECK (
    (used_at IS NULL) = (destination_id IS NULL) AND (used_at IS NULL OR used_at >= created_at)
  ),
  CONSTRAINT destination_codes_used_or_replaced_check CHECK (used_at IS NULL OR replaced_at IS NULL),
  CONSTRAINT destination_codes_result_check CHECK (
    (result IS NULL) = (result_at IS NULL)
    AND (result IS NULL OR result IN ('connected', 'no_post_right'))
    AND COALESCE(result = 'connected', false) = (used_at IS NOT NULL)
  )
);

-- The owner's live code (replace the previous one) and the creation rate check (flow 1).
CREATE INDEX IF NOT EXISTS destination_codes_workspace_id_account_id_created_at_idx
  ON destination_codes (workspace_id, account_id, created_at DESC);
-- FK index for the destination composite FK.
CREATE INDEX IF NOT EXISTS destination_codes_workspace_id_destination_id_idx
  ON destination_codes (workspace_id, destination_id) WHERE destination_id IS NOT NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS destination_codes_workspace_id_destination_id_idx;
DROP INDEX IF EXISTS destination_codes_workspace_id_account_id_created_at_idx;
DROP TABLE IF EXISTS destination_codes;
  `.execute(db);
}
