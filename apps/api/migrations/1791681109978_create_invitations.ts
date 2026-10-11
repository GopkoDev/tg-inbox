import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/workspace-operators/migrations/07_create_invitations.{up,down}.sql.
// Migrations take Kysely<any> — they are frozen in time and must not depend on the generated DB types.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- workspaces: single-use, 7-day invitation links bound to one email and role; only the token hash is stored.
CREATE TABLE IF NOT EXISTS invitations (
  id           uuid        NOT NULL,
  workspace_id uuid        NOT NULL,
  email        text        NOT NULL,
  role         text        NOT NULL,
  token_hash   bytea       NOT NULL,
  state        text        NOT NULL,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL,
  closed_at    timestamptz NULL,
  CONSTRAINT invitations_pkey PRIMARY KEY (id),
  CONSTRAINT invitations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT invitations_token_hash_key UNIQUE (token_hash),
  CONSTRAINT invitations_token_hash_length_check CHECK (octet_length(token_hash) = 32),
  CONSTRAINT invitations_email_normalised_check CHECK (email = lower(btrim(email))),
  CONSTRAINT invitations_email_length_check CHECK (char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT invitations_role_check CHECK (role IN ('owner', 'operator')),
  CONSTRAINT invitations_state_check CHECK (state IN ('pending', 'accepted', 'revoked', 'superseded')),
  CONSTRAINT invitations_expires_at_check CHECK (expires_at > created_at),
  CONSTRAINT invitations_closed_at_check CHECK ((state = 'pending') = (closed_at IS NULL))
);

-- One pending invitation per email per workspace; supersede on re-invite (flow 8), pending list (flow 10).
CREATE UNIQUE INDEX IF NOT EXISTS invitations_workspace_id_email_pending_key
  ON invitations (workspace_id, email) WHERE state = 'pending';

-- Latest invitation of the workspace in any state, to re-issue the first-owner one (flow 5); FK index.
CREATE INDEX IF NOT EXISTS invitations_workspace_id_idx ON invitations (workspace_id);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS invitations_workspace_id_idx;
DROP INDEX IF EXISTS invitations_workspace_id_email_pending_key;
DROP TABLE IF EXISTS invitations;
  `.execute(db);
}
