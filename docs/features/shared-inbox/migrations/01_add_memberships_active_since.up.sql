-- Expand (1/3): memberships.active_since — when the membership last became active (join or reactivation).
-- The unread floor of ADR-0005: messages that arrived before it count as read (AC-01). Nullable until the
-- backfill (02) and the code that writes it on join and reactivation are in; 09 makes it NOT NULL.
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS active_since timestamptz NULL;
