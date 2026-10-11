import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/workspace-operators/migrations/06_create_memberships.{up,down}.sql.
// Migrations take Kysely<any> — they are frozen in time and must not depend on the generated DB types.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- workspaces: an account's role and state in one workspace. account_id is a cross-module FK (constraint only).
CREATE TABLE IF NOT EXISTS memberships (
  id             uuid        NOT NULL,
  workspace_id   uuid        NOT NULL,
  account_id     uuid        NOT NULL,
  role           text        NOT NULL,
  state          text        NOT NULL,
  last_used_at   timestamptz NULL,
  deactivated_at timestamptz NULL,
  created_at     timestamptz NOT NULL,
  CONSTRAINT memberships_pkey PRIMARY KEY (id),
  CONSTRAINT memberships_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT memberships_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts (id),
  -- Guard lookup (flow 3), already-a-member check (flow 8), team list + active-owner count (flows 9, 10); FK index for workspace_id.
  CONSTRAINT memberships_workspace_id_account_id_key UNIQUE (workspace_id, account_id),
  CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'operator')),
  CONSTRAINT memberships_state_check CHECK (state IN ('active', 'deactivated')),
  CONSTRAINT memberships_deactivated_at_check CHECK ((state = 'deactivated') = (deactivated_at IS NOT NULL))
);

-- Active memberships of the signed-in account, ordered by last use (flows 1, 7); FK index for account_id.
CREATE INDEX IF NOT EXISTS memberships_account_id_idx ON memberships (account_id);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS memberships_account_id_idx;
DROP TABLE IF EXISTS memberships;
  `.execute(db);
}
