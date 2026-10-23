import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/broadcasts/migrations/05_create_broadcast_audience_tags.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- broadcast_audience_tags: the tags of a tag audience, chosen and left out (ADR-0004, AC-01). Owned by broadcasts.
-- Written under the broadcast row lock with the draft's version (ADR-0005); frozen with the broadcast at launch,
-- when tag_name is rewritten to the name at launch and tags that no longer exist are removed (the audience "as it
-- was defined", AC-11).
--   kind     — 'include' (matched with the broadcast's tag_mode) or 'exclude' (left out: any contact carrying it is
--              never counted).
--   tag_name — the tag's name when it was chosen (at launch for a launched broadcast), shown in the notice when the
--              tag was deleted or merged away.
-- tag_id has NO FK to tags: a tag deleted or merged away is detected at read time (existingTags) and reported by
-- its stored name, with no hook from tag admin into broadcasts (ADR-0004: avoids the lock-order risk with tags:<ws>).
-- The tag ids are resolved among the workspace's own tags before they are stored (flow 7), so a foreign id is
-- refused in the application.
CREATE TABLE IF NOT EXISTS broadcast_audience_tags (
  workspace_id uuid NOT NULL,
  broadcast_id uuid NOT NULL,
  tag_id       uuid NOT NULL,
  kind         text NOT NULL,
  tag_name     text NOT NULL,
  -- One row per broadcast and tag: a tag is either chosen or left out, never both; the audience of a draft, read
  -- by every draft read and the launch (flows 7, 10), replaced on a save, copied by a duplicate (flow 15), deleted
  -- with the draft (flow 9); FK index for workspace_id and the broadcast composite FK.
  CONSTRAINT broadcast_audience_tags_pkey PRIMARY KEY (workspace_id, broadcast_id, tag_id),
  CONSTRAINT broadcast_audience_tags_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT broadcast_audience_tags_broadcast_fkey
    FOREIGN KEY (workspace_id, broadcast_id) REFERENCES broadcasts (workspace_id, id),
  CONSTRAINT broadcast_audience_tags_kind_check CHECK (kind IN ('include', 'exclude')),
  CONSTRAINT broadcast_audience_tags_tag_name_check CHECK (tag_name <> '')
);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP TABLE IF EXISTS broadcast_audience_tags;
  `.execute(db);
}
