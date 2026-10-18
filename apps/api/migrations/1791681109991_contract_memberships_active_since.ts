import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/shared-inbox/migrations/09_contract_memberships_active_since.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- Contract (3/3): every membership has an active-since time. Apply only after the code that sets it on
-- join and on reactivation is deployed (02 backfilled the existing rows).
ALTER TABLE memberships ALTER COLUMN active_since SET NOT NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
ALTER TABLE memberships ALTER COLUMN active_since DROP NOT NULL;
  `.execute(db);
}
