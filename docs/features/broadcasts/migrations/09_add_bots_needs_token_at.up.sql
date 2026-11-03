-- bots.needs_token_at: when the bot last stopped working because its token was rejected (review 2026-10-24, AC-12).
-- Pasting the same bot's token again is a rotation that keeps connected_at (the capture epoch), so a broadcast
-- launched before the token was lost cannot tell from connected_at that the bot stopped working meanwhile; a send
-- refuses when needs_token_at is later than the broadcast's launch. Owned by bots. Nullable: never needed a token.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS needs_token_at timestamptz NULL;
