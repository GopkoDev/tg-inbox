import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/broadcasts/migrations/02_backfill_contact_bot_reach.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- Backfill: every contact that has written is treated as having written to its workspace's current Telegram bot
-- (SAD §1 assumption, §11 risk "Reach backfill"). One-time data migration that reads bots, which the bots module
-- owns (the same kind of override as the contacts backfill); no runtime code reads bots for this.
-- A workspace has at most one bot row (bots_workspace_id_key), whatever its state: a needs_token, taken_over or
-- disconnected row keeps its telegram_bot_id, and reconnecting the same Telegram bot keeps the marks (AC-10).
-- wrote_at = the contact's first_wrote_at, changed_at = its last_wrote_at (the newest message is the newest fact).
-- Contacts that never wrote (first_wrote_at NULL) and workspaces with no bot row get no row.
-- ON CONFLICT DO NOTHING: re-runnable, and a row that capture wrote after the new code was deployed is kept.
INSERT INTO contact_bot_reach (workspace_id, contact_id, telegram_bot_id, wrote_at, blocked_at, changed_at)
SELECT c.workspace_id, c.id, b.telegram_bot_id, c.first_wrote_at, NULL, c.last_wrote_at
FROM contacts AS c
JOIN bots AS b ON b.workspace_id = c.workspace_id
WHERE c.first_wrote_at IS NOT NULL
ON CONFLICT (workspace_id, contact_id, telegram_bot_id) DO NOTHING;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
-- No-op: the backfilled rows leave with the table when 01 is reverted. Reverting 02 alone keeps them, which is what
-- capture would have written for those contacts anyway.
SELECT 1;
  `.execute(db);
}
