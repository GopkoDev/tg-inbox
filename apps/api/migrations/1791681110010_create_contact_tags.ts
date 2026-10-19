import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/contacts/migrations/05_create_contact_tags.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- contact_tags: which tags a contact carries now, who added each and when (AC-04, AC-06, ADR-0003, ADR-0004).
-- Owned by contacts. The current state only; every change also writes a contact_tag_history entry in the same
-- transaction. Both references are composite FKs that carry the workspace, so a link between a contact and a tag
-- of different workspaces cannot be stored (AC-12). A tag deleted or merged away under a member's add makes the
-- add fail (the explicit FOR KEY SHARE finds no row, TAG_NOT_FOUND) instead of resurrecting it.
-- No ON DELETE CASCADE: an owner's delete removes the links itself with RETURNING to compare the count the owner
-- confirmed (TAG_COUNT_CHANGED), then deletes the tag; a merge re-points or deletes them before deleting the tag.
-- The 20-per-contact limit is checked under the contact row lock (ADR-0004), not by a constraint.
CREATE TABLE IF NOT EXISTS contact_tags (
  workspace_id        uuid        NOT NULL,
  contact_id          uuid        NOT NULL,
  tag_id              uuid        NOT NULL,
  added_by_account_id uuid        NOT NULL,
  added_at            timestamptz NOT NULL,
  -- One link per contact and tag (already carried = no-op, AC-06; a merge keeps one link on a contact that
  -- carried both, AC-09); the profile's tags of a contact and the "is it carried, how many" check under the
  -- contact lock (flows 6, 8, 10); the list's tags of a page of contacts (flow 4); FK index for workspace_id and
  -- for (workspace_id, contact_id).
  CONSTRAINT contact_tags_pkey PRIMARY KEY (workspace_id, contact_id, tag_id),
  CONSTRAINT contact_tags_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT contact_tags_contact_fkey
    FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts (workspace_id, id),
  CONSTRAINT contact_tags_tag_fkey
    FOREIGN KEY (workspace_id, tag_id) REFERENCES tags (workspace_id, id),
  CONSTRAINT contact_tags_added_by_membership_fkey
    FOREIGN KEY (workspace_id, added_by_account_id) REFERENCES memberships (workspace_id, account_id)
);

-- The contacts of one tag: the count per tag (flow 12, AC-10), the any of / all of / no tags filter and the
-- matching count (flow 5, AC-02), the owner's set-based merge re-point and delete with RETURNING (flow 13, seeded
-- flow 2); FK index for (workspace_id, tag_id).
CREATE INDEX IF NOT EXISTS contact_tags_workspace_id_tag_id_contact_id_idx
  ON contact_tags (workspace_id, tag_id, contact_id);
-- FK index for (workspace_id, added_by_account_id).
CREATE INDEX IF NOT EXISTS contact_tags_workspace_id_added_by_account_id_idx
  ON contact_tags (workspace_id, added_by_account_id);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS contact_tags_workspace_id_added_by_account_id_idx;
DROP INDEX IF EXISTS contact_tags_workspace_id_tag_id_contact_id_idx;
DROP TABLE IF EXISTS contact_tags;
  `.execute(db);
}
