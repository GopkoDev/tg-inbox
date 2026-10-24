import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/broadcasts/migrations/06_create_broadcast_group_contacts.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- broadcast_group_contacts: the hand-picked contacts of one draft's broadcast group (ADR-0005, AC-03, AC-04,
-- AC-05). Owned by broadcasts. Outside the draft's version: an add is INSERT … ON CONFLICT DO NOTHING and a remove
-- is DELETE by key, both under the broadcast row lock that checks "still a draft" and the 10 000 limit, so two
-- members' adds and removes both stand (AC-03). The composite FK to contacts makes a contact of another workspace
-- unstorable (AC-05, AC-08). Kept, read-only, after the launch (the frozen recipient list is the source of truth).
-- added_by_account_id is a cross-module composite FK to memberships, constraint only.
-- No ON DELETE CASCADE: deleting a draft removes its rows first (flow 9); contact erasure is by hand (spec OQ-4,
-- SAD §11: the run book deletes these rows first).
CREATE TABLE IF NOT EXISTS broadcast_group_contacts (
  workspace_id        uuid        NOT NULL,
  broadcast_id        uuid        NOT NULL,
  contact_id          uuid        NOT NULL,
  added_by_account_id uuid        NOT NULL,
  added_at            timestamptz NOT NULL,
  -- A contact is in a group at most once (AC-05 "already there"); add, remove and "which of these are in the
  -- group" by key, the group size count under the row lock, the group's ids for the breakdown and the launch
  -- (flows 7, 8, 10), copy on duplicate (flow 15); FK index for workspace_id and the broadcast composite FK.
  CONSTRAINT broadcast_group_contacts_pkey PRIMARY KEY (workspace_id, broadcast_id, contact_id),
  CONSTRAINT broadcast_group_contacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT broadcast_group_contacts_broadcast_fkey
    FOREIGN KEY (workspace_id, broadcast_id) REFERENCES broadcasts (workspace_id, id),
  CONSTRAINT broadcast_group_contacts_contact_fkey
    FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts (workspace_id, id),
  CONSTRAINT broadcast_group_contacts_added_by_membership_fkey
    FOREIGN KEY (workspace_id, added_by_account_id) REFERENCES memberships (workspace_id, account_id)
);

-- The group page: 50 contacts of a draft's group, the most recently added first (flow 8).
CREATE INDEX IF NOT EXISTS broadcast_group_contacts_added_at_idx
  ON broadcast_group_contacts (workspace_id, broadcast_id, added_at DESC, contact_id DESC);
-- FK index for (workspace_id, contact_id); the hand erasure of a contact (spec OQ-4).
CREATE INDEX IF NOT EXISTS broadcast_group_contacts_workspace_id_contact_id_idx
  ON broadcast_group_contacts (workspace_id, contact_id);
-- FK index for (workspace_id, added_by_account_id).
CREATE INDEX IF NOT EXISTS broadcast_group_contacts_workspace_id_added_by_account_id_idx
  ON broadcast_group_contacts (workspace_id, added_by_account_id);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS broadcast_group_contacts_workspace_id_added_by_account_id_idx;
DROP INDEX IF EXISTS broadcast_group_contacts_workspace_id_contact_id_idx;
DROP INDEX IF EXISTS broadcast_group_contacts_added_at_idx;
DROP TABLE IF EXISTS broadcast_group_contacts;
  `.execute(db);
}
