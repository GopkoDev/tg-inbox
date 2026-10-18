---
id: T18
title: "Register the health-check workers in buildApp and prove five-minute freshness over a simulated hour"
layer: "wiring"
deps: ["T15", "T16"]
blocks: ["T19", "T20", "T21"]
acs: ["AC-15", "AC-16", "AC-16b"]
files_hint: ["apps/api/src/app.ts", "apps/api/src/deps.ts", "apps/api/src/modules/bots/infra/freshness.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T18 — Register the health-check workers in buildApp and prove five-minute freshness over a simulated hour

## Place in the sequence

- **Blocked by:** T15 — health check + `registerBotJobs`, T16 — bots wiring · **Blocks:** T19 — Update CLAUDE.md, the architecture map, the workspace-operators SAD and the design system for the new modules, exceptions and config, T20 — Add the three API-level end-to-end stories: capture lifecycle, edits and redeliveries, health and recovery, T21 — Add the token-secrecy suite: no token, secret or message text in any log line or response across every bot flow · **Wave:** 7.
- **Lane:** shares `apps/api/src/app.ts` / `deps.ts` with T16 — serialized after it.

## Why (user story)

> **As a** Business owner
> **I want** to see which bot is connected, whether it is working and when the last message arrived
> **So that** I notice a broken connection before customers do
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

This task turns the health check on in the running app and proves the five-minute bound end to end.

## Inlined context

> Background jobs: pg-boss 12, started in `buildApp()` (`apps/api/src/platform/jobs.ts`), queues named `<module>.<job>`
>
> — `sad.md §2, Technical, verbatim` · full text: [sad.md](../sad.md)

> pg-boss workers are registered from the composition root and can move to their own process later without module changes
>
> — `adr/0001, Decision outcome, abridged` · full text: [ADR-0001](../adr/0001-build-bot-connection-as-an-api-with-a-telegram-webhook-ingress-and-an-owner-only-panel-page.md)

> integration tests with a controllable clock and a fake Bot API: a bot last checked 3 minutes ago is checked on the next tick and no bot's last check is ever older than 5 minutes across a simulated hour, an unauthorized `getMe` moves it to "needs a new token", a foreign webhook URL moves it to "taken over", and a transient failure leaves the state unchanged.
>
> — `sad.md §10, QG-3b How verify, verbatim` · full text: [sad.md](../sad.md)

> Alerts: […] a health-check tick that did not run for 5 minutes
>
> — `sad.md §7, Monitoring, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface.

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

- [ ] In `buildApp()` after `startJobs`, call `registerBotJobs(jobs, deps.botHealthCheck)`; log each tick (`bots.schedule-health-checks` with count) so the "tick did not run" alert has a signal — `apps/api/src/app.ts`
- [ ] Expose a test hook to run one tick with the controllable clock (no sleeping) — `deps.ts` returns `botHealthCheck`
- [ ] Simulated-hour test: 3 bots (connected, connected→revoked at minute 10, connected→taken over at minute 20); 60 ticks; assert every live bot's `last_checked_at` is never > 5 min old, and the two transitions happen on the first tick after they become due — `bots/infra/freshness.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Telegram transient for 10 minutes on one bot | that bot's state and `last_checked_at` unchanged; others still fresh |
| `app.close()` | `jobs.stop({ graceful: true })` stops the workers (existing hook) |

## Definition of Done

- [ ] the simulated-hour integration test passes; `app.int.test.ts` smoke stays green
- [ ] lint + vet clean (`pnpm lint`)
