import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/workspace-operators/migrations/03_create_sign_in_failures.{up,down}.sql.
// Migrations take Kysely<any> — they are frozen in time and must not depend on the generated DB types.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- auth: failed sign-in log per normalised email. No FK — unknown emails are recorded the same way (AC-09).
CREATE TABLE IF NOT EXISTS sign_in_failures (
  id        uuid        NOT NULL,
  email     text        NOT NULL,
  failed_at timestamptz NOT NULL,
  CONSTRAINT sign_in_failures_pkey PRIMARY KEY (id),
  CONSTRAINT sign_in_failures_email_normalised_check CHECK (email = lower(btrim(email)))
);

-- Lockout window check and clearing by email (flows 1, 2, 12).
CREATE INDEX IF NOT EXISTS sign_in_failures_email_failed_at_idx ON sign_in_failures (email, failed_at);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS sign_in_failures_email_failed_at_idx;
DROP TABLE IF EXISTS sign_in_failures;
  `.execute(db);
}
