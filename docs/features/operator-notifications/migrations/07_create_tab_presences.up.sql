-- tab_presences: one presence lease per open live connection of a workspace tab (ADR-0002). Owned by
-- notifications, written through the inbox hub's lifecycle calls, every one scoped by the socket's workspace id.
--   id                — the connection id, a UUIDv7 the hub generates per socket
--   live_until        — moved to now + 50 s on every pong (every 25 s); the lease counts while it is in the future
--   on_screen         — the tab's last reported Page Visibility state
--   last_on_screen_at — stamped when the tab leaves the screen; NULL for a tab that opened hidden and never showed
--   opened_at         — when the connection opened
-- A member is away for a workspace when no row of theirs has live_until > now AND (on_screen OR
-- last_on_screen_at > now - 10 min). A clean close deletes the row; a lost connection leaves it to expire, and
-- expired rows are deleted by the workspace's sweep and by the member's next open (SAD §2 retention: the
-- connection's life plus at most one lease).
CREATE TABLE IF NOT EXISTS tab_presences (
  id                uuid        NOT NULL,
  workspace_id      uuid        NOT NULL,
  account_id        uuid        NOT NULL,
  live_until        timestamptz NOT NULL,
  on_screen         boolean     NOT NULL,
  last_on_screen_at timestamptz NULL,
  opened_at         timestamptz NOT NULL,
  CONSTRAINT tab_presences_pkey PRIMARY KEY (id),
  CONSTRAINT tab_presences_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT tab_presences_membership_fkey
    FOREIGN KEY (workspace_id, account_id) REFERENCES memberships (workspace_id, account_id),
  CONSTRAINT tab_presences_live_until_check CHECK (live_until > opened_at),
  CONSTRAINT tab_presences_last_on_screen_at_check CHECK (last_on_screen_at >= opened_at)
);

-- The away predicate per member at send time (flow 1) and for the sweep's presence rows of a workspace
-- (flow 13: workspace prefix); the expired-lease delete of a workspace (sweep) and of one member (on open); FK
-- index for workspace_id and (workspace_id, account_id). Alive / screen / closed address one row by PK, with
-- workspace_id as a filter.
CREATE INDEX IF NOT EXISTS tab_presences_workspace_id_account_id_live_until_idx
  ON tab_presences (workspace_id, account_id, live_until);
