---
id: T11
title: "Build the Telegram gateway: getMe, getWebhookInfo, setWebhook, deleteWebhook with typed outcomes and timeouts"
layer: "infra"
deps: ["T2", "T3"]
blocks: ["T12", "T15"]
acs: ["AC-02", "AC-06", "AC-16", "AC-16b"]
files_hint: ["apps/api/src/modules/bots/app/ports.ts", "apps/api/src/modules/bots/infra/telegram-gateway.ts", "apps/api/src/modules/bots/infra/telegram-gateway.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T11 — Build the Telegram gateway: getMe, getWebhookInfo, setWebhook, deleteWebhook with typed outcomes and timeouts

## Place in the sequence

- **Blocked by:** T2 — `telegramApi(token, { apiRoot })` + config, T3 — fake Bot API · **Blocks:** T12 — Implement the bots use cases get-settings and paste-token (connect, rotate, connect again, refusals, takeover confirmation), T15 — Implement the scheduled health check: run-health-check use case and the bots.schedule-health-checks / bots.check-health jobs · **Wave:** 2.
- **Lane:** shares `modules/bots/app/ports.ts` with T10, T12–T15 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to connect the business bot to my workspace by pasting its token
> **So that** messages from our customers start arriving in tg-inbox without help from the tg-inbox team
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to see which bot is connected, whether it is working and when the last message arrived
> **So that** I notice a broken connection before customers do
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

This task is the only place tg-inbox talks to Telegram, and it turns every answer into "unauthorized", "transient" or a result — never into a leaked token or URL.

## Inlined context

> Telegram calls: Every call through `telegramApi(token)` (with `TELEGRAM_API_ROOT` when set), behind a `bots` gateway port; per-call timeout of 1 s on owner actions (so connect / rotate / disconnect stay within 3 s) and 10 s in health checks; outcomes classified as unauthorized (state change), transient (no state change, retry) or other
>
> — `sad.md §8, Telegram calls, verbatim` · full text: [sad.md](../sad.md)

> the Telegram gateway maps grammY errors to its own typed outcomes (unauthorized / transient / other) without copying their messages or URLs into errors or logs
>
> — `sad.md §8, Logging, abridged` · full text: [sad.md](../sad.md)

> `setWebhook` always sets `allowed_updates: ["message", "edited_message"]` and a bounded `max_connections` (sad.md §7).
>
> — `adr/0002, Decision outcome, abridged` · full text: [ADR-0002](../adr/0002-receive-updates-through-one-webhook-per-bot-authenticated-by-a-per-bot-secret.md)

> when Telegram cannot be reached (network, 5xx, rate limit) the state is kept and the page shows when it was last checked
>
> — `sad.md §1, Decision override, abridged` · full text: [sad.md](../sad.md)

Webhook URL = `${TELEGRAM_WEBHOOK_BASE_URL}/api/telegram/webhook/${bot.id}` — the gateway compares `getWebhookInfo.url` with it to report `ours` / `foreign` / `none`.

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface. Port (`bots/app/ports.ts`):

- `getMe(token, timeout) → { ok, botId, name, username } | 'unauthorized' | 'transient'`
- `getWebhook(token, ourUrl, timeout) → 'ours' | 'foreign' | 'none' | 'unauthorized' | 'transient'`
- `setWebhook(token, { url, secret, dropPending }, timeout) → 'ok' | 'failed'` (always `allowed_updates: ['message','edited_message']`, `max_connections: TELEGRAM_WEBHOOK_MAX_CONNECTIONS`)
- `deleteWebhook(token, timeout) → 'ok' | 'failed'` (always `drop_pending_updates: true`)

## Acceptance criteria

### AC-02 — error

> **Given** a business owner of "Acme Flowers" connecting a bot or giving the connected bot a new token
> **When** the pasted text is not a bot token, or Telegram does not accept it (mistyped, revoked, or the bot was deleted)
> **Then** the system changes nothing — an existing connection keeps working as before — and tells the owner the token is not valid — copy it again from BotFather
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — cross-context

> **Given** a business owner of "Acme Flowers" pasting a valid token of a bot that, according to Telegram, currently delivers its messages to another address (another service); a service that instead fetches the bot's messages itself is not visible to tg-inbox and gets no warning
> **When** the system checks the token
> **Then** before connecting, it warns the owner that connecting will stop that bot delivering messages to the other service, and connects only after the owner confirms
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

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

- [ ] Define the port + `OWNER_ACTION_TIMEOUT = 1000`, `HEALTH_CHECK_TIMEOUT = 10000` — `bots/app/ports.ts`
- [ ] grammY implementation through `telegramApi(token, { apiRoot })` with an `AbortSignal.timeout`; map `GrammyError.error_code === 401/404` → `unauthorized`, network / 5xx / 429 / timeout → `transient`; nothing else leaks — `bots/infra/telegram-gateway.ts`
- [ ] Integration tests against the fake Bot API (T3): each outcome per method; recorded `setWebhook` params (URL, secret, allowed updates, max connections, drop pending); a hung call times out at 1 s; no thrown error or log line contains the token or the API URL — `telegram-gateway.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Telegram 429 with `retry_after` | `transient` (no wait inside an owner request) |
| `getWebhookInfo.url` = ours with a different trailing slash | normalised compare → `ours` |
| Empty `url` | `none` (a polling service is invisible — AC-06) |
| grammY throws `HttpError` (DNS) | `transient` |

## Definition of Done

- [ ] gateway integration tests against the fake Bot API pass for every outcome and the timeout
- [ ] a log-capture assertion shows no token and no `api.telegram.org/bot…` URL in logs or errors
- [ ] lint + vet clean (`pnpm lint`)
