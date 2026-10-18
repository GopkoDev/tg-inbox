---
id: T14
title: "Implement the bots use case accept-webhook-update: secret check, inbound filter, capture epoch, hand-off to conversations"
layer: "app"
deps: ["T5", "T9", "T10"]
blocks: ["T17"]
acs: ["AC-07", "AC-09", "AC-12", "AC-13", "AC-14"]
files_hint: ["apps/api/src/modules/bots/app/ports.ts", "apps/api/src/modules/bots/app/accept-update.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T14 — Implement the bots use case accept-webhook-update: secret check, inbound filter, capture epoch, hand-off to conversations

## Place in the sequence

- **Blocked by:** T5 — inbound filter + normaliser, T9 — capture / apply edit, T10 — `findByWebhookId` · **Blocks:** T17 — Expose the Telegram webhook route with secret-before-parse, empty-body 401/200 and fail-closed 500 · **Wave:** 4.
- **Lane:** shares `modules/bots/app/ports.ts` with T10–T13, T15 — serialized.

## Why (user story)

> **As an** End customer
> **I want** what I write to the business's bot to reach the business's team
> **So that** I get an answer without leaving Telegram or knowing who is on shift
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

This task decides, for every delivery, whether it is authentic and capturable, and hands only private human messages to the capture.

## Inlined context

> Bots->>Db: find the bot by webhook id and compare the secret hash · alt unknown bot or secret mismatch → not from Telegram for this bot → unauthorized, nothing captured · else authentic → filter to private chats with a human sender and no business connection · alt group, channel, bot sender, business message or older than the capture epoch → ignored · else captured kind → capture the normalised message for the workspace
>
> — `sad.md §6, Critical flow 2, abridged` · full text: [sad.md](../sad.md)

> An edited message follows the same path to `conversations`, which updates the stored text only when the edit is later than the stored one and does nothing for an uncaptured message (AC-10)
>
> — `sad.md §6, after Critical flow 2, abridged` · full text: [sad.md](../sad.md)

> A bot in state `needs_token` or `taken_over` still captures anything Telegram delivers with the right secret. […] An authentic body that is not a recognisable update is also ignored with `200`, and is never answered `400`, because Telegram would redeliver it for 24 h.
>
> — `contracts/openapi.yaml, receiveTelegramUpdate description, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

> capture logs carry workspace id, bot id and Telegram update id — never the token, the secret or message text
>
> — `sad.md §7, Monitoring / Tracing, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No schema change. Reads `bots` by PK through the controlled exception *bot by webhook id*; writes go through the conversations app layer (T9).

## API contract

Internal — the route is T17. Use case: `acceptUpdate(botId, secretHeader, body) → 'unauthorized' | 'captured' | 'already_present' | 'edited' | 'ignored:<reason>'`; DB errors propagate (route answers 500).

## Acceptance criteria

### AC-07 — happy path

> **Given** "Acme Flowers" has a connected bot and an end customer who has never written to it
> **When** the end customer starts the bot or sends it a first message in a private chat (starting the bot is captured as a message like any other text)
> **Then** within the capture-latency target of §6 (2 seconds at p95) "Acme Flowers" holds a new contact built from the customer's Telegram profile (name, username, language) and a new conversation with that contact containing the message, and the bot settings show the time of that message as the last message received
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — happy path

> **Given** a connected bot and an end customer with a conversation in "Acme Flowers"
> **When** the customer sends a photo with a caption, a voice note, a sticker, a file, a location, or any other kind of message
> **Then** each one appears in their conversation in the order sent (each item of an album as its own message), marked with its kind — a kind tg-inbox does not recognise is marked "other" — and carrying its caption when it has one, so the workspace holds a record that something arrived; viewing its content arrives with the inbox step; later updates of a shared live location do not change the captured location
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — domain invariant

> **Given** a connected bot of "Acme Flowers"
> **When** someone writes in a group or channel the bot belongs to, another bot writes to it, or the bot receives messages on behalf of someone's personal Telegram Business account
> **Then** the system captures nothing from it and creates no contact or conversation — only private chats between people and the bot are captured
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — cross-context

> **Given** "Acme Flowers" and "Bolt Bikes" each have a connected bot, and one person writes to both bots
> **When** both messages are captured
> **Then** each workspace has its own contact and conversation for that person, holding only the messages sent to its own bot, and neither workspace can see that the other one knows the person
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — authorization

> **Given** a connected bot of "Acme Flowers"
> **When** someone who is not Telegram sends the system a message pretending to come from that bot
> **Then** the system ignores it — nothing is captured and no contact or conversation is created
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `acceptUpdate` — `bots/app/accept-update.ts`: `findByWebhookId(botId, secret)` → none ⇒ `unauthorized`; `classifyUpdate(body, { connectedAt })` → `capture` ⇒ `conversations.captureInbound(workspaceId, …)`, `edit` ⇒ `conversations.applyEdit(…)`, `ignore` ⇒ log reason + ids only
- [ ] Unit tests with fakes for each outcome; Postgres integration test: the same person writing to "Acme" and "Bolt" bots lands one contact + one conversation in each, holding only its own message

## Edge cases

| Case | Behaviour |
|---|---|
| Secret of bot A sent to bot B's id | `unauthorized`; nothing captured in either workspace |
| Unknown / non-UUID bot id | `unauthorized` (same as wrong secret) |
| Message dated before `connected_at` | `ignored:before_epoch` |
| Body is not an object / lacks `update_id` | `ignored:malformed` |
| Bot `needs_token` / `taken_over` with right secret | still captured |

## Definition of Done

- [ ] unit tests for every outcome and the two-workspace integration test (AC-13) pass
- [ ] ignore/unauthorized logs carry bot id, workspace id (when known) and update id only — asserted
- [ ] lint + vet clean (`pnpm lint`)
