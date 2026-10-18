---
id: T22
title: "Write the load-test script for throughput, flood isolation, owner actions and settings load (runnable locally, run pre-pilot)"
layer: "tests"
deps: ["T17"]
blocks: []
acs: ["AC-07", "AC-11"]
files_hint: ["apps/api/load/", "apps/api/package.json"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "S"
status: "todo"
---

# T22 — Write the load-test script for throughput, flood isolation, owner actions and settings load (runnable locally, run pre-pilot)

## Place in the sequence

- **Blocked by:** T17 — the webhook route exists · **Blocks:** — · **Wave:** 8.
- **Lane:** shares `apps/api/package.json` with no other task here — own lane.

## Why (user story)

> **As an** End customer
> **I want** what I write to the business's bot to reach the business's team
> **So that** I get an answer without leaving Telegram or knowing who is on shift
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

This task delivers the instrument for the spec's throughput and flood-isolation targets. **Scope note:** no production-like host exists yet (sad §11 risk, High), so this task's DoD is a script that runs against a local instance with a smoke profile; the full scenarios run on a production-like host before the first pilot and are **not** part of this task's DoD.

## Inlined context

> | Throughput | ≥ 50 inbound messages/s per instance across all bots | load test before the first pilot |
> | Flood isolation | while one bot receives 20 messages/s for 5 minutes, capture latency of other workspaces' bots stays ≤ 2 s p95 | load test before the first pilot |
>
> — `spec.md §6, NFR rows, verbatim` · full text: [spec.md](../spec.md)

> The generator posts signed deliveries straight to `/api/telegram/webhook/<bot id>` and, like Telegram, keeps at most `TELEGRAM_WEBHOOK_MAX_CONNECTIONS` requests in flight per bot. Capture latency is read from the server's ingest-duration log (receipt → commit), acknowledgement from the request-duration log. After every scenario a completeness check compares sent and stored message ids per bot.
> **Flood isolation** → 10 workspaces with a connected bot; bot F receives 20 messages/s for 5 min (variant A: 200 distinct senders; variant B: one sender — the hot-row case) while the other 9 bots receive 3 messages/s each […]; assert the other bots' capture p95 ≤ 2 s and acknowledgement p95 ≤ 300 ms over the flood window, zero server errors on any bot, and 0 lost / 0 duplicated messages on every bot including F
> **Throughput** → sustain 50 messages/s for 10 min spread over 10 bots and 500 senders (10% edits, 1% redeliveries) · **Owner actions** → 1 action/s for 5 min cycling connect → rotate → disconnect across 50 workspaces, fake Bot API adding 300 ms per call · **Bot settings load** → 20 requests/s for 5 min, one workspace with 100 000 messages and 5 000 contacts
>
> — `test-plan.md §NFR validation (load), abridged` · full text: [test-plan.md](../test-plan.md)

> Tool: the load tool already in your repo (none yet), or e.g. k6 or Locust.
>
> — `test-plan.md §NFR validation (load), verbatim` · full text: [test-plan.md](../test-plan.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No schema change. The seed step inserts workspaces, owners and connected bots through the fixtures / app layer.

## API contract

Posts `receiveTelegramUpdate`; calls the owner routes for the owner-action scenario ([openapi.yaml](../contracts/openapi.yaml)).

## Acceptance criteria

### AC-07 — happy path

> **Given** "Acme Flowers" has a connected bot and an end customer who has never written to it
> **When** the end customer starts the bot or sends it a first message in a private chat (starting the bot is captured as a message like any other text)
> **Then** within the capture-latency target of §6 (2 seconds at p95) "Acme Flowers" holds a new contact built from the customer's Telegram profile (name, username, language) and a new conversation with that contact containing the message, and the bot settings show the time of that message as the last message received
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — domain invariant

> **Given** a message from an end customer that has already been captured
> **When** Telegram delivers the same message again (for example after a delivery retry)
> **Then** the conversation still holds it exactly once, and messages keep the order in which the customer sent them (Telegram's order for that chat), not the order in which they reached tg-inbox — a late redelivered message takes its original place
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Pick the generator (Node script with `undici` + a per-bot concurrency cap, so no new tool is needed; k6 is acceptable) and record the choice in the script header — `apps/api/load/`
- [ ] Seed (N workspaces + bots, secrets kept in memory), the four scenarios with `--profile smoke|full`, the completeness check, and a report of p95 capture (from `ingest_ms` log lines) and acknowledgement per bot
- [ ] `pnpm --filter @tg/api load -- --scenario flood --profile smoke` script — `apps/api/package.json`; README-style usage in the script header (not a new .md)

## Edge cases

| Case | Behaviour |
|---|---|
| Server errors during a run | counted and reported; the script exits non-zero |
| Lost / duplicated ids | listed per bot; exit non-zero |

## Definition of Done

- [ ] `--profile smoke` of every scenario runs against a local instance (Docker Postgres + fake Bot API) and prints the report with 0 lost / 0 duplicated
- [ ] running `--profile full` on a production-like host is a pre-pilot activity tracked outside this task (sad §11), not part of this DoD
- [ ] lint + vet clean (`pnpm lint`)
