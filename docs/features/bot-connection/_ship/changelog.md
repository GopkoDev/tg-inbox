# Changelog — bot-connection

## bot-connection — a business connects its own Telegram bot, and every private message becomes a conversation with a contact

**What:** A workspace can now receive what its customers write in Telegram.

- A business owner opens *Bot* in the panel, pastes the token of the business's BotFather bot and sees the bot's name, username and the state "connected". Surrounding spaces are ignored. The token is never shown again, never logged and never returned by any endpoint.
- From then on, every private message a person sends to the bot is captured into the workspace exactly once and in the customer's order. This includes `/start`, text, photos, voice notes, stickers, files, locations, album items and unknown kinds (marked "other"). Each person gets one continuous conversation. Their first message creates a contact from the Telegram profile (name, username, language), and newer messages refresh it.
- Edits of a captured text or caption replace it in place and are marked as edited. When edits arrive out of order, Telegram's edit time decides which one wins. Redeliveries take their original place and are never stored twice.
- Group, channel, bot-to-bot and Telegram Business messages are ignored. Deliveries that do not carry the bot's webhook secret are refused.
- The settings page shows the state, which is checked with Telegram in the background at least every 5 minutes. It also shows the time of the last message and the number of contacts. There are three problem states:
  - **"Not working — needs a new token"**: the token was revoked or the bot was deleted.
  - **"Not receiving messages — another service took them over"**: the owner can reconnect with the stored token.
  - **"Not connected"**.
- An owner can rotate the token by pasting a new token of the same bot. An owner can also disconnect the bot, which deletes its webhook and forgets the token. Captured contacts and conversations stay, and connecting the same bot again continues them.
- The system refuses these cases with clear messages:
  - a bot that belongs to another workspace (the other workspace is never named);
  - a second, different bot for a workspace that already has one, or that has captured history through one;
  - a takeover of a bot that delivers to another service, until the owner confirms.
- Only business owners see or manage the bot. Operators get "only business owners manage the bot", and non-members get a plain 404.

**Why:** Nothing customers wrote reached tg-inbox, so the inbox, contacts and broadcasts steps had no data to work with. This is roadmap step 3: see [spec](../spec.md) §1–§2. Key decisions:

- [ADR-0002](../adr/0002-receive-updates-through-one-webhook-per-bot-authenticated-by-a-per-bot-secret.md): one webhook per bot, authenticated by a per-bot secret. **Amended 2026-10-12:** the secret is derived as `HMAC-SHA256(BOT_TOKEN_ENCRYPTION_KEY, bot id ‖ capture epoch)`, so rotation and reconnect can register the same secret again. Only its hash is stored.
- [ADR-0003](../adr/0003-capture-each-update-inside-the-webhook-request-with-idempotent-writes.md): each update is captured inside the webhook request with idempotent writes. [ADR-0004](../adr/0004-order-messages-by-telegram-message-id-and-apply-edits-by-telegram-edit-time.md): ordering follows Telegram's message id, and edits are applied by edit time.
- [ADR-0005](../adr/0005-split-the-feature-into-bots-conversations-and-contacts-modules.md): three new modules, `bots`, `conversations` and `contacts`.
- [ADR-0006](../adr/0006-encrypt-bot-tokens-at-rest-with-an-application-key.md): tokens are encrypted at rest with AES-256-GCM under an application key.
- [ADR-0007](../adr/0007-bind-a-bot-to-one-workspace-with-unique-constraints-and-two-controlled-tenancy-exceptions.md): one bot per workspace, enforced by unique constraints, plus two controlled tenancy exceptions (the webhook lookup by bot id and the cross-workspace ownership check).
- [ADR-0008](../adr/0008-check-bot-health-with-a-scheduled-job-and-show-the-stored-state.md): health is checked by a scheduled pg-boss job, and the page shows the stored state.

**How to use:** In the panel, open *Bot* (business owners only), paste the BotFather token and confirm. The HTTP surface is in [openapi.yaml](../contracts/openapi.yaml):

- `GET /api/workspaces/:id/bot`: the settings.
- `POST /api/workspaces/:id/bot/token`: connect, rotate or paste again. Send `confirm_takeover: true` after the takeover warning.
- `POST /api/workspaces/:id/bot/reconnect`: re-register with the stored token after a takeover.
- `POST /api/workspaces/:id/bot/disconnect`.
- `POST /api/telegram/webhook/:botId`: Telegram's ingress, authenticated by `X-Telegram-Bot-Api-Secret-Token`.

**Operational notes:**

- **Migration:** adds four reversible migrations, from `1791681109979_create_bots` to `1791681109982_create_messages`. Run `pnpm db:migrate` on deploy, before the new API starts.
- **Config:**
  - **`BOT_TOKEN_ENCRYPTION_KEY` is new and required.** It is a 32-byte base64 key (`openssl rand -base64 32`). The API refuses to start without it. **Back it up:** if it is lost, every stored token becomes unreadable and every bot shows "needs a new token" until its owner pastes the token again. Rotating it also changes every derived webhook secret (ADR-0002 amendment). Each bot's webhook is re-registered with its new secret on the next owner action (paste or reconnect). There is no key-rotation procedure yet: plan one together with the deferred associated-data change below.
  - `TELEGRAM_WEBHOOK_BASE_URL` (optional, defaults to `PUBLIC_WEB_URL`) must be a **public HTTPS** origin. Telegram delivers only to HTTPS, and this is enforced when `NODE_ENV=production`.
  - `TELEGRAM_WEBHOOK_MAX_CONNECTIONS` (default 10, and always below `DATABASE_POOL_MAX`) is optional.
  - `TELEGRAM_API_ROOT` (optional) exists for tests only.
- **Jobs:** `buildApp()` registers the pg-boss queues `bots.schedule-health-checks` (cron) and `bots.check-health`.
- **Feature flag:** none.
- **Rollback:**
  1. Disconnect connected bots first, so Telegram stops posting to a route that no longer exists. Otherwise the bots keep a dead webhook until they are connected again.
  2. Revert the deploy.
  3. Run `pnpm db:rollback` four times. This drops `messages`, `conversations`, `contacts` and `bots`, and every captured conversation is lost.
- **Not yet done:**
  - No public HTTPS host exists yet, so a real-bot connection and the `full` pre-pilot load run (`pnpm --filter @tg/api load -- --profile full`) are still pending.
  - Deferred (spec §8): AES-GCM associated-data binding of stored tokens, due before the first key rotation; proactive bot-down alerts (step 6); a read-only bot view for operators (step 4).

**Acceptance criteria delivered:**

| Area | Criteria |
|---|---|
| Connecting and refusals | AC-01, AC-02, AC-03, AC-04, AC-05, AC-06 |
| Capture, contacts and isolation | AC-07, AC-08, AC-09, AC-10, AC-11, AC-12, AC-13, AC-14 |
| Health and recovery | AC-15, AC-16, AC-16b |
| Rotation and disconnect | AC-17, AC-18, AC-19 |
