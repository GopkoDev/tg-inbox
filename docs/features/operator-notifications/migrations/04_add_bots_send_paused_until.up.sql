-- The bot's send pause (ADR-0006): set by any Telegram 429 answer on this bot, from a reply or a member message,
-- to now + retry_after (kept at the later value when two answers race). bots.sendMemberMessage refuses while it is
-- in the future; the reply drain never reads it. NULL or a past time: not paused. Nullable for good, so no
-- backfill and no contract; read by workspace through the existing bots_workspace_id_key.
ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS send_paused_until timestamptz NULL;
