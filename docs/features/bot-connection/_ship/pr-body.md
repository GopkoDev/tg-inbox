## Summary

This PR ships roadmap step 3, bot connection and inbound capture.

- A business owner pastes the token of the business's own BotFather bot in the panel and sees which bot it is and whether it works.
- From then on, every private message an end customer sends to that bot is captured exactly once and in order, into one continuous conversation per customer. The first message auto-creates a contact from the Telegram profile.
- Owners see the bot's health and can rotate the token, reconnect after a takeover and disconnect, without losing captured data.

See the [spec](docs/features/bot-connection/spec.md) and the [changelog](docs/features/bot-connection/_ship/changelog.md).

## For the human reviewer

1. **The webhook secret is derived, not random.** It is `HMAC-SHA256(BOT_TOKEN_ENCRYPTION_KEY, bot id ‖ capture epoch)`, base64url, and only its SHA-256 hash is stored. [ADR-0002](docs/features/bot-connection/adr/0002-receive-updates-through-one-webhook-per-bot-authenticated-by-a-per-bot-secret.md) is amended (status stays Accepted), and so is `sad.md` §8. Deriving it lets rotation and reconnect register the same secret again. **Rotating the encryption key therefore changes every webhook secret**: each bot's webhook is re-registered on the next owner action. There is no key-rotation procedure yet.
2. **`BOT_TOKEN_ENCRYPTION_KEY` is a new required key.** It is 32 bytes, base64. The API refuses to start without it. **It must be backed up**: if it is lost, every stored token becomes unreadable, and every bot needs its token pasted again.
3. **There is no public HTTPS host yet.** Nothing here was run against real Telegram. Every Telegram exchange below went to the scriptable fake Bot API (`apps/api/src/test/fake-telegram.ts`), whose answers are recorded from the Bot API docs. A real-bot connection (BotFather token → `setWebhook` → real deliveries) and the `full` pre-pilot load run (`pnpm --filter @tg/api load -- --profile full`) are **still pending** until a public HTTPS host exists.
4. **Deferred** (spec §8, each with an owner and a due point):
   - AES-GCM associated-data binding of stored tokens to their bot (review R1-13), due before the first key rotation.
   - Proactive bot-down alerts (with step 6, notifications).
   - A read-only bot view for operators (with step 4, inbox).
5. **Two review nits are accepted, not fixed** (round 4):
   - **R4-02:** two rotations whose `clock.now()` fall in the same millisecond can both match the undo guard of a failed `setWebhook`. This needs two pastes within 1 ms plus a failed `setWebhook`. A per-write version column would cost a migration for no realistic gain.
   - **R4-04:** when the row keeps changing under a paste, the 503 "try again" says "Telegram is not responding". The shape is right but the stated cause is wrong. This needs two row changes in a row, and a precise message would need a new contract code.

## Acceptance criteria

- AC-01: pasting a token (spaces trimmed) connects the bot and shows its name, username and "connected", and the token is never shown again ✓
- AC-02: a non-token or a token Telegram rejects changes nothing and says "copy it again from BotFather" ✓
- AC-03: operators are refused ("only business owners"), and non-members get no hint the workspace exists ✓
- AC-04: a bot that belongs to another workspace is refused without naming it ✓
- AC-05: a workspace keeps one business bot, while connected and once it has history ✓
- AC-06: a bot that delivers to another service needs explicit takeover confirmation ✓
- AC-07: the first message creates a contact and a conversation and sets "last message received" ✓
- AC-08: a later message continues the conversation and refreshes the profile ✓
- AC-09: every message kind is captured in order, marked with its kind (unknown → "other"), with its caption ✓
- AC-10: edits replace the text or caption in place, Telegram edit time wins, and an edit of an uncaptured message is dropped ✓
- AC-11: a redelivered message is stored once, in its original place ✓
- AC-12: group, channel, bot and Business-account messages are not captured ✓
- AC-13: one person writing to two workspaces' bots gives two isolated contacts ✓
- AC-14: a delivery without the bot's secret is ignored ✓
- AC-15: the settings show identity, state, last message time and contact count, never the token, and are at most 5 minutes old ✓
- AC-16: a revoked or deleted bot shows "needs a new token" and keeps captured data ✓
- AC-16b: a taken-over bot shows "another service took them over", and reconnecting with the stored token goes through the AC-06 warning ✓
- AC-17: a new token of the same bot rotates and continues the existing conversations ✓
- AC-18: disconnect deletes the webhook, forgets the token, never captures later messages and keeps the data ✓
- AC-19: connecting the same bot again continues the existing conversations without duplicate contacts ✓

## Design

- Spec: `docs/features/bot-connection/spec.md` (with `ux-flows.md`, `screens.md` and `test-plan.md`)
- Architecture: `docs/features/bot-connection/sad.md`
- Decisions: `docs/features/bot-connection/adr/`, ADR-0001 to ADR-0008 (ADR-0002 amended 2026-10-12)
- Data model and migrations: `docs/features/bot-connection/data-model.md` (migrations `1791681109979` to `1791681109982`)
- API: `docs/features/bot-connection/contracts/openapi.yaml`
- Review: `docs/features/bot-connection/_review/`:
  - Round 1: R1-01 to R1-18; 17 fixed, R1-13 deferred.
  - Round 2: R2-01 to R2-06, all fixed.
  - Round 3: R3-01 to R3-05, all fixed.
  - Round 4: **PASS**. R4-01 and R4-03 fixed; R4-02 and R4-04 accepted.
- Conventions: `CLAUDE.md` and `docs/architecture-map.md` cover the new modules, the two new tenancy exceptions and the new config.

## Tasks (SDD-Task trailers)

<details><summary>27 task commits</summary>

- `868348a` feat(bot-connection): Promote the four staged migrations and regenerate DB types
- `90310f5` feat(bot-connection): Add platform primitives: bot error codes incl. the first 5xx, owner-guard message, config keys, Bot API root, secret-header redaction
- `9bc67e7` feat(bot-connection): Build the scriptable fake Telegram Bot API and the webhook update builder for tests
- `58999db` feat(bot-connection): Implement the bots domain: token check, connection states, inbound filter, update normalisation, due rule
- `480b138` feat(bot-connection): Implement the conversations and contacts domain rules: message kinds, edit rule, profile refresh
- `0fc9dde` feat(bot-connection): Define the bots zod contracts in packages/shared
- `087489f` feat(bot-connection): Build the contacts module: repository with isolation tests, upsert-from-profile and count use cases
- `56b1a46` feat(bot-connection): Build the conversation and message repositories with cross-workspace isolation tests
- `43ddfbe` feat(bot-connection): Build the bot repository, the AES-GCM token cipher and webhook secrets, with isolation tests incl. the two controlled exceptions
- `f809677` feat(bot-connection): Build the Telegram gateway: getMe, getWebhookInfo, setWebhook, deleteWebhook with typed outcomes and timeouts
- `2999323` feat(bot-connection): Implement the conversations app layer: capture inbound message, apply edit, last message time, has conversations
- `a16dc40` feat(bot-connection): Implement the scheduled health check: run-health-check use case and the bots.schedule-health-checks / bots.check-health jobs
- `7f14692` feat(bot-connection): Lay the web bot foundation: bot API client, store, /w/:workspaceId/bot route and the owner-only Bot entry in AppShell (SCR-01)
- `efd4228` feat(bot-connection): Implement the bots use cases get-settings and paste-token (connect, rotate, connect again, refusals, takeover confirmation)
- `b584fdc` feat(bot-connection): Implement the bots use case accept-webhook-update: secret check, inbound filter, capture epoch, hand-off to conversations
- `d7bae55` feat(bot-connection): Build SCR-02 Bot settings with every declared state
- `2e5c63b` feat(bot-connection): Implement the bots use cases reconnect-with-stored-token and disconnect
- `d0f4a61` feat(bot-connection): Build SCR-03 Paste token dialog with every declared state
- `816bdf9` feat(bot-connection): Expose the owner-only bot routes and wire the bots, conversations and contacts modules into buildDeps / buildApp
- `2281e27` feat(bot-connection): Build SCR-04 Confirm takeover and SCR-05 Confirm disconnect
- `84eb487` feat(bot-connection): Expose the Telegram webhook route with secret-before-parse, empty-body 401/200 and fail-closed 500
- `f2c7945` feat(bot-connection): Register the health-check workers in buildApp and prove five-minute freshness over a simulated hour
- `e618d7d` feat(bot-connection): Update CLAUDE.md, the architecture map, the workspace-operators SAD and the design system for the new modules, exceptions and config
- `7591f07` feat(bot-connection): Add the three API-level end-to-end stories: capture lifecycle, edits and redeliveries, health and recovery
- `417cb03` feat(bot-connection): Add the token-secrecy suite: no token, secret or message text in any log line or response across every bot flow
- `a208c3e` feat(bot-connection): Write the load-test script for throughput, flood isolation, owner actions and settings load (runnable locally, run pre-pilot)
- `5967192` feat(bot-connection): Add the seven browser end-to-end flows for bot settings against the fake Bot API

</details>

Review-fix commits:

- `cff794c` drop bot action responses for a workspace the page has left
- `615940d` apply edits by edit time against the epoch and apply caption removal
- `077fb96` survive concurrent pastes, lost token keys and owner-action races
- `b107683` no false takeover warning for tg-inbox's own stale webhook; https webhooks in production
- `3324a81` a workspace switch drops the bot dialogs and a pending pasted token
- `80a378c` paste writes only onto the row it decided on
- `39e3ac9` undo a failed setWebhook only on this paste's own write
- `30a8828` document the disconnect re-run and pin rotate-over-rotate undo

## Verification

All checks ran on Node 26.11.1 at `ca2dc73`, with Docker running.

- **Tests:** `pnpm test` passed: 113 files and 1122/1122 tests, including the Testcontainers integration suites and the token-secrecy suite.
- **Browser e2e:** `pnpm --filter @tg/web test:e2e` (Playwright, chromium) passed 14/14: 7 bot-settings flows and 7 earlier flows. They ran against the built SPA, an ephemeral Postgres and the fake Bot API.
- **Lint, types and build:** `pnpm lint` (eslint, prettier and tsc) is clean, and `pnpm -r build` is clean.
- **Load (smoke profile only):** `pnpm --filter @tg/api load -- --scenario all --profile smoke` passed every scenario: flood isolation, throughput, owner actions (p95 945 ms with 300 ms of fake Telegram latency) and settings load (p95 36 ms). The `full` profile is pending a production-like host.
- **Live run:** I ran a real listening API (`buildApp()` + `listen` on :4477) against a throwaway Postgres 16 with all migrations, with Telegram replaced by the fake Bot API. I drove it over HTTP with `fetch`: the owner sessions came from the admin CLI and invitation accept, and the deliveries were POSTs carrying the secret the fake recorded from `setWebhook`. What I observed:
  - AC-03: an operator got 403 `OWNER_ONLY` on GET and on paste. Bolt's owner got 404 `NOT_FOUND` on Acme's bot.
  - AC-02: `"not a token"` and a token the fake answers 401 for both got 400 `BOT_TOKEN_INVALID`, "The token is not valid — copy it again from BotFather".
  - AC-01: a token with surrounding spaces returned 200 with `state=connected` and `{name:"Acme Flowers Support", username:"acme_flowers_bot"}`, and the response body did not contain the token. `setWebhook` was called with `…/api/telegram/webhook/<bot id>` and a 43-character secret.
  - AC-07: the first `/start` returned 200 in 7 ms and created 1 contact and 1 conversation. The settings showed `last_message_received_at` and `contacts_count=1`.
  - AC-08: the next message under a new first name still gave 1 contact, now named "New Name", and 2 messages.
  - AC-11: redelivering `message_id 2` kept the count at 2 messages.
  - AC-14: a delivery with the wrong secret got 401, and no contact was created.
  - AC-12: a supergroup message and a message from a bot sender both got 200, and nothing was captured.
  - AC-04: Bolt pasting Acme's token got 409 `BOT_BELONGS_TO_ANOTHER_WORKSPACE`, and the body did not contain "Acme".
  - AC-05: Acme pasting a second bot got 409 `WORKSPACE_KEEPS_ONE_BOT` with `reason=connected`.
  - AC-06: a bot whose webhook pointed at another service got 409 `TAKEOVER_CONFIRMATION_REQUIRED`, with 0 `setWebhook` calls. With `confirm_takeover:true` it returned 200 `connected`.
  - AC-13: the same Telegram user writing to both bots gave Acme 1 contact and 2 messages, and Bolt 1 contact and 1 message.
  - AC-16: the token was revoked in the fake and one health-check tick ran. The settings showed `needs_token`, and the contact and messages were kept.
  - AC-17: a new token of the same bot returned 200 `connected` with the webhook URL unchanged, and the next message continued the single conversation.
  - AC-18: disconnect returned 200. The settings showed `not_connected`, `deleteWebhook` had been called and `token_encrypted` was NULL. A later delivery got 401, and the message count did not change.
  - AC-19: pasting the same bot again returned 200 `connected`. The next message continued the conversation, giving 1 contact, 1 conversation and messages `["/start","renamed","after rotation","back again"]`.
  - Secrecy: the server ran at `LOG_LEVEL=info`, and its 71 log lines contained none of the 4 tokens (neither in full nor their secret part) and no message text or customer name.
- **Not re-run live:**
  - AC-09 (message kinds), AC-10 (edits), AC-15's 5-minute freshness and AC-16b (reconnect). These are covered by the integration suites, the 3 API-level e2e stories and the browser flows.
  - **Anything against real Telegram**, because no public HTTPS host exists yet.

## Operational notes

- **Migration:** run `pnpm db:migrate` on deploy, before the API starts. It adds 4 reversible migrations (`bots`, `contacts`, `conversations`, `messages`). To roll back:
  1. Disconnect bots first.
  2. Revert the deploy.
  3. Run `pnpm db:rollback` four times. This drops all captured data.
- **Config:**
  - **`BOT_TOKEN_ENCRYPTION_KEY` is new and required.** Generate it with `openssl rand -base64 32`, store it in every environment and **back it up**.
  - `TELEGRAM_WEBHOOK_BASE_URL` (optional, defaults to `PUBLIC_WEB_URL`) must be public HTTPS in production.
  - `TELEGRAM_WEBHOOK_MAX_CONNECTIONS` is optional and must stay below `DATABASE_POOL_MAX`.
  - `TELEGRAM_API_ROOT` is for tests only.
- **Jobs:** the pg-boss queues `bots.schedule-health-checks` (cron) and `bots.check-health` start with the API.
- **Feature flag:** none.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
