---
id: T15
title: "Implement the scheduled health check: run-health-check use case and the bots.schedule-health-checks / bots.check-health jobs"
layer: "app"
deps: ["T5", "T10", "T11"]
blocks: ["T18"]
acs: ["AC-15", "AC-16", "AC-16b"]
files_hint: ["apps/api/src/modules/bots/app/ports.ts", "apps/api/src/modules/bots/app/health-check.ts", "apps/api/src/modules/bots/infra/jobs.ts", "apps/api/src/modules/bots/infra/jobs.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T15 — Implement the scheduled health check: run-health-check use case and the bots.schedule-health-checks / bots.check-health jobs

## Place in the sequence

- **Blocked by:** T5 — due rule, T10 — `listDueForCheck` / `findForCheck`, T11 — gateway · **Blocks:** T18 — Register the health-check workers in buildApp and prove five-minute freshness over a simulated hour · **Wave:** 3.
- **Lane:** shares `modules/bots/app/ports.ts` with T10–T14 — serialized. Registration in `buildApp()` is T18.

## Why (user story)

> **As a** Business owner
> **I want** to see which bot is connected, whether it is working and when the last message arrived
> **So that** I notice a broken connection before customers do
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

This task keeps every live bot's state, name and username at most five minutes behind Telegram.

## Inlined context

> `bots.schedule-health-checks` — A cron job, every minute (`* * * * *`). It has no payload. […] It enqueues one `bots.check-health` per due bot. Retry: none.
> `bots.check-health` — payload `{ bot_id, workspace_id }`, validated with a zod schema in `modules/bots/infra/jobs.ts` (`BotHealthCheckJob`) […] carries no token and no secret. Options: `singletonKey = bot_id`. `expireInSeconds = 30` […]. The job reads the bot by `(id, workspace_id)`. A bot that is gone or `disconnected` is a no-op. […] `retryLimit = 0`.
>
> — `contracts/events.md, both events, abridged` · full text: [events.md](../contracts/events.md)

| Telegram outcome | Write |
|---|---|
| `getMe` unauthorized (token revoked, bot deleted) | `state = needs_token`, `last_checked_at = now` (AC-16) |
| network error, Telegram 5xx or 429 | nothing. The state is kept, and the next tick retries (ADR-0008) |
| registered webhook URL is not ours | `state = taken_over`, refresh `name` and `username`, `last_checked_at = now` (AC-16b) |
| registered webhook URL is ours | `state = connected`, refresh `name` and `username`, `last_checked_at = now` (AC-15) |

— `contracts/events.md, bots.check-health outcome table, verbatim` · full text: [events.md](../contracts/events.md)

> **Cross-module / jobs:** Async work → pg-boss queue `<module>.<job>`.
>
> — `CLAUDE.md §Rules, Cross-module, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No schema change. Reads `bots_due_for_check_idx` (controlled exception *bots due for a health check*); writes `bots.state`, `name`, `username`, `last_checked_at` by `(id, workspace_id)`.

## API contract

Internal — no API surface (async contract in [events.md](../contracts/events.md)).

## Acceptance criteria

### AC-15 — happy path

> **Given** a business owner of "Acme Flowers" with a connected bot that has captured messages from 12 end customers
> **When** they open the bot settings
> **Then** they see the bot's name and username, its state "connected", the time the last message was received and the number of contacts captured — but never the token; the state, name and username are checked with Telegram in the background and are never more than 5 minutes old, and a failed exchange with Telegram changes the state at once
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

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

- [ ] `scheduleChecks(now)` and `checkOne(workspaceId, botId)` (10 s timeouts) — `bots/app/health-check.ts`
- [ ] `registerBotJobs(boss, healthCheck)`: create both queues, `boss.schedule('bots.schedule-health-checks', '* * * * *')`, `boss.send('bots.check-health', payload, { singletonKey, expireInSeconds: 30, retryLimit: 0 })`, workers parse `BotHealthCheckJob` — `bots/infra/jobs.ts`
- [ ] Unit tests with fakes for each outcome row; integration test with real pg-boss tables: two ticks enqueueing the same bot run one check; a job for a disconnected/deleted bot or a wrong workspace id changes nothing — `jobs.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Bot disconnected after being enqueued | no-op; row not resurrected |
| Job payload with a workspace id that does not own the bot | nothing read or changed |
| Rate limit (429) | transient: state and `last_checked_at` unchanged |
| `getMe` ok, `getWebhookInfo` transient | transient: nothing written |

## Definition of Done

- [ ] unit tests cover each outcome row; the singleton and no-op integration tests pass
- [ ] job payloads never contain a token or secret
- [ ] lint + vet clean (`pnpm lint`)
