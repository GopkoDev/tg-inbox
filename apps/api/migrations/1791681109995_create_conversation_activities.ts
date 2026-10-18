import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/assignment-statuses/migrations/03_create_conversation_activities.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- conversation_activities: one entry per recorded assignee or status change, by a member or automatic
-- (AC-09, ADR-0006). Owned by conversations; the thread's third keyset half, the change limit's log (AC-12)
-- and the live signal's item (ADR-0007). Names are never stored — account ids are resolved through the
-- workspaces app layer at read time and rendered as plain text (spec §6.1).
-- The three account columns are cross-module composite FKs to memberships (workspace_id, account_id),
-- constraint only, like conversations.assignee_account_id: every actor and assignee is a member of the
-- entry's own workspace. Memberships are never deleted (deactivation is a state), so history stays valid.
CREATE TABLE IF NOT EXISTS conversation_activities (
  id                           uuid        NOT NULL,
  workspace_id                 uuid        NOT NULL,
  conversation_id              uuid        NOT NULL,
  kind                         text        NOT NULL,
  cause                        text        NOT NULL,
  actor_account_id             uuid        NULL,
  previous_assignee_account_id uuid        NULL,
  new_assignee_account_id      uuid        NULL,
  position_at                  timestamptz NOT NULL,
  created_at                   timestamptz NOT NULL,
  CONSTRAINT conversation_activities_pkey PRIMARY KEY (id),
  CONSTRAINT conversation_activities_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT conversation_activities_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations (id),
  CONSTRAINT conversation_activities_actor_fkey
    FOREIGN KEY (workspace_id, actor_account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT conversation_activities_previous_assignee_fkey
    FOREIGN KEY (workspace_id, previous_assignee_account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT conversation_activities_new_assignee_fkey
    FOREIGN KEY (workspace_id, new_assignee_account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT conversation_activities_kind_check
    CHECK (kind IN ('assigned', 'reassigned', 'unassigned', 'closed', 'reopened')),
  CONSTRAINT conversation_activities_cause_check
    CHECK (cause IN ('member', 'customer_wrote', 'reply_not_delivered', 'member_deactivated')),
  -- Automatic causes exist only for the automatic changes: the customer's message or a failed reply reopens
  -- (AC-07, AC-08, ADR-0004), a deactivation unassigns (AC-10, ADR-0005). Every other entry is a member's.
  CONSTRAINT conversation_activities_kind_cause_check CHECK (
    cause = 'member'
    OR (kind = 'reopened'   AND cause IN ('customer_wrote', 'reply_not_delivered'))
    OR (kind = 'unassigned' AND cause = 'member_deactivated')
  ),
  -- A member's change names its actor; an automatic one has none, so it is never counted toward, nor refused
  -- by, the change limit (AC-12).
  CONSTRAINT conversation_activities_actor_cause_check CHECK ((cause = 'member') = (actor_account_id IS NOT NULL)),
  -- The assignee pair matches the line the thread renders (AC-02): "assigned this to <new>", "reassigned this
  -- from <previous> to <new>", "unassigned this" (from <previous>); a status change keeps the assignee and
  -- records neither.
  CONSTRAINT conversation_activities_assignees_check CHECK (
    (kind = 'assigned'   AND previous_assignee_account_id IS NULL     AND new_assignee_account_id IS NOT NULL)
    OR (kind = 'reassigned' AND previous_assignee_account_id IS NOT NULL AND new_assignee_account_id IS NOT NULL
        AND previous_assignee_account_id <> new_assignee_account_id)
    OR (kind = 'unassigned' AND previous_assignee_account_id IS NOT NULL AND new_assignee_account_id IS NULL)
    OR (kind IN ('closed', 'reopened') AND previous_assignee_account_id IS NULL AND new_assignee_account_id IS NULL)
  )
);

-- Thread page before/after a (position_at, kind, id) cursor, the activity half of the three-way merge
-- (flow 11, ADR-0006); the conversation's latest entry for a stale refusal and the "never earlier than the
-- latest entry" position rule (flows 6, 7, §4); FK index for conversation_id.
CREATE INDEX IF NOT EXISTS conversation_activities_conversation_id_position_at_idx
  ON conversation_activities (conversation_id, position_at, id);
-- Per-member change limit: entries with this actor in this workspace over the last 60 s, and the oldest of
-- them for the resume time (flows 5-8, AC-12), counted under the changes:<ws>:<account> advisory lock.
-- FK index for workspace_id and for (workspace_id, actor_account_id).
CREATE INDEX IF NOT EXISTS conversation_activities_workspace_id_actor_created_at_idx
  ON conversation_activities (workspace_id, actor_account_id, created_at);
-- FK indexes for the two assignee FKs (no query reads by them; memberships are never deleted).
CREATE INDEX IF NOT EXISTS conversation_activities_workspace_id_previous_assignee_idx
  ON conversation_activities (workspace_id, previous_assignee_account_id)
  WHERE previous_assignee_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversation_activities_workspace_id_new_assignee_idx
  ON conversation_activities (workspace_id, new_assignee_account_id)
  WHERE new_assignee_account_id IS NOT NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS conversation_activities_workspace_id_new_assignee_idx;
DROP INDEX IF EXISTS conversation_activities_workspace_id_previous_assignee_idx;
DROP INDEX IF EXISTS conversation_activities_workspace_id_actor_created_at_idx;
DROP INDEX IF EXISTS conversation_activities_conversation_id_position_at_idx;
DROP TABLE IF EXISTS conversation_activities;
  `.execute(db);
}
