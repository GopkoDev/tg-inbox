-- pings: one row per ping sent to a member's Telegram link, the first half of the ping ledger (ADR-0005,
-- ADR-0006). Owned by notifications. Written with its ping_items and committed BEFORE the Telegram call (at most
-- once); the outcome is written in a short transaction after it:
--   sending  — committed, the call is in flight (or the process died during it: counts, like 'failed')
--   accepted — Telegram accepted it
--   blocked  — 403, the member blocked the bot; the attempt counts and the link gets blocked_at (AC-10)
--   failed   — timeout or network failure after the request may have reached Telegram; counts (SAD §11)
-- A 429 or bot_unavailable answer deletes the ping and, by cascade, its items: Telegram did not accept it, so its
-- conversations stay due (ADR-0006). No text is stored: it is rebuilt from counts only and never logged.
-- opened_at: the member opened (or brought on screen) a tab of the workspace within 15 min of created_at — the
-- spec §7 "ping → panel" KPI (flows 7, 14).
CREATE TABLE IF NOT EXISTS pings (
  id               uuid        NOT NULL,
  workspace_id     uuid        NOT NULL,
  account_id       uuid        NOT NULL,
  telegram_link_id uuid        NOT NULL,
  outcome          text        NOT NULL,
  created_at       timestamptz NOT NULL,
  opened_at        timestamptz NULL,
  CONSTRAINT pings_pkey PRIMARY KEY (id),
  CONSTRAINT pings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT pings_membership_fkey
    FOREIGN KEY (workspace_id, account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT pings_telegram_link_id_fkey FOREIGN KEY (telegram_link_id) REFERENCES telegram_links (id),
  -- Target of ping_items' composite FK, so an item's member is always its ping's member.
  CONSTRAINT pings_id_workspace_id_account_id_key UNIQUE (id, workspace_id, account_id),
  CONSTRAINT pings_outcome_check CHECK (outcome IN ('sending', 'accepted', 'blocked', 'failed')),
  CONSTRAINT pings_opened_at_check CHECK (opened_at >= created_at)
);

-- The 10-min spacing: this member's last ping in the workspace (flows 1, 13); the opened-at update of the member's
-- latest ping within 15 min (flows 7, 14); the "two pings < 10 min apart" integrity query (SAD §7). FK index for
-- workspace_id and (workspace_id, account_id).
CREATE INDEX IF NOT EXISTS pings_workspace_id_account_id_created_at_idx
  ON pings (workspace_id, account_id, created_at);
-- FK index for telegram_link_id; the §7 "bot blocks within 30 days" KPI (first blocked ping per link).
CREATE INDEX IF NOT EXISTS pings_telegram_link_id_idx ON pings (telegram_link_id);

-- ping_items: one row per conversation in a ping, the second half of the ledger. The unique key is "at most once
-- per member, conversation and waiting period" (spec §6), across instances and restarts.
-- workspace_id and account_id are the ping's, enforced by the composite FK to pings; the conversation is a
-- same-workspace conversation (application-kept, like messages.conversation_id).
CREATE TABLE IF NOT EXISTS ping_items (
  id              uuid        NOT NULL,
  workspace_id    uuid        NOT NULL,
  ping_id         uuid        NOT NULL,
  account_id      uuid        NOT NULL,
  conversation_id uuid        NOT NULL,
  waiting_since   timestamptz NOT NULL,
  CONSTRAINT ping_items_pkey PRIMARY KEY (id),
  CONSTRAINT ping_items_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  -- Rolling a ping out (429, bot_unavailable) deletes its items with it.
  CONSTRAINT ping_items_ping_fkey
    FOREIGN KEY (ping_id, workspace_id, account_id) REFERENCES pings (id, workspace_id, account_id) ON DELETE CASCADE,
  CONSTRAINT ping_items_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations (id),
  -- The ledger: never twice per member, conversation and period (flows 1, 13). Also the sweep's read of the
  -- items for the workspace's current periods (conversation_id, waiting_since) for every member, and the FK
  -- index for conversation_id. conversation_id fixes the workspace, so workspace_id is not part of the key.
  CONSTRAINT ping_items_conversation_id_waiting_since_account_id_key
    UNIQUE (conversation_id, waiting_since, account_id)
);

-- FK index for (ping_id, workspace_id, account_id): the cascade on rollout.
CREATE INDEX IF NOT EXISTS ping_items_ping_id_idx ON ping_items (ping_id, workspace_id, account_id);
-- FK index for workspace_id.
CREATE INDEX IF NOT EXISTS ping_items_workspace_id_idx ON ping_items (workspace_id);
