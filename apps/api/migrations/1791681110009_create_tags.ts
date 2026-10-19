import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/contacts/migrations/04_create_tags.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- tags: the workspace's tags (ADR-0002). Owned by contacts. A tag is identified by its id: a rename changes
-- name and name_key only, so contact tags, filters in addresses and history entries follow it.
--   name     — the tidied name (NFC, zero-width spaces U+200B/U+2060/U+FEFF removed, every white-space run with
--              any adjacent joiners collapsed to one space, ends trimmed of spaces and joiners, the joiners
--              U+200C/U+200D inside kept), case as typed; what is shown. 1–32 graphemes, counted in the domain (Intl.Segmenter): the database
--              cannot count graphemes, so no CHECK encodes the limit.
--   name_key — the tidied name without the joiners U+200C/U+200D, case-folded in the domain (toUpperCase then
--              toLowerCase); unique per workspace, so
--              "vip", " VIP " and "VIP" are one tag (AC-08). Computed in the shared package only, never in SQL:
--              Postgres's lower / upper fold some letters differently (ß), so no CHECK ties it to name.
-- created_by_account_id is a cross-module composite FK to memberships, constraint only, like
-- conversations.assignee_account_id: contacts reads display names through the workspaces app layer.
-- The 100-per-workspace limit is counted under the tags:<ws> advisory lock (ADR-0004), not by a constraint.
CREATE TABLE IF NOT EXISTS tags (
  id                    uuid        NOT NULL,
  workspace_id          uuid        NOT NULL,
  name                  text        NOT NULL,
  name_key              text        NOT NULL,
  created_by_account_id uuid        NOT NULL,
  created_at            timestamptz NOT NULL,
  CONSTRAINT tags_pkey PRIMARY KEY (id),
  CONSTRAINT tags_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT tags_created_by_membership_fkey
    FOREIGN KEY (workspace_id, created_by_account_id) REFERENCES memberships (workspace_id, account_id),
  -- One tag per name key per workspace (AC-08, flow 9 find-or-create, flow 13 "name taken"); the tag list of a
  -- workspace (flow 12, the picker, the filter: ≤ 100 rows, sorted by name COLLATE "und-x-icu" then name_key in
  -- the query); FK index for workspace_id.
  CONSTRAINT tags_workspace_id_name_key_key UNIQUE (workspace_id, name_key),
  -- Target of the composite FK from contact_tags (ADR-0004): a contact only ever carries its own workspace's tags.
  -- Also the resolve of filter ids (flow 5) and the "lock the tag row of W" (flows 8, 13).
  CONSTRAINT tags_workspace_id_id_key UNIQUE (workspace_id, id),
  -- Stored names are already tidied: never empty, no leading or trailing space.
  CONSTRAINT tags_name_check CHECK (name <> '' AND name = btrim(name)),
  CONSTRAINT tags_name_key_check CHECK (name_key <> '')
);

-- FK index for (workspace_id, created_by_account_id).
CREATE INDEX IF NOT EXISTS tags_workspace_id_created_by_account_id_idx
  ON tags (workspace_id, created_by_account_id);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS tags_workspace_id_created_by_account_id_idx;
DROP TABLE IF EXISTS tags;
  `.execute(db);
}
