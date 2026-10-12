---
id: T20
title: "Add the three API-level end-to-end stories: capture lifecycle, edits and redeliveries, health and recovery"
layer: "tests"
deps: ["T17", "T18"]
blocks: ["T27"]
acs: ["AC-01", "AC-07", "AC-11", "AC-13", "AC-16", "AC-17", "AC-18", "AC-19"]
files_hint: ["apps/api/src/e2e/bot-flows.int.test.ts", "apps/api/src/e2e/helpers.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T20 — Add the three API-level end-to-end stories: capture lifecycle, edits and redeliveries, health and recovery

## Place in the sequence

- **Blocked by:** T17 — webhook route, T18 — health jobs in the app · **Blocks:** T27 — Add the seven browser end-to-end flows for bot settings against the fake Bot API · **Wave:** 8.
- **Lane:** shares `apps/api/src/e2e/helpers.ts` with nothing else in this epic — own lane.

## Why (user story)

> **As a** Business owner
> **I want** to connect the business bot to my workspace by pasting its token
> **So that** messages from our customers start arriving in tg-inbox without help from the tg-inbox team
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** End customer
> **I want** what I write to the business's bot to reach the business's team
> **So that** I get an answer without leaving Telegram or knowing who is on shift
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to give the connected bot a new token or disconnect it
> **So that** a leaked token or a bot we stop using does not put our customers at risk, without losing what was captured
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task proves the stories hold together across real entry points, each step using only what the previous one returned.

## Inlined context

> Three full stories through their real entry points: (1) capture lifecycle — owner connects via the API, customers' updates are posted to the webhook, owner rotates, disconnects and connects again (US-01, US-02, US-03, US-06, AC-19); (2) customer edits and redeliveries (US-04); (3) health — revoke and takeover scripted on the fake Bot API, the scheduled check runs, the owner recovers (US-05). — Multi-step scenario against an ephemeral database and the fake Bot API; each step uses only what an earlier step returned (settings, webhook URL and secret captured by the fake from `setWebhook`).
>
> — `test-plan.md §Levels, E2E, verbatim` · full text: [test-plan.md](../test-plan.md)

Precedent: `apps/api/src/e2e/flows.int.test.ts` + `helpers.ts` (workspace-operators T26) — reuse its owner/workspace seeding.

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Calls `getBotSettings`, `pasteBotToken`, `reconnectBot`, `disconnectBot`, `receiveTelegramUpdate` exactly as in [openapi.yaml](../contracts/openapi.yaml); the webhook secret is read from the fake's recorded `setWebhook` call, never from the DB.

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers", which has no connected bot, and the token of the business's bot "Acme Flowers Support", which is not connected to any workspace
> **When** the owner pastes the token (surrounding spaces are ignored) and confirms
> **Then** the system checks the token with Telegram, connects the bot, and shows the owner the bot's name and username with the state "connected"; from then on the bot's private messages are captured into "Acme Flowers", and the token itself is never shown again
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

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

### AC-13 — cross-context

> **Given** "Acme Flowers" and "Bolt Bikes" each have a connected bot, and one person writes to both bots
> **When** both messages are captured
> **Then** each workspace has its own contact and conversation for that person, holding only the messages sent to its own bot, and neither workspace can see that the other one knows the person
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — error

> **Given** a connected bot whose token was revoked in BotFather, or which was deleted there
> **When** a business owner of "Acme Flowers" opens the bot settings
> **Then** the system shows the state "not working — needs a new token", explains that messages are not arriving until the owner pastes a new token of the same bot, and keeps every contact and conversation already captured; once a new token is pasted (AC-17), messages customers sent meanwhile that Telegram still holds (up to 24 h) are captured in order
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — happy path

> **Given** a business owner of "Acme Flowers" whose bot is connected (or not working because its old token was revoked)
> **When** they paste a new token of the same bot
> **Then** the bot is connected with the new token, the old token is no longer used, and new messages from existing end customers continue their existing conversations
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — happy path

> **Given** a business owner of "Acme Flowers" with a connected bot
> **When** they disconnect it and confirm
> **Then** the bot settings show "not connected", the bot stops delivering its messages to tg-inbox, its token is no longer kept by tg-inbox, messages sent to the bot afterwards are never captured (not even if the bot is connected again later), and every contact and conversation captured so far stays in the workspace
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

### AC-19 — cross-context

> **Given** "Acme Flowers" disconnected its bot earlier and its contacts and conversations remain
> **When** a business owner connects the same bot again by pasting its token and an existing end customer writes to it
> **Then** the message continues that customer's existing conversation and no duplicate contact is created
>
> — `spec.md §5, AC-19, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Story 1: connect → two customers write (one also writes to "Bolt Bikes"' bot) → settings show last message + count → rotate → old token unused, conversations continue → disconnect → late delivery 401 → connect again → existing customer continues, no duplicate contact, pre-epoch redelivery ignored — `bot-flows.int.test.ts`
- [ ] Story 2: text, edit, out-of-order edits, redelivered message, lower id after higher → read back in order, edited once
- [ ] Story 3: revoke on the fake → tick → `needs_token` → paste new token → held updates captured in order; takeover on the fake → tick → `taken_over` → reconnect (409 confirm) → confirm → connected
- [ ] Extend `helpers.ts` with `startFakeTelegram` wiring and a `runHealthTick()` helper

## Edge cases

| Case | Behaviour |
|---|---|
| A step needs data not returned by a previous step | not allowed — read it through the API or the fake's recorded calls |

## Definition of Done

- [ ] the three stories pass locally with Docker and in CI (`pnpm test`)
- [ ] lint + vet clean (`pnpm lint`)
