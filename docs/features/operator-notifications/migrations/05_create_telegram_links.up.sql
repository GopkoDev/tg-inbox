-- telegram_links: one membership's opt-in connection to the member's personal Telegram account through the
-- workspace's business bot (ADR-0001, ADR-0004). Owned by notifications. A link is live while removed_at IS NULL.
-- A removed row is kept, with its times and reason, for the spec §7 KPIs (members with a link, unlinks within
-- 30 days); its display name is cleared in the removing transaction and its Telegram user id as soon as nothing
-- needs it (see telegram_links_telegram_user_id_check) — SAD §2 retention.
-- Bound to the bot's Telegram id, not to the bots row (a disconnected bot row with no conversations is deleted,
-- bot-connection ADR-0007): a token rotation keeps the id and the link, a different bot removes it
-- ('bot_replaced', flow 16). account_id is a cross-module composite FK to memberships (workspace_id, account_id),
-- constraint only, like conversations.assignee_account_id: notifications never reads memberships.
CREATE TABLE IF NOT EXISTS telegram_links (
  id               uuid        NOT NULL,
  workspace_id     uuid        NOT NULL,
  account_id       uuid        NOT NULL,
  telegram_bot_id  bigint      NOT NULL,
  telegram_user_id bigint      NULL,
  display_name     text        NULL,
  linked_at        timestamptz NOT NULL,
  blocked_at       timestamptz NULL,
  last_notice_at   timestamptz NULL,
  removed_at       timestamptz NULL,
  removed_reason   text        NULL,
  CONSTRAINT telegram_links_pkey PRIMARY KEY (id),
  CONSTRAINT telegram_links_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT telegram_links_membership_fkey
    FOREIGN KEY (workspace_id, account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT telegram_links_removed_reason_check
    CHECK (removed_reason IN ('member', 'deactivated', 'bot_replaced')),
  CONSTRAINT telegram_links_removed_pair_check CHECK ((removed_at IS NULL) = (removed_reason IS NULL)),
  -- The display name lives exactly as long as the link (shown only to that member, SCR-16).
  CONSTRAINT telegram_links_display_name_check CHECK ((removed_at IS NULL) = (display_name IS NOT NULL)),
  -- A live link always has its Telegram user id. A link the member removed keeps it only until the "notifications
  -- are off" answer job has finished (sent, refused or given up), which then clears it: that job carries the link
  -- id, never the Telegram id (data-model assumption 3). Deactivation and a different bot send no answer, so they
  -- clear it in the removing transaction.
  CONSTRAINT telegram_links_telegram_user_id_check CHECK (
    (removed_at IS NULL AND telegram_user_id IS NOT NULL)
    OR (removed_at IS NOT NULL AND (removed_reason = 'member' OR telegram_user_id IS NULL))
  ),
  CONSTRAINT telegram_links_removed_at_check CHECK (removed_at >= linked_at),
  CONSTRAINT telegram_links_blocked_at_check CHECK (blocked_at >= linked_at)
);

-- One live link per membership (AC-06), the redeem's backstop; my link state (flows 8, 9, 18: by workspace and
-- account among live rows); the sweep's and Team's live links of a workspace (flows 13, 15: workspace prefix);
-- the bot-connected hook's live links of a workspace whose bot id differs (flow 16: workspace prefix, at most
-- tens of rows); the cron backstop's "workspaces with a live link" (controlled tenancy exception, ADR-0005).
CREATE UNIQUE INDEX IF NOT EXISTS telegram_links_live_workspace_id_account_id_key
  ON telegram_links (workspace_id, account_id)
  WHERE removed_at IS NULL;
-- One live link per Telegram user per workspace (AC-06), the redeem's backstop; the inbound interceptor's one
-- indexed read per private update: is this sender linked in this workspace, and with this bot (flow 11, ADR-0003).
CREATE UNIQUE INDEX IF NOT EXISTS telegram_links_live_workspace_id_telegram_user_id_key
  ON telegram_links (workspace_id, telegram_user_id)
  WHERE removed_at IS NULL;
-- FK index for workspace_id and (workspace_id, account_id) over every row, live and removed; the §7 unlink KPI
-- per member.
CREATE INDEX IF NOT EXISTS telegram_links_workspace_id_account_id_idx
  ON telegram_links (workspace_id, account_id, linked_at);
