import { sql, type Kysely } from 'kysely';

// Follow-up T26: a code result may also say the 20-destination limit stopped the connect
// ('destination_limit') and that a group needs the send-messages right ('no_send_right').

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
ALTER TABLE destination_codes DROP CONSTRAINT destination_codes_result_check;
ALTER TABLE destination_codes ADD CONSTRAINT destination_codes_result_check CHECK (
  (result IS NULL) = (result_at IS NULL)
  AND (result IS NULL OR result IN ('connected', 'no_post_right', 'no_send_right', 'destination_limit'))
  AND COALESCE(result = 'connected', false) = (used_at IS NOT NULL)
);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
UPDATE destination_codes SET result = 'no_post_right' WHERE result = 'no_send_right';
UPDATE destination_codes SET result = NULL, result_at = NULL WHERE result = 'destination_limit';
ALTER TABLE destination_codes DROP CONSTRAINT destination_codes_result_check;
ALTER TABLE destination_codes ADD CONSTRAINT destination_codes_result_check CHECK (
  (result IS NULL) = (result_at IS NULL)
  AND (result IS NULL OR result IN ('connected', 'no_post_right'))
  AND COALESCE(result = 'connected', false) = (used_at IS NOT NULL)
);
  `.execute(db);
}
