import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/workspace-operators/migrations/04_create_password_reset_links.{up,down}.sql.
// Migrations take Kysely<any> — they are frozen in time and must not depend on the generated DB types.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
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
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS password_reset_links_account_id_idx;
DROP TABLE IF EXISTS password_reset_links;
  `.execute(db);
}
