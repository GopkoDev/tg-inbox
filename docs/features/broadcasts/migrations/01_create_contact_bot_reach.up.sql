-- contact_bot_reach: whether a contact can be reached through one Telegram bot (ADR-0002, AC-10, AC-14).
-- Owned by contacts. One row per contact and Telegram bot id, so reconnecting the same Telegram bot keeps the
-- marks and connecting a different one finds no rows ("never wrote to the current bot") with no reset job.
--   wrote_at   — when the contact first wrote through that bot (a captured customer message's Telegram send time,
--                kept with LEAST); NULL while only a block or unblock notice is known.
--   blocked_at — since when the contact has blocked that bot; NULL = not blocked. Set by a my_chat_member
--                'kicked' notice or by a send refused as blocked (ADR-0003), cleared by 'member' or a newer message.
--   changed_at — the time of the newest fact applied (Telegram's time for updates and messages, our clock for a
--                refused send). A fact older than changed_at is ignored, so out-of-order updates cannot flip the mark.
-- telegram_bot_id has no FK: a bot row can be deleted before a different Telegram bot is connected, and the rows of
-- the old bot stay (SAD §11 accepted debt). The natural key is the PK, so no id column and no DB default.
-- Every read asks for the current Telegram bot id through the PK (draft breakdown, launch, the sender's turn,
-- the Contacts list and profile marker: flows 7, 8, 10, 12, 16).
CREATE TABLE IF NOT EXISTS contact_bot_reach (
  workspace_id    uuid        NOT NULL,
  contact_id      uuid        NOT NULL,
  telegram_bot_id bigint      NOT NULL,
  wrote_at        timestamptz NULL,
  blocked_at      timestamptz NULL,
  changed_at      timestamptz NOT NULL,
  -- One row per contact and Telegram bot; every lookup for "the current bot" (flows 7, 8, 12, 16) and the
  -- upserts of capture and recordBlockChange (ON CONFLICT); FK index for workspace_id and (workspace_id, contact_id).
  CONSTRAINT contact_bot_reach_pkey PRIMARY KEY (workspace_id, contact_id, telegram_bot_id),
  CONSTRAINT contact_bot_reach_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT contact_bot_reach_contact_fkey
    FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts (workspace_id, id),
  -- Every stored fact is at or before the newest fact applied.
  CONSTRAINT contact_bot_reach_wrote_at_check CHECK (wrote_at <= changed_at),
  CONSTRAINT contact_bot_reach_blocked_at_check CHECK (blocked_at <= changed_at)
);
