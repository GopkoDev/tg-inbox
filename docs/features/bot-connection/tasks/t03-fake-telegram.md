---
id: T3
title: "Build the scriptable fake Telegram Bot API and the webhook update builder for tests"
layer: "tests"
deps: []
blocks: ["T11"]
acs: ["AC-06", "AC-12", "AC-16", "AC-16b"]
files_hint: ["apps/api/src/test/fake-telegram.ts", "apps/api/src/test/fake-telegram.test.ts", "apps/api/src/test/fixtures/telegram.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T3 — Build the scriptable fake Telegram Bot API and the webhook update builder for tests

## Place in the sequence

- **Blocked by:** — · **Blocks:** T11 — Build the Telegram gateway: getMe, getWebhookInfo, setWebhook, deleteWebhook with typed outcomes and timeouts · **Wave:** 1 — test infrastructure only; no production code depends on it.
- **Lane:** own lane (new files only).

## Why (user story)

> **As a** Business owner
> **I want** to see which bot is connected, whether it is working and when the last message arrived
> **So that** I notice a broken connection before customers do
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

This task lets every gateway, use-case, route and e2e test script Telegram's answers (valid / revoked / taken over / down) without touching real Telegram.

## Inlined context

> Fake Bot API: an in-process HTTP fake started per suite and reached through `TELEGRAM_API_ROOT`; per token it is scripted to answer `getMe` (ok / unauthorized / transient / timeout), `getWebhookInfo` (ours / another service's / empty), `setWebhook` and `deleteWebhook` (ok / fail), and it records every call with its parameters (URL, secret, allowed updates, drop pending) for assertions. Reset per test.
>
> — `test-plan.md §Test data, Fake Bot API, verbatim` · full text: [test-plan.md](../test-plan.md)

> (c) the fake Bot API's responses and the webhook payload builder against the Telegram Bot API shapes the gateway relies on (`getMe`, `getWebhookInfo`, `setWebhook`, `deleteWebhook`, `Update`, `Message`). […] the fake Bot API is pinned to recorded Telegram examples so it cannot drift silently.
>
> — `test-plan.md §Levels, Contract, abridged` · full text: [test-plan.md](../test-plan.md)

> `telegramUpdate({ updateId, chatId, fromId, messageId, date, text?, kind?, editDate? })` is a pure builder of webhook payloads (private chat, human sender) that the capture integration tests post through `app.inject()`. Variants cover group, bot sender and business connection, for AC-12.
> PII guard: names are `Test User` / `Test Bot <n>`, usernames are `test_bot_<n>` / `test_user_<n>`, Telegram ids are small synthetic integers, and tokens are visibly fake.
>
> — `data-model.md §Test fixtures, abridged` · full text: [data-model.md](../data-model.md)

> Telegram Bot API behaviour this design relies on: one delivery mode per bot (webhook or `getUpdates`); webhooks carry the registered `secret_token` in `X-Telegram-Bot-Api-Secret-Token`; undelivered updates are kept and redelivered for up to 24 h; `getWebhookInfo` reports the registered URL; message ids increase within a private chat
>
> — `sad.md §2, Technical, verbatim` · full text: [sad.md](../sad.md)

Bot API wire shape: `POST <root>/bot<token>/<method>` → `{ "ok": true, "result": … }` or `{ "ok": false, "error_code": 401, "description": "Unauthorized" }`; a 429 carries `parameters.retry_after`.

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface. Shapes faked: `getMe` → `User{id,is_bot:true,first_name,username}`; `getWebhookInfo` → `WebhookInfo{url,pending_update_count,…}` (empty `url` = no webhook); `setWebhook(url, secret_token, allowed_updates, max_connections, drop_pending_updates)` / `deleteWebhook(drop_pending_updates)` → `true`. Builder output matches `TelegramUpdate` / `TelegramMessage` in [openapi.yaml](../contracts/openapi.yaml).

## Acceptance criteria

### AC-06 — cross-context

> **Given** a business owner of "Acme Flowers" pasting a valid token of a bot that, according to Telegram, currently delivers its messages to another address (another service); a service that instead fetches the bot's messages itself is not visible to tg-inbox and gets no warning
> **When** the system checks the token
> **Then** before connecting, it warns the owner that connecting will stop that bot delivering messages to the other service, and connects only after the owner confirms
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — domain invariant

> **Given** a connected bot of "Acme Flowers"
> **When** someone writes in a group or channel the bot belongs to, another bot writes to it, or the bot receives messages on behalf of someone's personal Telegram Business account
> **Then** the system captures nothing from it and creates no contact or conversation — only private chats between people and the bot are captured
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — error

> **Given** a connected bot whose token was revoked in BotFather, or which was deleted there
> **When** a business owner of "Acme Flowers" opens the bot settings
> **Then** the system shows the state "not working — needs a new token", explains that messages are not arriving until the owner pastes a new token of the same bot, and keeps every contact and conversation already captured; once a new token is pasted (AC-17), messages customers sent meanwhile that Telegram still holds (up to 24 h) are captured in order
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

### AC-16b — cross-context

> **Given** a connected bot of "Acme Flowers" whose messages another service has since taken over
> **When** a business owner opens the bot settings and then chooses to reconnect the bot (with the token already stored — no paste needed; pasting that same token again does the same)
> **Then** the settings show the state "not receiving messages — another service took them over"; on reconnecting, the system gives the warning of AC-06, and after the owner confirms the bot is connected again and new messages are captured into their existing conversations; messages the other service received meanwhile are not recovered
>
> — `spec.md §5, AC-16b, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `startFakeTelegram()` → `{ apiRoot, bot(token).script({...}), calls(token?), reset(), stop() }`: Node `http` server on port 0; per-token behaviour for `getMe` (ok / 401 / 500 / 429 / hang past timeout), `getWebhookInfo` (ours / other URL / empty), `setWebhook` / `deleteWebhook` (ok / fail); `setWebhook` stores the URL so a later `getWebhookInfo` reports it; records each call with its parameters — `apps/api/src/test/fake-telegram.ts`
- [ ] Pin responses to recorded Bot API examples (constants in the same file, from core.telegram.org) and test the fake against them — `fake-telegram.test.ts`
- [ ] `telegramUpdate(...)` and `telegramEdit(...)` builders with variants: group / supergroup / channel chat, bot sender, `business_connection_id`, every kind of `sad.md §8 Message kinds`, an unknown kind, album items (shared `media_group_id`), live-location edit — `apps/api/src/test/fixtures/telegram.ts`
- [ ] `signedDelivery(app, bot, update)` helper posting to `/api/telegram/webhook/<id>` with the secret header — same file

## Edge cases

| Case | Behaviour |
|---|---|
| Token never scripted | `getMe` answers 401 (an unknown token is rejected, like real Telegram) |
| "hang" behaviour | the fake holds the request until `reset()`/`stop()` so 1 s / 10 s timeouts are testable |
| `stop()` while a request hangs | resolves; no open handles left for Vitest |

## Definition of Done

- [ ] `fake-telegram.test.ts` passes: grammY's `Api` with `apiRoot` pointed at the fake gets each scripted outcome, and recorded calls carry the parameters
- [ ] builder outputs validate against the recorded `Update`/`Message` examples
- [ ] no real token, name or id in fixtures (PII guard)
- [ ] lint + vet clean (`pnpm lint`)
