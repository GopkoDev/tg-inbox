import { sql, type Kysely } from 'kysely';

// Baseline: pin the database session timezone to UTC so every timestamptz renders consistently.
// Migrations take Kysely<any> — they are frozen in time and must not depend on the generated DB types.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    DO $$ BEGIN
      EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
    END $$
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    DO $$ BEGIN
      EXECUTE format('ALTER DATABASE %I RESET timezone', current_database());
    END $$
  `.execute(db);
}
