---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Implementing engineer", "Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: "M"
---

# Test plan — bot-connection

A business owner connects the workspace's own Telegram bot by pasting its token, sees whether it is healthy, rotates the token or disconnects it; every private message an end customer sends to a connected bot is captured exactly once, in Telegram's order, into one conversation per contact of that workspace — while no workspace ever reads another's bots, contacts or conversations and no bot token ever leaves the `bots` infra layer in clear.

## Levels

| Level | Scope | Strategy (generic — no tool names) |
|---|---|---|
| Unit | Pure rules in `bots/domain` (token format check and trimming, connection-state transitions, inbound filter: private chat / human sender / no business connection / not before the capture epoch, update → normalised message incl. every message kind and "other", health-check due rule), `conversations/domain` (edit rule: later edit time wins, update-id tie-break), `contacts/domain` (profile refresh: newer message wins); app-layer use cases (paste, reconnect, disconnect, get settings, accept update, run health check, capture, apply edit) with in-memory port fakes; the token cipher round-trip; shared request schemas (`BotTokenPaste`, reconnect body). | In-memory, no external dependency; time from a fake clock port; Telegram behind a fake gateway port. |
| Integration | Repositories, use cases, owner routes and the webhook route of `bots`, `conversations`, `contacts` against a real database; the health-check jobs against the real job queue tables; the Telegram gateway against a fake Bot API. | An ephemeral real database container per suite with every migration applied (incl. the four promoted bot-connection migrations); routes exercised through the in-process HTTP entry point of `buildApp()`; the Bot API replaced by an in-process scriptable fake Bot API reached through `TELEGRAM_API_ROOT` (Telegram is an external system, not a datastore we own — the database is never mocked); a controllable clock for the capture epoch, the 3-minute due threshold and 5-minute freshness. |
| Contract | (a) Every owner-route response and error body against the zod schemas in `packages/shared` and `contracts/openapi.yaml` (`getBotSettings`, `pasteBotToken`, `reconnectBot`, `disconnectBot`, `receiveTelegramUpdate`); (b) the two job payloads against `contracts/events.md`; (c) the fake Bot API's responses and the webhook payload builder against the Telegram Bot API shapes the gateway relies on (`getMe`, `getWebhookInfo`, `setWebhook`, `deleteWebhook`, `Update`, `Message`). | Validate real responses produced by the integration suite against the agreed shapes; the fake Bot API is pinned to recorded Telegram examples so it cannot drift silently. |
| E2E | Three full stories through their real entry points: (1) capture lifecycle — owner connects via the API, customers' updates are posted to the webhook, owner rotates, disconnects and connects again (US-01, US-02, US-03, US-06, AC-19); (2) customer edits and redeliveries (US-04); (3) health — revoke and takeover scripted on the fake Bot API, the scheduled check runs, the owner recovers (US-05). | Multi-step scenario against an ephemeral database and the fake Bot API; each step uses only what an earlier step returned (settings, webhook URL and secret captured by the fake from `setWebhook`). |
| Load | Spec §6 throughput, flood isolation, acknowledgement and latency NFRs. | The load tool already in your repo (none yet), or e.g. k6 or Locust; a generator that signs each delivery with its bot's secret header; run against one production-like instance, not a CI runner. |
| Component | SCR-01 (owner-only Bot entry), SCR-02…SCR-06 of `screens.md`, every state row of the manifest; the bot store. | Render the page / dialog in a component harness with a stubbed API client; assert the rendered state, the request sent (or not sent) and the navigation it triggers. |
| Visual-regression | <!-- N/A: pilot-stage UI still changing; baselines would churn on every layout edit (same call as workspace-operators). Revisit once the design canon is stable. --> | — |
| E2E-through-UI | Seven flows from `ux-flows.md` (listed below the coverage table) driven through the built web panel served from the same origin as the API. | A real browser against the API + an ephemeral database + the fake Bot API; owners and workspaces seeded through the admin CLI / app layer; customer messages posted to the webhook by the test, never through the UI. |

## AC coverage

| AC (spec.md §5) | Test name (intent-based) | Level | Expected outcome |
|---|---|---|---|
| AC-01 happy | `owner pastes a valid token and the bot connects` | integration + contract + e2e + e2e-through-UI | Row in state connected with the bot's name and username; the fake Bot API saw `setWebhook` with our URL for this bot id, a fresh secret, message + edited_message only, pending updates dropped; the response shows name, username and "connected" and no token or secret |
| AC-01 happy | `surrounding spaces in a pasted token are ignored` | unit + integration | The trimmed token is checked with Telegram and connects |
| AC-01 happy | `stored token is encrypted and never returned` | unit + integration | Stored bytes do not contain the token; they decrypt back to it with the configured key; no later settings response carries it |
| AC-01 happy | `first message after connecting is captured into the workspace` | integration + e2e | A delivery with the secret Telegram was given lands in "Acme Flowers" |
| AC-01 component | `paste token dialog connects and returns to bot settings` | component | SCR-03 default → submitting (field and buttons disabled) → success: dialog closes, field cleared, SCR-02 "connected" |
| AC-02 error | `text that is not a bot token is refused without asking Telegram` | unit + integration + component | Refused as not valid; the fake Bot API saw no call; nothing stored; SCR-03 shows "the token is not valid — copy it again from BotFather", field cleared and focused |
| AC-02 error | `token Telegram rejects is refused and nothing changes` | integration + component | Revoked / mistyped / deleted-bot token refused as not valid; no row created; no webhook set |
| AC-02 error | `rejected token during rotation leaves the existing connection working` | integration + e2e-through-UI | Stored token, secret and state unchanged; no webhook call; a delivery right after is still captured |
| AC-02 error | `empty or over-long paste is stopped before sending` | component + integration | Component: empty after trimming shows "Paste the token from BotFather", over 512 characters blocked by the shared schema, no request; integration: the route refuses both with the field named |
| AC-03 authorization | `operator is refused every bot action` | integration + component | Get settings, paste, reconnect and disconnect each refused as "only business owners manage the bot"; nothing changes; SCR-02 shows the owners-only state with no bot data |
| AC-03 authorization | `operator has no Bot entry in the app shell` | component | SCR-01 operator: no Bot link (desktop and phone menu); owner: Bot after Team |
| AC-03 authorization | `non-member gets the neutral not found on every bot route` | integration + component | Never-member, unknown and malformed workspace id all get the same not-found with no hint of a bot; SCR-06 rendered |
| AC-03 authorization | `bot routes refuse a session from another workspace` | integration | For each of the four owner routes, an owner of "Bolt Bikes" addressing "Acme Flowers" gets the neutral not-found and no data; the bot row is unchanged |
| AC-04 domain invariant | `token of a bot connected to another workspace is refused without naming it` | integration + component | Refused as belonging to another workspace; response names no workspace; nothing in either workspace changes; SCR-03 shows the refusal, field cleared |
| AC-04 domain invariant | `token of a bot another workspace disconnected after capturing is refused` | integration | Same refusal while the other workspace's row is kept without token |
| AC-04 domain invariant | `ownership refusal comes before the takeover warning` | integration | Bot bound elsewhere and delivering to another service → the ownership refusal, never a confirmation request |
| AC-04 domain invariant | `two workspaces pasting the same bot at the same moment` | integration | Exactly one connects; the other is refused as belonging to another workspace; one webhook set |
| AC-05 domain invariant | `different bot while one is connected is refused` | integration + component | Refused with reason "connected" (disconnect first); stored bot untouched; SCR-03 shows the server message |
| AC-05 domain invariant | `different bot after disconnecting a bot that captured is refused` | integration + component | Refused with reason "history" (customers know only that bot); kept row unchanged |
| AC-05 domain invariant | `different bot while the current one needs a token or is taken over is refused` | integration | Refused with reason "connected"; nothing changes |
| AC-05 boundary | `workspace that disconnected with nothing captured may connect a different bot` | integration | Old row was deleted on disconnect; the new bot connects |
| AC-06 cross-context | `bot delivering to another service needs confirmation before connecting` | integration + component + e2e-through-UI | First request answers "confirmation required" with the bot's name and username; no row written, no webhook changed; SCR-04 opens with "Take over @username?" |
| AC-06 cross-context | `confirmed takeover connects and replaces the other webhook` | integration + e2e-through-UI | Resubmitted with confirmation → connected; the fake Bot API's webhook URL is now ours |
| AC-06 cross-context | `cancelled takeover changes nothing` | component + e2e-through-UI | No request sent; token dropped from memory; SCR-02 as before |
| AC-06 cross-context | `confirming request re-checks with Telegram` | integration | If the bot became bound elsewhere or the token was revoked between the two requests, the confirming request gets that refusal instead of connecting |
| AC-06 cross-context | `bot without a webhook connects without a warning` | integration | Empty registered URL (a polling service is invisible) → connects straight away |
| AC-06 cross-context | `rotation onto a bot taken over by another service also asks to confirm` | integration | Same-bot paste with a foreign webhook → confirmation required; nothing changed until confirmed |
| AC-07 happy | `first message from a new customer creates a contact and a conversation` | integration + e2e | One contact with name, username and language from the profile; one conversation holding the message; delivery acknowledged |
| AC-07 happy | `starting the bot is captured as a text message` | unit + integration | `/start` stored as a text message in a new conversation |
| AC-07 happy | `bot settings show the time of the last message received` | integration + component | Settings carry that message's received time and contacts count 1; SCR-02 shows them; with none yet SCR-02 shows "none yet", count 0 and the "write to @username" hint |
| AC-08 happy | `later message refreshes the contact's name, username and language` | unit + integration | Same contact, profile now current; message in the existing conversation; no second contact |
| AC-08 happy | `redelivered older message does not restore an old profile` | unit + integration | Profile stays at the newest message's values |
| AC-09 happy | `each message kind is recorded with its kind and caption` | unit + integration | Photo, video, animation, voice, audio, video note, document, sticker, location, venue, contact, poll and dice each stored with its kind, caption as body when present, Telegram's message object kept |
| AC-09 happy | `unrecognised message kind is recorded as other` | unit + integration | Stored once with kind "other"; delivery acknowledged (never refused, so Telegram does not retry for 24 h) |
| AC-09 happy | `album items are captured as separate messages in order` | integration | One message per item, ordered by Telegram message id |
| AC-09 happy | `live location updates do not change the captured location` | unit + integration | The edited location update leaves the stored message unchanged |
| AC-10 happy | `edited text replaces the old text and is marked edited` | integration + e2e | Same message row, new text, marked edited; message count unchanged |
| AC-10 happy | `edited caption replaces the old caption` | integration | Caption replaced on the non-text message; marked edited |
| AC-10 happy | `edits arriving out of order keep the customer's last edit` | unit + integration | Later edit time wins whatever the arrival order; equal edit times resolved by the higher update id |
| AC-10 happy | `redelivered edit changes nothing` | integration | Same text, same edit marker |
| AC-10 edge | `edit of an uncaptured message adds nothing and is not kept` | integration | No message created; if the original arrives later it is stored with its original text |
| AC-11 domain invariant | `redelivered message is stored exactly once` | integration + e2e | Two deliveries of one update → one message; both acknowledged |
| AC-11 domain invariant | `concurrent deliveries of the same message store it once` | integration | Parallel deliveries → one message, one contact, one conversation |
| AC-11 domain invariant | `concurrent first messages from one new customer create one contact and one conversation` | integration | Two different first messages in parallel → one contact, one conversation, two messages |
| AC-11 domain invariant | `late redelivered message takes its original place` | integration + e2e | Message with a lower Telegram id posted after a higher one is read back before it |
| AC-11 domain invariant | `failed capture answers a server error and the redelivery is captured` | integration | Capture transaction forced to fail once → server error and nothing half-written; the same update posted again is captured once |
| AC-12 domain invariant | `group, supergroup and channel messages are ignored` | unit + integration | Acknowledged; no contact, conversation or message |
| AC-12 domain invariant | `messages from another bot are ignored` | unit + integration | Acknowledged; nothing created |
| AC-12 domain invariant | `Telegram Business account messages are ignored` | unit + integration | Update carrying a business connection → acknowledged; nothing created |
| AC-12 domain invariant | `update types outside message and edited message are ignored` | unit + integration | Acknowledged; nothing created |
| AC-13 cross-context | `one person writing to two workspaces' bots gets a contact in each` | integration + e2e | Each workspace has its own contact and conversation with only the message sent to its bot; contacts counts are 1 in each |
| AC-13 cross-context | `no repository returns or changes another workspace's rows` | integration | See the per-repository isolation block below |
| AC-14 authorization | `delivery without the secret header is refused` | integration | Refused as unauthorized with an empty body; tables unchanged |
| AC-14 authorization | `delivery with a wrong secret is refused` | unit + integration | Same refusal; the secret check is by hash in constant time |
| AC-14 authorization | `secret of one bot posted to another bot's webhook is refused` | integration | Same refusal; nothing captured in either workspace |
| AC-14 authorization | `delivery to an unknown or malformed webhook id is refused` | integration | Same refusal and shape as a wrong secret — no hint whether the id exists |
| AC-15 happy | `owner sees the bot's state, name, username, last message and contacts count but never the token` | integration + contract + component + e2e-through-UI | With 12 captured customers: "connected", name, username, last message time, 12 contacts, last checked time; no token or secret in the body |
| AC-15 happy | `contacts count covers only this workspace` | integration | A shared customer of "Bolt Bikes" is not counted |
| AC-15 happy | `opening bot settings makes no Telegram call` | integration | The fake Bot API records zero calls during the settings request |
| AC-15 happy | `bot last checked three minutes ago is checked on the next tick` | unit + integration | Due rule picks it; the check refreshes state, name, username and last checked time |
| AC-15 happy | `no connected bot is ever more than five minutes stale` | integration | Across a simulated hour of minute ticks with the controllable clock, every connected or taken-over bot's last check is at most 5 minutes old |
| AC-15 happy | `one health check per bot runs at a time` | integration | Two ticks enqueuing the same bot → one check runs |
| AC-15 happy | `a failed exchange during an owner action changes the state at once` | integration | Reconnect whose `getMe` is unauthorized → state "needs a new token" in the same request, without waiting for the schedule |
| AC-15 edge | `transient Telegram failure in a health check keeps the state` | integration | Network error, server error or rate limit → state and last checked time unchanged; checked again on the next tick |
| AC-16 error | `revoked or deleted bot is shown as needing a new token` | integration + component | Health check with unauthorized `getMe` → "needs a new token"; SCR-02 shows the badge, the destructive alert and **Paste new token**; captured contacts and conversations unchanged |
| AC-16 error | `new token after a revoke captures the messages Telegram held, in order` | integration + e2e + e2e-through-UI | `setWebhook` keeps pending updates; the held updates posted afterwards are captured in Telegram order into existing conversations; capture epoch unchanged |
| AC-16b cross-context | `webhook taken over by another service is shown as not receiving messages` | integration + component | Health check sees a foreign URL → "taken over"; SCR-02 shows the alert, **Reconnect**, **Paste token again**, **Disconnect** |
| AC-16b cross-context | `reconnect with the stored token warns, then reconnects after confirmation` | integration + component + e2e-through-UI | First reconnect → confirmation required (SCR-04); confirmed → "connected", our webhook registered with the kept secret, pending kept; new messages continue existing conversations |
| AC-16b cross-context | `pasting the same token on a taken-over bot does the same as reconnect` | integration | Same warning, same end state |
| AC-16b error | `reconnect when the stored token was revoked moves to needs a new token` | integration + component | Refused with the needs-new-token answer carrying current settings; state "needs a new token"; SCR-02 updates and SCR-03 opens with the notice |
| AC-16b error | `reconnect when nothing is taken over is refused as nothing to reconnect` | integration + component | Refused with current settings; SCR-02 shows the stale notice |
| AC-16b error | `reconnect when registering the webhook fails stays taken over` | integration + component | Answer "Telegram not responding — try again"; state unchanged; **Reconnect** enabled again |
| AC-17 happy | `new token of the same bot replaces the old one` | integration + e2e + e2e-through-UI | Stored token replaced; secret and capture epoch kept; `setWebhook` keeps pending updates; the next health check uses only the new token; existing customers continue their conversations |
| AC-17 happy | `deliveries in flight during a rotation still pass the secret check` | integration | A delivery signed with the kept secret after the rotation is captured |
| AC-17 error | `failed webhook registration during rotation restores the old token` | integration | Answer "Telegram not responding — try again"; stored token, state and secret as before |
| AC-18 happy | `disconnect discards the token and shows not connected` | integration + component + e2e-through-UI | SCR-05 confirm → SCR-02 "not connected"; stored token, secret hash and capture epoch cleared |
| AC-18 happy | `disconnect removes only our own webhook` | integration | Our URL → `deleteWebhook` dropping pending updates; another service's or empty URL → no `deleteWebhook`; unauthorized `getWebhookInfo` → disconnect still proceeds |
| AC-18 happy | `disconnect keeps every captured contact and conversation` | integration + e2e | Counts and contents unchanged; with captures the row is kept bound, with none it is deleted |
| AC-18 happy | `deliveries after a disconnect are refused` | integration | The old secret no longer passes; nothing captured |
| AC-18 happy | `messages sent while disconnected are never captured, even after connecting again` | integration + e2e | After a new connect (new epoch, pending dropped) a late delivery dated before the new epoch is acknowledged and ignored |
| AC-18 error | `transient Telegram failure on disconnect changes nothing` | integration + component | Answer "Telegram not responding — try again"; bot still connected; SCR-05 keeps **Disconnect** enabled |
| AC-18 error | `disconnect when nothing is connected is refused with current settings` | integration + component | Refused as no bot connected; SCR-02 stale notice |
| AC-18 component | `cancel on confirm disconnect sends nothing` | component | No request; SCR-02 unchanged |
| AC-19 cross-context | `connecting the same bot again continues existing conversations` | integration + e2e | Re-paste after disconnect connects (new secret, new epoch); an existing customer's message joins their conversation; no duplicate contact |
| AC-19 cross-context | `old webhook secret is refused after connecting again` | integration | A delivery with the pre-disconnect secret is refused |

**E2E-through-UI scope (seven flows, from `ux-flows.md`):** (1) connect a clean bot, then a customer message shows up as "last message received" and "contacts captured 1" after reload (AC-01, AC-07, AC-15); (2) paste an invalid token, see the error, paste a valid one (AC-02); (3) connect a bot delivering to another service — cancel once, then confirm (AC-06); (4) bot revoked → "needs a new token" → paste new token → connected (AC-16, AC-17); (5) bot taken over → reconnect → confirm (AC-16b); (6) disconnect with confirmation (AC-18); (7) operator sees no Bot entry and the owners-only page at the Bot address (AC-03). Revoke and takeover are scripted on the fake Bot API and the health check is triggered through the app layer, not waited for.

## Edge cases / error paths

- Telegram unreachable or timing out (over 1 s) on `getMe` / `getWebhookInfo` during paste, reconnect or disconnect → expected: refused as "Telegram is not responding — try again", nothing changed; SCR-03 / SCR-04 keep the token in the field for a retry.
- `setWebhook` fails after the row was written on a first connect → expected: the row is restored to its previous state (no row), the answer says try again; the bot is free to connect on retry.
- Telegram answers a rate limit to a health check → expected: treated as transient, state unchanged.
- Webhook delivery with a body that is not a Telegram update → expected: refused, nothing captured, nothing logged from the body.
- Webhook delivery for a bot in state "needs a new token" or "taken over" with the right secret → expected: still captured (the secret is kept; only a disconnect clears it).
- Message whose text or caption is very long, or a name with unusual characters → expected: captured as given (no length limits on Telegram data, so a valid update never fails into endless redelivery).
- Two updates for the same customer where the second arrives first → expected: both captured once, read back in Telegram order; profile from the later-dated message.
- Health-check job for a bot that was disconnected or deleted after it was enqueued → expected: the job does nothing and does not resurrect the row.
- Health-check job addressed with a workspace id that does not own the bot → expected: nothing read or changed (the check runs scoped by workspace).
- Missing or expired session on an owner route → expected: refused as not signed in; the panel signs in and returns to `/w/<id>/bot`.
- Member deactivated while on SCR-02 → expected: the next action is refused as access removed; the panel clears the bot store and moves on, as in workspace-operators AC-17.
- Mutating owner request with a non-JSON body → expected: refused, nothing changed (existing CSRF guard).
- Network failure or server error on SCR-02 load → expected: "Something went wrong" with retry; on an action, an alert and the page keeps its previous state.
- Database unavailable during a delivery → expected: server error, nothing half-written, Telegram redelivers (fail-closed — never acknowledged without capture).
- Missing or malformed `BOT_TOKEN_ENCRYPTION_KEY` → expected: the API refuses to start with a config error naming the key, never the value.

**Cross-workspace isolation (spec §6 NFR, SAD QG-2a, `CLAUDE.md` tenancy rule):** every repository method of `bots`, `contacts` and `conversations` gets its own integration test on the `twoWorkspacesWithBots` fixture proving it never returns or changes the other workspace's rows when given one workspace id — bots: read this workspace's bot, insert, update (token / state / name and username / last checked), clear on disconnect, delete, read one bot for a health check by (id, workspace id); contacts: upsert from profile, count; conversations: upsert by chat, find by chat for an edit, has conversations; messages: insert-if-absent, conditional edit, newest received time. The two controlled exceptions get dedicated tests: *bot by webhook id* returns the row only when the secret's hash matches and produces exactly that bot's workspace id; *bots due for a health check* returns only connected or taken-over bots at least 3 minutes since their last check, with their own workspace ids, and never a disconnected row. The AC-04 refusal is asserted to read no row of the other workspace (it comes from the unique constraint).

**Token secrecy (spec §6 NFR, SAD QG-2b):** one integration suite captures all log output and every response body while running connect, rotate, reconnect, disconnect, health check, the webhook route and every Telegram failure branch (unauthorized, transient, `setWebhook` failure), and asserts that neither the bot token, the webhook secret, nor any message text or caption appears in any of them; the shared response schemas are asserted to have no token or secret field; error bodies from Telegram failures carry no Bot API URL.

## Test data

- Seed strategy: fixtures per `data-model.md` § Test fixtures — `insertBot` (encrypts a visibly fake `<telegramBotId>:TEST-<random>` token with the test key and returns the token and webhook secret so a test can sign a delivery), `insertContact`, `insertConversation`, `insertMessage`, the `telegramUpdate` payload builder with its group / channel / bot-sender / business-connection / edit / album / unknown-kind variants, and `twoWorkspacesWithBots` ("Acme Flowers" + "Bolt Bikes", one connected bot each) on top of the existing `twoWorkspaces` and account fixtures. Names, usernames and ids are synthetic (PII guard of `data-model.md`).
- Fake Bot API: an in-process HTTP fake started per suite and reached through `TELEGRAM_API_ROOT`; per token it is scripted to answer `getMe` (ok / unauthorized / transient / timeout), `getWebhookInfo` (ours / another service's / empty), `setWebhook` and `deleteWebhook` (ok / fail), and it records every call with its parameters (URL, secret, allowed updates, drop pending) for assertions. Reset per test.
- Time: a controllable clock port drives the capture epoch, the 3-minute due threshold and the simulated hour of health-check ticks; Telegram dates in payloads are set explicitly. Never sleep.
- Integration dependency: an ephemeral real database container per suite with all migrations applied — NOT a mocked store. The existing migrations suite is extended to apply and revert the four bot-connection migrations (reversibility rule) and to check their constraints (one bot per workspace, unique Telegram bot id, state-dependent nulls, message kind list).
- Cleanup boundary: per-test — every test truncates `messages`, `conversations`, `contacts`, `bots` and the job queue's jobs (plus the workspace-operators tables it seeded); concurrency tests (AC-04, AC-11) use committed transactions and truncate afterwards. E2E and E2E-through-UI reset the database and the fake Bot API before each flow. The container is removed with its data even on failure, as `CLAUDE.md` requires.

## NFR validation (load)

All scenarios run on one production-like instance with `DATABASE_POOL_MAX` and `TELEGRAM_WEBHOOK_MAX_CONNECTIONS` at production values, against the fake Bot API (no real Telegram), before the first pilot and then before each release. The generator posts signed deliveries straight to `/api/telegram/webhook/<bot id>` and, like Telegram, keeps at most `TELEGRAM_WEBHOOK_MAX_CONNECTIONS` requests in flight per bot. Capture latency is read from the server's ingest-duration log (receipt → commit), acknowledgement from the request-duration log. After every scenario a completeness check compares sent and stored message ids per bot.

- **Flood isolation** (20 messages/s on one bot for 5 minutes; others ≤ 2 s p95) → scenario: 10 workspaces with a connected bot; bot F receives 20 messages/s for 5 min (variant A: 200 distinct senders; variant B: one sender — the hot-row case) while the other 9 bots receive 3 messages/s each from distinct senders (27/s, total 47/s — within the throughput target), after 1 min of warm-up; assert the other bots' capture p95 ≤ 2 s and acknowledgement p95 ≤ 300 ms over the flood window, zero server errors on any bot, and 0 lost / 0 duplicated messages on every bot including F (F's own latency is reported, not asserted).
- **Throughput** (≥ 50 inbound messages/s per instance) → scenario: sustain 50 messages/s for 10 min spread over 10 bots and 500 senders (mix of new and returning customers, 10% edits, 1% redeliveries); assert zero server errors, capture p95 ≤ 2 s, acknowledgement p95 ≤ 300 ms, 0 lost and 0 duplicated.
- **Owner actions** (connect / rotate / disconnect p95 ≤ 3 s) → scenario: 1 action/s for 5 min cycling connect → rotate → disconnect across 50 workspaces, with the fake Bot API adding 300 ms per call (a conservative Telegram round-trip), alongside 20 messages/s background capture; assert p95 per route ≤ 3 s and zero server errors.
- **Bot settings load** (p95 ≤ 300 ms) → scenario: 20 requests/s for 5 min across 50 workspaces, one of them seeded with 100 000 messages and 5 000 contacts; assert p95 ≤ 300 ms and zero Bot API calls.
- Tool: the load tool already in your repo (none yet), or e.g. k6 or Locust.
- Capture completeness under redelivery and outage, state freshness (5 min) and cross-workspace isolation → covered by integration tests in AC coverage, not load; the monthly spot-check against one pilot's bot chat is a manual operational check.
- Availability 99.5% monthly → verified by the uptime check on the health endpoint (monitoring), not by a load test.

## CI placement

- On every PR: unit, contract, component, integration (incl. every per-repository isolation test and the token-secrecy suite — the CI runner provides a container runtime for the ephemeral database), API-level e2e.
- On every PR or nightly (if PR time grows past budget): e2e-through-UI — the seven browser flows.
- Pre-release (and once before the first pilot): the four load scenarios on a production-like host; the security review of the webhook route and the token cipher (spec §6.1).
