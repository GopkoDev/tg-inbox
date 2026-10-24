import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/broadcasts/migrations/04_create_broadcasts.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- broadcasts: one broadcast of a workspace, from draft to its end (ADR-0001, ADR-0005, ADR-0006, ADR-0009).
-- Owned by broadcasts.
--   status        — 'draft' → 'sending' → 'sent' (finished or aborted) or 'stopped' (a business owner's stop).
--   version       — raised by every save of the name, the text, the audience kind and a tag audience; never by a
--                   group add or remove (ADR-0005). A stale save is refused with the current draft (AC-03).
--   name, text    — tidied by the shared rule in packages/shared/src/broadcast-text.ts (ADR-0012): the name 1–80
--                   graphemes, the text trimmed and 1–4096 UTF-16 code units, both checked in the domain. The database
--                   can count neither, so it checks only what is implied: no surrounding space, and at most 4096
--                   code points (never more than the UTF-16 units). A draft's text may still be empty (the draft
--                   exists from its first valid name, ux-flows); a launch needs a valid text.
--   audience_kind — 'tags' (tag_mode + broadcast_audience_tags) or 'group' (broadcast_group_contacts).
--   tag_mode      — the Contacts filter's 'any' / 'all' / 'none' (no tags); only for a tag audience.
--   last_changed_at / last_changed_by_account_id — the list's order and "who last changed or launched it":
--                   moved by every draft, group, launch and stop write; finish and abort move the time only.
--   launched_*    — set by the launch (ADR-0006): who, when, and the Telegram bot it sends with (AC-10, AC-12).
--   audience_size, blocked_count, never_wrote_count, recipient_count — the breakdown the launch confirmed, frozen,
--                   so the list and the broadcast page never recount a launched audience (sequences flag).
--   stopped_*     — the business owner who stopped it and when (AC-18).
--   ended_at, end_reason — when it left 'sending' and why: 'completed' (every recipient has an outcome),
--                   'text_refused' / 'bot_stopped' (aborted, ADR-0009), 'stopped'.
-- The member columns are cross-module composite FKs to memberships, constraint only: names come through the
-- workspaces app layer, and a deactivated launcher stays a membership row and is still named (AC-16).
-- No DEFAULT: the application supplies every value (UUIDv7 ids from newId()).
-- Limits (10 000 per audience, 10 launches per workspace per 24 h) are checked in the domain under the
-- broadcast row lock and the broadcast-launches:<ws> advisory lock (SAD §8), not by constraints.
CREATE TABLE IF NOT EXISTS broadcasts (
  id                         uuid        NOT NULL,
  workspace_id               uuid        NOT NULL,
  name                       text        NOT NULL,
  text                       text        NOT NULL,
  status                     text        NOT NULL,
  version                    integer     NOT NULL,
  audience_kind              text        NOT NULL,
  tag_mode                   text        NULL,
  author_account_id          uuid        NOT NULL,
  last_changed_by_account_id uuid        NOT NULL,
  last_changed_at            timestamptz NOT NULL,
  created_at                 timestamptz NOT NULL,
  launched_at                timestamptz NULL,
  launched_by_account_id     uuid        NULL,
  launch_telegram_bot_id     bigint      NULL,
  audience_size              integer     NULL,
  blocked_count              integer     NULL,
  never_wrote_count          integer     NULL,
  recipient_count            integer     NULL,
  stopped_at                 timestamptz NULL,
  stopped_by_account_id      uuid        NULL,
  ended_at                   timestamptz NULL,
  end_reason                 text        NULL,
  CONSTRAINT broadcasts_pkey PRIMARY KEY (id),
  CONSTRAINT broadcasts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  -- Target of the composite FKs from broadcast_audience_tags, broadcast_group_contacts, broadcast_recipients and
  -- broadcast_items: every row of a broadcast is of its workspace (AC-08). Also every read and the row lock
  -- FOR NO KEY UPDATE by (workspace, id) (flows 6–15, seeded flows 1, 4) and inbox's itemDetails (flow 18).
  CONSTRAINT broadcasts_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT broadcasts_author_membership_fkey
    FOREIGN KEY (workspace_id, author_account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT broadcasts_last_changed_by_membership_fkey
    FOREIGN KEY (workspace_id, last_changed_by_account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT broadcasts_launched_by_membership_fkey
    FOREIGN KEY (workspace_id, launched_by_account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT broadcasts_stopped_by_membership_fkey
    FOREIGN KEY (workspace_id, stopped_by_account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT broadcasts_status_check CHECK (status IN ('draft', 'sending', 'sent', 'stopped')),
  CONSTRAINT broadcasts_version_check CHECK (version >= 1),
  CONSTRAINT broadcasts_name_check CHECK (name <> '' AND name = btrim(name)),
  CONSTRAINT broadcasts_text_check CHECK (
    char_length(text) <= 4096 AND text = btrim(text) AND (status = 'draft' OR text <> '')
  ),
  CONSTRAINT broadcasts_audience_kind_check CHECK (audience_kind IN ('tags', 'group')),
  -- A tag audience has a match mode; a group has none.
  CONSTRAINT broadcasts_tag_mode_check CHECK (
    (audience_kind = 'tags' AND tag_mode IS NOT NULL AND tag_mode IN ('any', 'all', 'none'))
    OR (audience_kind = 'group' AND tag_mode IS NULL)
  ),
  -- Everything the launch freezes exists exactly when the broadcast was launched (AC-06, AC-09).
  CONSTRAINT broadcasts_launch_check CHECK (
    (status = 'draft') = (launched_at IS NULL)
    AND (launched_at IS NULL) = (launched_by_account_id IS NULL)
    AND (launched_at IS NULL) = (launch_telegram_bot_id IS NULL)
    AND (launched_at IS NULL) = (audience_size IS NULL)
    AND (launched_at IS NULL) = (blocked_count IS NULL)
    AND (launched_at IS NULL) = (never_wrote_count IS NULL)
    AND (launched_at IS NULL) = (recipient_count IS NULL)
  ),
  -- The frozen breakdown adds up: audience = blocked + never wrote to the current bot + recipients, at most 10 000
  -- contacts, at least one recipient (AC-05, AC-06, AC-09).
  CONSTRAINT broadcasts_breakdown_check CHECK (
    blocked_count >= 0 AND never_wrote_count >= 0 AND recipient_count >= 1
    AND audience_size = blocked_count + never_wrote_count + recipient_count
    AND audience_size <= 10000
  ),
  -- Only a stopped broadcast names who stopped it (AC-18).
  CONSTRAINT broadcasts_stop_check CHECK (
    (status = 'stopped') = (stopped_at IS NOT NULL)
    AND (stopped_at IS NULL) = (stopped_by_account_id IS NULL)
  ),
  -- An ended broadcast has its end time and reason; 'stopped' is the reason exactly when the status is stopped.
  CONSTRAINT broadcasts_end_check CHECK (
    (status IN ('sent', 'stopped')) = (ended_at IS NOT NULL)
    AND (ended_at IS NULL) = (end_reason IS NULL)
    AND (end_reason IN ('completed', 'text_refused', 'bot_stopped', 'stopped'))
    AND (status = 'stopped') = (end_reason = 'stopped')
  )
);

-- The Broadcasts list: every broadcast of a workspace, most recently changed first (flow 5, AC-01); FK index for
-- workspace_id.
CREATE INDEX IF NOT EXISTS broadcasts_workspace_id_last_changed_at_idx
  ON broadcasts (workspace_id, last_changed_at DESC, id DESC);
-- The launch cap: launches of the workspace in the last 24 h and the 10th newest for next_launch_at (flow 10,
-- seeded flow 1, AC-09). A stopped or aborted broadcast keeps launched_at, so it counts.
CREATE INDEX IF NOT EXISTS broadcasts_workspace_id_launched_at_idx
  ON broadcasts (workspace_id, launched_at) WHERE launched_at IS NOT NULL;
-- The send link's broadcasts: the workspace's sending broadcasts, oldest launch first, for the turns and the
-- "a broadcast still sends" successor check (flow 14, ADR-0007, ADR-0008).
CREATE INDEX IF NOT EXISTS broadcasts_sending_idx
  ON broadcasts (workspace_id, launched_at) WHERE status = 'sending';
-- FK indexes for the member composite FKs.
CREATE INDEX IF NOT EXISTS broadcasts_workspace_id_author_account_id_idx
  ON broadcasts (workspace_id, author_account_id);
CREATE INDEX IF NOT EXISTS broadcasts_workspace_id_last_changed_by_account_id_idx
  ON broadcasts (workspace_id, last_changed_by_account_id);
CREATE INDEX IF NOT EXISTS broadcasts_workspace_id_launched_by_account_id_idx
  ON broadcasts (workspace_id, launched_by_account_id) WHERE launched_by_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS broadcasts_workspace_id_stopped_by_account_id_idx
  ON broadcasts (workspace_id, stopped_by_account_id) WHERE stopped_by_account_id IS NOT NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS broadcasts_workspace_id_stopped_by_account_id_idx;
DROP INDEX IF EXISTS broadcasts_workspace_id_launched_by_account_id_idx;
DROP INDEX IF EXISTS broadcasts_workspace_id_last_changed_by_account_id_idx;
DROP INDEX IF EXISTS broadcasts_workspace_id_author_account_id_idx;
DROP INDEX IF EXISTS broadcasts_sending_idx;
DROP INDEX IF EXISTS broadcasts_workspace_id_launched_at_idx;
DROP INDEX IF EXISTS broadcasts_workspace_id_last_changed_at_idx;
DROP TABLE IF EXISTS broadcasts;
  `.execute(db);
}
