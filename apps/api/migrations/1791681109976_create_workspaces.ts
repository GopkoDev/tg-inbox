import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/workspace-operators/migrations/05_create_workspaces.{up,down}.sql.
// Migrations take Kysely<any> — they are frozen in time and must not depend on the generated DB types.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- workspaces: one business and the tenancy boundary. No status column — no members yet = awaiting its first owner.
CREATE TABLE IF NOT EXISTS workspaces (
  id         uuid        NOT NULL,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT workspaces_pkey PRIMARY KEY (id),
  CONSTRAINT workspaces_name_length_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 200)
);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP TABLE IF EXISTS workspaces;
  `.execute(db);
}
