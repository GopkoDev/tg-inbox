import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/contacts/migrations/06_create_contact_tag_history.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- contact_tag_history: the append-only record of every change of a contact's tags (ADR-0003, AC-04, AC-06, AC-09,
-- spec §6 history completeness). Owned by contacts. Written in the same transaction as the change; never updated
-- or deleted by the application.
--   kind     — 'added' / 'removed' by a member, 'merged' by an owner's merge (one entry per contact that carried
--              the merged tag), 'deleted' by an owner's delete (one per contact that lost it). A rename writes none.
--   tag_id   — the tag the entry is about; no FK, so the entry outlives the tag (deleted or merged away).
--   tag_name — the tag's name at that moment; merged_into_tag_id / merged_into_name — the merge target (no FK).
--   source   — 'inbox' / 'profile' as reported by the member route (KPI only), 'settings' for owner entries.
-- actor_account_id is a cross-module composite FK to memberships (deactivated members stay rows, AC-13).
-- The per-member rate limit counts this table (60 member entries per rolling 60 s, under the
-- tag-changes:<ws>:<account> advisory lock): owner kinds never count.
CREATE TABLE IF NOT EXISTS contact_tag_history (
  id                 uuid        NOT NULL,
  workspace_id       uuid        NOT NULL,
  contact_id         uuid        NOT NULL,
  tag_id             uuid        NOT NULL,
  tag_name           text        NOT NULL,
  kind               text        NOT NULL,
  merged_into_tag_id uuid        NULL,
  merged_into_name   text        NULL,
  actor_account_id   uuid        NOT NULL,
  source             text        NOT NULL,
  created_at         timestamptz NOT NULL,
  CONSTRAINT contact_tag_history_pkey PRIMARY KEY (id),
  CONSTRAINT contact_tag_history_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT contact_tag_history_contact_fkey
    FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts (workspace_id, id),
  CONSTRAINT contact_tag_history_actor_membership_fkey
    FOREIGN KEY (workspace_id, actor_account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT contact_tag_history_kind_check CHECK (kind IN ('added', 'removed', 'merged', 'deleted')),
  CONSTRAINT contact_tag_history_source_check CHECK (source IN ('inbox', 'profile', 'settings')),
  -- Member kinds come from the member routes (inbox / profile); owner kinds only from Settings - Tags.
  CONSTRAINT contact_tag_history_kind_source_check CHECK (
    (kind IN ('added', 'removed') AND source IN ('inbox', 'profile'))
    OR (kind IN ('merged', 'deleted') AND source = 'settings')
  ),
  -- A merge entry names its target; no other entry does.
  CONSTRAINT contact_tag_history_merged_into_check CHECK (
    (kind = 'merged') = (merged_into_tag_id IS NOT NULL)
    AND (merged_into_tag_id IS NULL) = (merged_into_name IS NULL)
  ),
  CONSTRAINT contact_tag_history_tag_name_check CHECK (tag_name <> ''),
  CONSTRAINT contact_tag_history_merged_into_name_check CHECK (merged_into_name <> '')
);

-- The profile's tag history of one contact, newest first, keyset by (created_at, id) (flow 6, AC-04); the
-- integrity query "a link with no added or merged entry for it" (SAD §7); FK index for workspace_id and
-- (workspace_id, contact_id).
CREATE INDEX IF NOT EXISTS contact_tag_history_workspace_id_contact_id_created_at_idx
  ON contact_tag_history (workspace_id, contact_id, created_at DESC, id DESC);
-- The member rate limit: this member's 'added' / 'removed' entries of the last 60 s and the oldest of them for the
-- retry time (flows 8, 9, 10, AC-15). kind is in the key so an owner's 10 000 merge entries in the window are
-- skipped, not filtered row by row. FK index for (workspace_id, actor_account_id).
CREATE INDEX IF NOT EXISTS contact_tag_history_workspace_id_actor_kind_created_at_idx
  ON contact_tag_history (workspace_id, actor_account_id, kind, created_at);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS contact_tag_history_workspace_id_actor_kind_created_at_idx;
DROP INDEX IF EXISTS contact_tag_history_workspace_id_contact_id_created_at_idx;
DROP TABLE IF EXISTS contact_tag_history;
  `.execute(db);
}
