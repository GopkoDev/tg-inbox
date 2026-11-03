-- destinations: a Telegram channel or group connected to a workspace with a connect code (ADR-0002, ADR-0003).
-- Owned by posts. One row per chat per workspace: a code posted in a known chat revives the same row (spec
-- Clarifications), so the 20-destination limit and the posts' history follow the chat.
--   telegram_bot_id — the Telegram bot the chat was connected with; a different current bot makes it unavailable
--                     at read time (no hook into posts), reconnecting the same bot keeps it (AC-14).
--   chat_id         — Telegram chat id (negative); moved to the new id when a group is upgraded (flow 7).
--   kind            — 'channel' or 'group' (a supergroup is a group to the team).
--   title, username — as Telegram shows them; refreshed on rename (flow 7). Never logged.
--   availability, problem — the bot's rights in the chat as Telegram last told it (flow 7, AC-13):
--                     'available', or 'unavailable' with 'no_post_right' / 'not_member' / 'chat_gone'.
--   membership_changed_at — Telegram time of the newest membership fact applied; an older fact is ignored.
--   paused_until    — Telegram's per-chat limit after a 429 to a post (ADR-0007); never the bot's send pause.
--   next_send_at    — last post sent to the chat + 3 s, the per-chat pace (ADR-0007).
--   removed_*       — a business owner's removal; a later code revives the row and clears them.
-- Member columns are composite FKs to memberships (constraint only), as in broadcasts.
-- The 20-destination limit is checked in the domain under the posts:<ws> advisory lock.
CREATE TABLE IF NOT EXISTS destinations (
  id                      uuid        NOT NULL,
  workspace_id            uuid        NOT NULL,
  telegram_bot_id         bigint      NOT NULL,
  chat_id                 bigint      NOT NULL,
  kind                    text        NOT NULL,
  title                   text        NOT NULL,
  username                text        NULL,
  availability            text        NOT NULL,
  problem                 text        NULL,
  membership_changed_at   timestamptz NOT NULL,
  paused_until            timestamptz NULL,
  next_send_at            timestamptz NULL,
  connected_by_account_id uuid        NOT NULL,
  connected_at            timestamptz NOT NULL,
  removed_at              timestamptz NULL,
  removed_by_account_id   uuid        NULL,
  CONSTRAINT destinations_pkey PRIMARY KEY (id),
  CONSTRAINT destinations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  -- Target of posts' composite FK: a post's destination is of its workspace (AC-04).
  CONSTRAINT destinations_workspace_id_id_key UNIQUE (workspace_id, id),
  -- One destination per chat per workspace; also the inbound lookup by (workspace, chat) (flows 1, 7).
  CONSTRAINT destinations_workspace_id_chat_id_key UNIQUE (workspace_id, chat_id),
  CONSTRAINT destinations_connected_by_membership_fkey
    FOREIGN KEY (workspace_id, connected_by_account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT destinations_removed_by_membership_fkey
    FOREIGN KEY (workspace_id, removed_by_account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT destinations_chat_id_check CHECK (chat_id < 0),
  CONSTRAINT destinations_kind_check CHECK (kind IN ('channel', 'group')),
  CONSTRAINT destinations_title_check CHECK (title <> ''),
  CONSTRAINT destinations_username_check CHECK (username IS NULL OR username <> ''),
  CONSTRAINT destinations_availability_check CHECK (
    (availability = 'available' AND problem IS NULL)
    OR (availability = 'unavailable' AND problem IN ('no_post_right', 'not_member', 'chat_gone'))
  ),
  CONSTRAINT destinations_removed_check CHECK ((removed_at IS NULL) = (removed_by_account_id IS NULL))
);

-- Settings list and the 20 limit: the workspace's destinations not removed (flow 10, SCR-33).
CREATE INDEX IF NOT EXISTS destinations_workspace_id_live_idx
  ON destinations (workspace_id, connected_at) WHERE removed_at IS NULL;
-- FK indexes for the member composite FKs.
CREATE INDEX IF NOT EXISTS destinations_workspace_id_connected_by_account_id_idx
  ON destinations (workspace_id, connected_by_account_id);
CREATE INDEX IF NOT EXISTS destinations_workspace_id_removed_by_account_id_idx
  ON destinations (workspace_id, removed_by_account_id) WHERE removed_by_account_id IS NOT NULL;
