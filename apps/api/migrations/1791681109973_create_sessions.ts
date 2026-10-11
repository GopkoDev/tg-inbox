import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/workspace-operators/migrations/02_create_sessions.{up,down}.sql.
// Migrations take Kysely<any> — they are frozen in time and must not depend on the generated DB types.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
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
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS sessions_account_id_idx;
DROP TABLE IF EXISTS sessions;
  `.execute(db);
}
