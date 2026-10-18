---
id: T11
title: "Build the delivery side in conversations: pending replies, in-flight mark, outcome recording, mark sent, stale in-flight and dead-letter resolution"
layer: "infra"
deps: ["T10"]
blocks: ["T18"]
acs: ["AC-06", "AC-09", "AC-10", "AC-11", "AC-12", "AC-13"]
files_hint: ["apps/api/src/modules/conversations/app/ports.ts", "apps/api/src/modules/conversations/app/fakes.ts", "apps/api/src/modules/conversations/app/replies.ts", "apps/api/src/modules/conversations/infra/reply-repo.ts", "apps/api/src/modules/conversations/infra/delivery.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T11 — Build the delivery side in conversations: pending replies, in-flight mark, outcome recording, mark sent, stale in-flight and dead-letter resolution

## Place in the sequence

- **Blocked by:** T10 — Build reply creation and re-queueing in conversations: idempotent client key, per-member limit under an advisory lock, teammate check, attempt row and drain job in one transaction · **Blocks:** T18 — Build the inbox.deliver-replies drain worker with pre-checks, pacing, outcome handling, back-off jobs and the dead-letter handler · **Wave:** 5 — after T10.
- **Lane:** serialized lane after T10 (same `reply-repo.ts`, `replies.ts`).

## Why (user story)

> **As an** Operator
> **I want** every reply I send to show whether it reached Telegram, and if not, why
> **So that** no customer is left believing they were answered when they were not
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It is the storage half of the drain: what is pending, what is in flight, and the truthful final state of each reply.

## Inlined context

> `inbox` → `conversations`: […] *pending replies of a conversation*, *record attempt start / outcome*
>
> — `sad.md §5, Cross-module app-layer calls, abridged` · full text: [sad.md](../sad.md)

> 1. Finds this conversation's attempt still in flight (started, no outcome). If it started more than 10 s ago, the attempt becomes `unknown` and its reply `not_confirmed`, and it is never retried on its own (AC-11).
> 2. Takes the pending replies (`state = 'sending'`) oldest position first. […]
> - Waits until at least 1 s has passed since the last start in this chat. Commits the attempt's `started_at` (in flight). Takes the member's unstarted attempt, or inserts a `retry` attempt for an automatic retry.
>
> — `contracts/events.md §Event: inbox.deliver-replies, Work, abridged` · full text: [events.md](../contracts/events.md)

> - accepted → "sent", with Telegram's message id and time; the conversation's activity and "waiting" columns update in the same transaction;
>
> — `adr/0004, Outcome rules, verbatim` · full text: [ADR-0004](../adr/0004-send-replies-at-most-once-through-a-per-conversation-delivery-queue-with-an-in-flight-mark.md)

> The dead-letter handler marks:
> - this conversation's in-flight attempts `unknown` (their replies become `not_confirmed`);
> - its never-attempted `sending` replies `not_delivered` / `delivery_interrupted` (never sent, so "Try again" is safe).
>
> Each of these writes publishes a `state` signal. **Pending design confirmation** — sad.md §6 flagged this handler for `design`, see api-sync-report.md OQ-2.
>
> — `contracts/events.md §Event: inbox.deliver-replies, Dead-letter, verbatim` · full text: [events.md](../contracts/events.md)

> - Newest started attempt of a conversation, for pacing (≥ 1 s since) and the stale in-flight check (unfinished and older than 10 s) → `reply_attempts_conversation_id_started_at_idx`. The drain is sequential per conversation, so the in-flight attempt is always the newest started one.
>
> — `data-model.md §reply_attempts, Access patterns, verbatim` · full text: [data-model.md](../data-model.md)

> **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation.
>
> — `CLAUDE.md §Rules, Tenancy, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Table | Columns | Change |
|---|---|---|
| `replies` | `state`, `failure_reason`, `sent_at`, `telegram_message_id` | final state per outcome |
| `reply_attempts` | `started_at` (in flight), `finished_at`, `outcome`; new `retry` rows (`initiated_by_account_id` null) | written by the drain |
| `conversations` | `last_reply_sent_at`, `last_activity_at` | raised with `GREATEST` when a reply is marked sent (same `UPDATE`, CHECK holds) |

Indexes: `replies_pending_idx` (partial, `state = 'sending'`), `reply_attempts_conversation_id_started_at_idx`, `reply_attempts_reply_id_idx`.

— `data-model.md §replies + §reply_attempts + §conversations, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface. Each state write publishes `conversation.changed { change: state, item: reply }` (`events.md`).

## Acceptance criteria

### AC-06 — happy path

> **Given** an operator of "Acme Flowers", whose bot is connected, in a conversation with an end customer who has not blocked the bot
> **When** they type a reply and press Enter (Shift+Enter starts a new line)
> **Then** the reply appears at once at the end of the thread marked "sending" with the operator's name, then "sent" once Telegram accepts it (within the reply-latency target of §6); the conversation moves to the top of the list for the whole team, its "waiting for a reply" marker disappears, and the reply box is empty and ready for the next reply; the preview's note that nothing is sent to customers is no longer shown
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — authorization

> **Given** an operator of "Acme Flowers" with the inbox open
> **When** a business owner deactivates their membership, or the operator switches to another workspace in that browser tab
> **Then** within 5 seconds the open inbox stops receiving new messages and replies of "Acme Flowers", the next action leads to the access-removed notice (deactivation) or shows only the other workspace's conversations (switch), and no conversation of "Acme Flowers" is shown inside another workspace, not even for a moment; switching affects only that tab — another tab of the same account still showing "Acme Flowers" keeps working; after deactivation, the member's replies still waiting to be retried are not sent and end "not delivered — the author's access was removed"
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

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

### AC-13 — cross-context

> **Given** the bot of "Acme Flowers" is not connected, or is in the state "not working — needs a new token"
> **When** an operator or business owner opens the inbox or a conversation
> **Then** every conversation stays readable, the reply box is unavailable and explains that replies cannot be sent until the bot works again — a business owner gets the way to the bot settings, an operator is told to ask a business owner; a reply still "sending" when the bot stops working ends up "not delivered — the bot is not working"; once a business owner fixes the bot — the same bot, since a workspace keeps one business bot once customers have written to it (bot-connection AC-05) — replying works again without reloading
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `pendingReplies(workspaceId, conversationId)` oldest position first; `lastStartedAt(conversationId)` for pacing — `modules/conversations/infra/reply-repo.ts`
- [ ] `startAttempt(...)`: take the reply's unstarted member attempt or insert a `retry` attempt, set `started_at`, commit — `modules/conversations/app/replies.ts`
- [ ] `finishAttempt(...)` with `{ attemptOutcome, replyState, failureReason?, telegramMessageId?, sentAt? }` in one transaction + `state` signal; on `sent` raise `last_reply_sent_at`/`last_activity_at` — same files
- [ ] `skipReply(...)` for pre-check failures (`outcome: skipped`, `not_delivered` + reason) — same files
- [ ] `resolveStaleInFlight(conversationId, olderThan)` → `unknown` / `not_confirmed`; `resolveDeadLetter(conversationId)` → in-flight `unknown`, never-attempted `not_delivered` / `delivery_interrupted` — same files
- [ ] Integration tests for each transition, the conversation columns after `sent`, signals, idempotent re-runs — `modules/conversations/infra/delivery.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Reply marked sent | conversation moves to the top, waiting marker clears (columns raised in the same transaction) |
| Reply ends `not_delivered` / `not_confirmed` | conversation columns unchanged — waiting marker stays (AC-10) |
| Stale in-flight attempt (> 10 s, no outcome) | `unknown` → reply `not_confirmed`, never re-sent |
| Dead-letter handler run twice | second run changes nothing (touches only unfinished attempts and `sending` replies) |
| `finishAttempt` on an attempt already finished | no-op |

## Definition of Done

- [ ] integration tests prove every outcome transition, the conversation columns on `sent`, stale in-flight resolution and the idempotent dead-letter resolution, each with its `state` signal
- [ ] a cross-workspace isolation test exists for every new repository method
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
