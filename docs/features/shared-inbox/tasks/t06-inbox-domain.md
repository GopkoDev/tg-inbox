---
id: T6
title: "Add the inbox domain rules: reply text check, delivery outcome to reply state, retry window, per-member limit window"
layer: "domain"
deps: []
blocks: ["T17", "T18"]
acs: ["AC-07", "AC-10", "AC-11", "AC-12", "AC-12b", "AC-13"]
files_hint: ["apps/api/src/modules/inbox/domain/"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T6 — Add the inbox domain rules: reply text check, delivery outcome to reply state, retry window, per-member limit window

## Place in the sequence

- **Blocked by:** — · **Blocks:** T17 — Add the sendReply and resendReply use cases and routes with the flow-1 check order and the drain-job hook, T18 — Build the inbox.deliver-replies drain worker with pre-checks, pacing, outcome handling, back-off jobs and the dead-letter handler · **Wave:** 1 — nothing upstream.
- **Lane:** own lane (new `inbox/domain` directory).

## Why (user story)

> **As an** Operator
> **I want** to write a text reply in a conversation and send it
> **So that** the customer gets an answer from the business without me touching Telegram
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** every reply I send to show whether it reached Telegram, and if not, why
> **So that** no customer is left believing they were answered when they were not
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It decides, without I/O, whether a text may be sent and what each Telegram answer means for the reply and the drain.

## Inlined context

> reply text rule (trimmed non-empty, ≤ 4096), delivery outcome → state + reason, retry window, per-member limit window, signal types
>
> — `sad.md §5, Internal decomposition, modules/inbox/domain, verbatim` · full text: [sad.md](../sad.md)

> The rule constants (4096 characters, 30 replies per 60 s, 5-minute retry window, 5 s socket re-validation, 10 s send timeout) are fixed by the spec or this SAD and live in `inbox/domain`
>
> — `sad.md §7, Configuration added, abridged` · full text: [sad.md](../sad.md)

> | accepted | `accepted` | `sent`, `sent_at`, `telegram_message_id`. […] | yes |
> | 403 blocked / deactivated account, 400 chat not found | `refused` | `not_delivered` with `customer_blocked` / `customer_account_gone` / `chat_not_found` (AC-10) | yes |
> | 401 bot unauthorized | `bot_unauthorized` | `not_delivered` / `bot_not_working` (AC-13) | yes |
> | 429 (`retry_after`), 5xx, connection refused before the request was written, **within** 5 min of `position_at` | `not_accepted` | stays `sending` | **no**: enqueue a delayed drain and stop, so later replies wait (AC-12) |
> | the same, **after** 5 min | `not_accepted` | `not_delivered` / `telegram_not_accepted` (AC-12) | yes |
> | timeout, or a reset after the request was written | `unknown` | `not_confirmed` (AC-11) | yes |
>
> — `contracts/events.md §Event: inbox.deliver-replies, outcome table, abridged` · full text: [events.md](../contracts/events.md)

> 1. The body is a schema-valid text of 1–4096 characters that is not only spaces or new lines, counted in UTF-16 units as Telegram counts them → otherwise `400 VALIDATION_ERROR` (AC-07).
>
> — `contracts/openapi.yaml, sendReply, verbatim` · full text: [openapi.yaml](../contracts/openapi.yaml)

> a send first counts that member's initiated attempts in this workspace over the last 60 s […] and the refusal says when the oldest of the 30 leaves the window.
>
> — `sad.md §4, Per-member reply limit, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface. (Produces the `400 VALIDATION_ERROR` message variants «Replies are limited to 4096 characters» / «Write a reply before sending» used by `sendReply`.)

## Acceptance criteria

### AC-07 — error

> **Given** an operator in a conversation of "Acme Flowers"
> **When** they try to send with an empty reply box, one holding only spaces or new lines, or one longer than 4096 characters
> **Then** nothing is sent and sending stays unavailable; for an over-long reply the box says replies are limited to 4096 characters and keeps the text so it can be shortened
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — error

> **Given** an operator of "Acme Flowers" replying to an end customer who has blocked the bot (or deleted their Telegram account)
> **When** they send the reply
> **Then** the reply stays in the thread marked "not delivered — the customer blocked the bot" (or "the customer's Telegram account no longer exists"), the conversation keeps its "waiting for a reply" marker, and the operator understands the customer can be reached again only after they unblock the bot and write to it; the reply box stays usable, and each further reply fails the same way until the customer writes again
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — domain invariant

> **Given** an operator of "Acme Flowers" sending a reply
> **When** they press send twice quickly, lose their connection right after sending, or tg-inbox cannot learn whether Telegram accepted the reply
> **Then** the customer receives the reply at most once: a double press of one send sends one reply (two replies a member deliberately sends, even with the same text, are both sent); when the outcome is unknown the reply is marked "not confirmed — it may or may not have reached the customer" and is never resent automatically; the operator can send it again only after a warning that the customer may receive it twice — a reply is never delivered twice without a member choosing so
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — error

> **Given** an operator of "Acme Flowers" sending a reply while Telegram is temporarily unavailable or asks the bot to slow down
> **When** Telegram answers that it did not accept the reply (it is unavailable or asks the bot to slow down)
> **Then** the reply stays "sending" and tg-inbox keeps trying on its own for up to 5 minutes; within one conversation replies reach the customer in the order they were written, and a later reply waits while an earlier one of the same conversation is still sending — other conversations are not held up; if it is still not accepted, it is marked "not delivered — Telegram did not accept it, try again" with a "Try again" action that sends it once more (it then moves to the end of the thread, at the time it was sent again); a send whose answer never came back is never retried on its own — it follows AC-11 ("not confirmed")
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-12b — error

> **Given** an operator of "Acme Flowers" who has sent 30 replies in this workspace within the last 60 seconds (automatic retries do not count; "Try again" and "send again" do)
> **When** they try to send another one
> **Then** the reply is not sent, the text stays in the reply box, and the inbox says that replies are limited to 30 per minute per member and when sending is available again; the limit is per workspace, so replies in another workspace of the same account are not affected
>
> — `spec.md §5, AC-12b, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — cross-context

> **Given** the bot of "Acme Flowers" is not connected, or is in the state "not working — needs a new token"
> **When** an operator or business owner opens the inbox or a conversation
> **Then** every conversation stays readable, the reply box is unavailable and explains that replies cannot be sent until the bot works again — a business owner gets the way to the bot settings, an operator is told to ask a business owner; a reply still "sending" when the bot stops working ends up "not delivered — the bot is not working"; once a business owner fixes the bot — the same bot, since a workspace keeps one business bot once customers have written to it (bot-connection AC-05) — replying works again without reloading
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Constants: `REPLY_MAX = 4096`, `REPLY_LIMIT = 30`, `LIMIT_WINDOW_MS = 60_000`, `RETRY_WINDOW_MS = 300_000`, `SEND_TIMEOUT_MS = 10_000`, `REVALIDATE_MS = 5_000`, `CHAT_PACE_MS = 1_000` — `modules/inbox/domain/rules.ts`
- [ ] `checkReplyText(text)` → ok | blank | too_long, counting UTF-16 units (`text.length`) — `modules/inbox/domain/reply-text.ts`
- [ ] `decideOutcome(gatewayOutcome, positionAt, now)` → { attemptOutcome, replyState, failureReason?, drainContinues, retryAfterMs? } per the table above — `modules/inbox/domain/delivery.ts`
- [ ] `limitRetryAt(oldestCountedAt)` = oldest + 60 s; `isOverLimit(count)` = count ≥ 30 — `modules/inbox/domain/limit.ts`
- [ ] Unit tests for every row of the outcome table, both sides of the 5-minute boundary, and the text edge cases

## Edge cases

| Case | Behaviour |
|---|---|
| Text of exactly 4096 UTF-16 units | ok |
| 4096 code points that are 4097+ UTF-16 units (emoji) | too_long |
| Only spaces / new lines / tabs | blank |
| 429 with `retry_after: 7` at 4 min 59 s | stays `sending`, drain stops, retry after 7 s |
| 5xx at 5 min 01 s after `position_at` | `not_delivered` / `telegram_not_accepted`, drain continues |
| Timeout | `not_confirmed`, never retried, drain continues |

## Definition of Done

- [ ] inbox domain unit tests cover every outcome-table row, the 5-minute boundary, UTF-16 counting and the limit `retry_at`
- [ ] `modules/inbox/domain` imports nothing outside itself and `packages/shared`
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
