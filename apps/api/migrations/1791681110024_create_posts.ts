import { sql, type Kysely } from 'kysely';

// Promoted from docs/features/group-posts/migrations/04_create_posts.{up,down}.sql.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
-- posts: one post of a workspace, from draft to its outcome (ADR-0001, ADR-0004, ADR-0005, ADR-0008).
-- Owned by posts.
--   state          — 'draft' → 'scheduled' → 'sending' → 'published' (→ 'deleted') | 'failed' | 'missed' |
--                    'not_confirmed'; 'scheduled' and later go back to 'draft' only from 'scheduled' (AC-11).
--                    "Publish now" is 'scheduled' for the confirmation moment (flow 4).
--   version        — raised by every draft save and by every return to draft (ADR-0005); a stale save, publish
--                    or schedule is refused.
--   text           — trimmed and 1–4096 UTF-16 units by the shared rule (broadcast-text.ts, broadcasts ADR-0012),
--                    checked in the domain; the database checks only what is implied (no surrounding space, at most
--                    4096 code points, non-empty once it leaves draft).
--   destination_id — NULL only for a draft that has none picked yet.
--   silent         — "send without sound" (Telegram disable_notification).
--   scheduled_for, scheduled_by_account_id, schedule_kind — the owner's confirmed moment (an instant, ADR-0006),
--                    who confirmed it (re-checked at the send, ADR-0005) and 'now' / 'time' for display.
--   sending_started_at — the claim committed before the send (ADR-0004); the 15-minute rule is measured on it and the
--                    daily limit counts it.
--   telegram_message_id, published_at — set when Telegram accepted it; kept after a delete (deleted record).
--   outcome_reason — why a post failed or was missed: 'bot_not_working', 'not_current_bot', 'destination_unavailable',
--                    'no_post_right', 'chat_gone', 'text_refused', 'telegram_error', 'daily_limit',
--                    'service_down', 'bot_paused', 'chat_rate_limited'.
--   needs_attention — shared mark set by failed / missed / not confirmed, cleared by the first member who opens it.
--   draft_notice   — why a post came back to a draft without a member asking: 'owner_deactivated',
--                    'owner_role_changed', 'destination_removed'; cleared by the next save.
--   deleted_*      — the business owner who deleted it from Telegram (AC-15).
-- Member columns are composite FKs to memberships (constraint only), as in broadcasts.
-- Limits (30 sent per 24 h, 100 scheduled) are checked in the domain under the posts:<ws> advisory lock.
CREATE TABLE IF NOT EXISTS posts (
  id                         uuid        NOT NULL,
  workspace_id               uuid        NOT NULL,
  destination_id             uuid        NULL,
  text                       text        NOT NULL,
  silent                     boolean     NOT NULL,
  state                      text        NOT NULL,
  version                    integer     NOT NULL,
  author_account_id          uuid        NOT NULL,
  last_changed_by_account_id uuid        NOT NULL,
  last_changed_at            timestamptz NOT NULL,
  created_at                 timestamptz NOT NULL,
  scheduled_for              timestamptz NULL,
  scheduled_by_account_id    uuid        NULL,
  schedule_kind              text        NULL,
  sending_started_at         timestamptz NULL,
  published_at               timestamptz NULL,
  telegram_message_id        bigint      NULL,
  outcome_reason             text        NULL,
  outcome_at                 timestamptz NULL,
  needs_attention            boolean     NOT NULL,
  draft_notice               text        NULL,
  deleted_at                 timestamptz NULL,
  deleted_by_account_id      uuid        NULL,
  CONSTRAINT posts_pkey PRIMARY KEY (id),
  CONSTRAINT posts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT posts_workspace_id_id_key UNIQUE (workspace_id, id),
  -- A post targets only a destination of its own workspace (AC-04).
  CONSTRAINT posts_destination_fkey
    FOREIGN KEY (workspace_id, destination_id) REFERENCES destinations (workspace_id, id),
  CONSTRAINT posts_author_membership_fkey
    FOREIGN KEY (workspace_id, author_account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT posts_last_changed_by_membership_fkey
    FOREIGN KEY (workspace_id, last_changed_by_account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT posts_scheduled_by_membership_fkey
    FOREIGN KEY (workspace_id, scheduled_by_account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT posts_deleted_by_membership_fkey
    FOREIGN KEY (workspace_id, deleted_by_account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT posts_state_check CHECK (
    state IN ('draft', 'scheduled', 'sending', 'published', 'failed', 'missed', 'not_confirmed', 'deleted')
  ),
  CONSTRAINT posts_version_check CHECK (version >= 1),
  CONSTRAINT posts_text_check CHECK (
    char_length(text) <= 4096 AND text = btrim(text) AND (state = 'draft' OR text <> '')
  ),
  -- Everything past a draft has a destination and an owner's confirmed moment (ADR-0005).
  CONSTRAINT posts_schedule_check CHECK (
    (state = 'draft') = (scheduled_for IS NULL)
    AND (scheduled_for IS NULL) = (scheduled_by_account_id IS NULL)
    AND (scheduled_for IS NULL) = (schedule_kind IS NULL)
    AND (schedule_kind IS NULL OR schedule_kind IN ('now', 'time'))
    AND (state = 'draft' OR destination_id IS NOT NULL)
  ),
  -- A claim exists for every post that was handed to Telegram (ADR-0004); failed may or may not have one.
  CONSTRAINT posts_sending_check CHECK (
    (state IN ('sending', 'published', 'not_confirmed', 'deleted') AND sending_started_at IS NOT NULL)
    OR (state IN ('draft', 'scheduled', 'missed') AND sending_started_at IS NULL)
    OR state = 'failed'
  ),
  CONSTRAINT posts_published_check CHECK (
    (state IN ('published', 'deleted')) = (published_at IS NOT NULL)
    AND (published_at IS NULL) = (telegram_message_id IS NULL)
  ),
  CONSTRAINT posts_outcome_check CHECK (
    (state IN ('failed', 'missed')) = (outcome_reason IS NOT NULL)
    AND (state IN ('published', 'failed', 'missed', 'not_confirmed', 'deleted')) = (outcome_at IS NOT NULL)
  ),
  CONSTRAINT posts_attention_check CHECK (
    NOT needs_attention OR state IN ('failed', 'missed', 'not_confirmed')
  ),
  CONSTRAINT posts_draft_notice_check CHECK (
    draft_notice IS NULL
    OR (state = 'draft' AND draft_notice IN ('owner_deactivated', 'owner_role_changed', 'destination_removed'))
  ),
  CONSTRAINT posts_deleted_check CHECK (
    (state = 'deleted') = (deleted_at IS NOT NULL)
    AND (deleted_at IS NULL) = (deleted_by_account_id IS NULL)
  )
);

-- The Posts list: most recently changed first, all states or one state filter (SCR-36, flow 9).
CREATE INDEX IF NOT EXISTS posts_workspace_id_last_changed_at_idx
  ON posts (workspace_id, last_changed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS posts_workspace_id_state_last_changed_at_idx
  ON posts (workspace_id, state, last_changed_at DESC, id DESC);
-- The 100-scheduled limit, the per-chat order check of the send job and the destination removal (flows 2, 5, 10).
CREATE INDEX IF NOT EXISTS posts_scheduled_idx
  ON posts (workspace_id, destination_id, scheduled_for) WHERE state = 'scheduled';
-- The daily limit: posts handed to Telegram in the last 24 h (flows 2, 4; AC-16).
CREATE INDEX IF NOT EXISTS posts_sent_idx
  ON posts (workspace_id, sending_started_at)
  WHERE state IN ('sending', 'published', 'not_confirmed', 'deleted');
-- The navigation count of posts needing attention (flow 9).
CREATE INDEX IF NOT EXISTS posts_attention_idx
  ON posts (workspace_id) WHERE needs_attention;
-- FK indexes for the composite FKs; the scheduled_by one also serves the deactivation return (flow 6).
CREATE INDEX IF NOT EXISTS posts_workspace_id_destination_id_idx
  ON posts (workspace_id, destination_id) WHERE destination_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_workspace_id_author_account_id_idx
  ON posts (workspace_id, author_account_id);
CREATE INDEX IF NOT EXISTS posts_workspace_id_last_changed_by_account_id_idx
  ON posts (workspace_id, last_changed_by_account_id);
CREATE INDEX IF NOT EXISTS posts_workspace_id_scheduled_by_account_id_idx
  ON posts (workspace_id, scheduled_by_account_id) WHERE scheduled_by_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_workspace_id_deleted_by_account_id_idx
  ON posts (workspace_id, deleted_by_account_id) WHERE deleted_by_account_id IS NOT NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
DROP INDEX IF EXISTS posts_workspace_id_deleted_by_account_id_idx;
DROP INDEX IF EXISTS posts_workspace_id_scheduled_by_account_id_idx;
DROP INDEX IF EXISTS posts_workspace_id_last_changed_by_account_id_idx;
DROP INDEX IF EXISTS posts_workspace_id_author_account_id_idx;
DROP INDEX IF EXISTS posts_workspace_id_destination_id_idx;
DROP INDEX IF EXISTS posts_attention_idx;
DROP INDEX IF EXISTS posts_sent_idx;
DROP INDEX IF EXISTS posts_scheduled_idx;
DROP INDEX IF EXISTS posts_workspace_id_state_last_changed_at_idx;
DROP INDEX IF EXISTS posts_workspace_id_last_changed_at_idx;
DROP TABLE IF EXISTS posts;
  `.execute(db);
}
