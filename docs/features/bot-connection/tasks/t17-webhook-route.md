---
id: T17
title: "Expose the Telegram webhook route with secret-before-parse, empty-body 401/200 and fail-closed 500"
layer: "ports"
deps: ["T14", "T16"]
blocks: ["T19", "T20", "T21", "T22"]
acs: ["AC-07", "AC-09", "AC-10", "AC-11", "AC-12", "AC-14"]
files_hint: ["apps/api/src/modules/bots/http/routes.ts", "apps/api/src/modules/bots/http/webhook-route.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T17 — Expose the Telegram webhook route with secret-before-parse, empty-body 401/200 and fail-closed 500

## Place in the sequence

- **Blocked by:** T14 — accept-update use case, T16 — `registerBots` + wiring · **Blocks:** T19 — Update CLAUDE.md, the architecture map, the workspace-operators SAD and the design system for the new modules, exceptions and config, T20 — Add the three API-level end-to-end stories: capture lifecycle, edits and redeliveries, health and recovery, T21 — Add the token-secrecy suite: no token, secret or message text in any log line or response across every bot flow, T22 — Write the load-test script for throughput, flood isolation, owner actions and settings load (runnable locally, run pre-pilot) · **Wave:** 7.
- **Lane:** shares `modules/bots/http/routes.ts` with T16 — serialized after it.

## Why (user story)

> **As an** End customer
> **I want** what I write to the business's bot to reach the business's team
> **So that** I get an answer without leaving Telegram or knowing who is on shift
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** every message from one customer kept in a single conversation, in the order it was sent and up to date with the customer's edits
> **So that** I see the whole history when I answer
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

This task opens the one unauthenticated entry point and makes its answer mean exactly "captured" (200) or "try again" (5xx).

## Inlined context

> The secret header is checked before the body is parsed: the bot is looked up by `botId`, and the SHA-256 of the header is compared in constant time with the stored hash. An unknown bot, a missing or mismatched secret, or a disconnected bot (whose secret hash is cleared) gets `401` with an empty body, and nothing is recorded (AC-14, AC-18). For an authentic update, everything is answered `200` with an empty body, both what is captured and what is deliberately ignored […] A server failure answers `500`, and Telegram redelivers (ADR-0003).
> `botId`: An id that is not a UUID is treated as an unknown bot (`401`), not a validation error, so the route gives no hint
>
> — `contracts/openapi.yaml, receiveTelegramUpdate, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

> With option 1 the URL reveals only an opaque id, the secret proves Telegram sent the request for that bot
>
> — `adr/0002, Decision outcome, abridged` · full text: [ADR-0002](../adr/0002-receive-updates-through-one-webhook-per-bot-authenticated-by-a-per-bot-secret.md)

> Metrics (from structured logs): webhook request duration (acknowledgement p95), ingest duration from receipt to commit (capture p95) […] webhook `401` count per bot id, ignored-update count by reason
>
> — `sad.md §7, Monitoring, abridged` · full text: [sad.md](../sad.md)

The webhook is outside `/api/workspaces/…`, takes no session, and is exempt from nothing else: it still requires `application/json` (Telegram sends it).

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No schema change (writes through T14 → T9).

## API contract

- `POST /api/telegram/webhook/{botId}` · security `X-Telegram-Bot-Api-Secret-Token` · body any JSON (`TelegramUpdate`, not validated at HTTP) → `200` empty · `401` empty (not the envelope) · `500` `{error:{code:INTERNAL_ERROR}}`.

— `contracts/openapi.yaml, operationId receiveTelegramUpdate, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

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

### AC-10 — happy path

> **Given** a captured message in an end customer's conversation — text, or a non-text message with a caption
> **When** the customer edits its text or caption in Telegram
> **Then** the conversation holds the edited text in place of the old one, marked as edited, and no new message is added; when edits arrive out of order, the one the customer made last (by Telegram's edit time) wins; an edit of a message that has not been captured adds nothing and is not kept for later
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — domain invariant

> **Given** a message from an end customer that has already been captured
> **When** Telegram delivers the same message again (for example after a delivery retry)
> **Then** the conversation still holds it exactly once, and messages keep the order in which the customer sent them (Telegram's order for that chat), not the order in which they reached tg-inbox — a late redelivered message takes its original place
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — domain invariant

> **Given** a connected bot of "Acme Flowers"
> **When** someone writes in a group or channel the bot belongs to, another bot writes to it, or the bot receives messages on behalf of someone's personal Telegram Business account
> **Then** the system captures nothing from it and creates no contact or conversation — only private chats between people and the bot are captured
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — authorization

> **Given** a connected bot of "Acme Flowers"
> **When** someone who is not Telegram sends the system a message pretending to come from that bot
> **Then** the system ignores it — nothing is captured and no contact or conversation is created
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Add the route to `registerBots` with a `preHandler` that runs the secret check before body handling; `reply.code(401).send()` / `reply.code(200).send()`; log `ingest_ms` and the outcome with bot id + update id only — `bots/http/routes.ts`
- [ ] `app.inject()` tests with `signedDelivery` (T3): first message → contact + conversation + message; every kind incl. `other`; album; edit in/out of order; redelivery once; lower id after higher reads back in order; group/channel/bot/business ignored with 200; missing / wrong / other bot's secret / unknown / malformed id → identical empty 401; forced DB failure → 500 then redelivery captured once; delivery after disconnect → 401 — `webhook-route.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Authentic body that is not an update | 200, nothing captured, body not logged |
| Very long text / unusual name | captured as given |
| Bot `needs_token` with right secret | captured |

## Definition of Done

- [ ] every inject case above passes; 401 bodies are byte-identical across all four refusal causes
- [ ] no request or error log contains the secret header, message text or caption (asserted)
- [ ] lint + vet clean (`pnpm lint`)
