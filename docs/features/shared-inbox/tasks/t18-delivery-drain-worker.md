---
id: T18
title: "Build the inbox.deliver-replies drain worker with pre-checks, pacing, outcome handling, back-off jobs and the dead-letter handler"
layer: "app"
deps: ["T6", "T11", "T14", "T17"]
blocks: ["T21", "T22"]
acs: ["AC-06", "AC-09", "AC-10", "AC-11", "AC-12", "AC-13", "AC-17"]
files_hint: ["apps/api/src/modules/inbox/app/deliver.ts", "apps/api/src/modules/inbox/app/deliver.test.ts", "apps/api/src/modules/inbox/infra/jobs.ts", "apps/api/src/modules/inbox/infra/jobs.int.test.ts", "apps/api/src/app.ts", "apps/api/src/deps.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T18 — Build the inbox.deliver-replies drain worker with pre-checks, pacing, outcome handling, back-off jobs and the dead-letter handler

## Place in the sequence

- **Blocked by:** T6 — Add the inbox domain rules: reply text check, delivery outcome to reply state, retry window, per-member limit window, T11 — Build the delivery side in conversations: pending replies, in-flight mark, outcome recording, mark sent, stale in-flight and dead-letter resolution, T14 — Add sendMessage to the bots gateway as send text, classifying every answer into a typed outcome, T17 — Add the sendReply and resendReply use cases and routes with the flow-1 check order and the drain-job hook · **Blocks:** T21 — Add the API end-to-end inbox stories and extend the token-secrecy suite to inbox responses, media, socket frames and logs, T22 — Update CLAUDE.md, the architecture map and the design-system canon for the inbox module, platform/realtime, the delivery queue and the new components · **Wave:** 7 — after T6, T11, T14, T17.
- **Lane:** shares `infra/jobs.ts` with T17 and `app.ts` / `deps.ts` with T16, T19, T20 — serialized.

## Why (user story)

> **As an** End customer
> **I want** the business's answer to arrive in my chat with its bot
> **So that** I keep talking to the business where I started, without knowing who is on shift
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** every reply I send to show whether it reached Telegram, and if not, why
> **So that** no customer is left believing they were answered when they were not
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It delivers each conversation's replies one at a time, oldest first, and never sends one twice or into a broken bot.

## Inlined context

> 1. Finds this conversation's attempt still in flight (started, no outcome). If it started more than 10 s ago, the attempt becomes `unknown` and its reply `not_confirmed`, and it is never retried on its own (AC-11).
> 2. Takes the pending replies (`state = 'sending'`) oldest position first. For each one:
>    - Pre-check: the author is still an active member → otherwise `not_delivered` / `author_access_removed` (AC-09). The bot can carry replies → otherwise `not_delivered` / `bot_not_working` (AC-13). The attempt is `skipped`.
>    - Waits until at least 1 s has passed since the last start in this chat. Commits the attempt's `started_at` (in flight). […]
>    - Calls `bots` *send text* (`sendMessage`, plain text, 10 s timeout), then records the outcome and the reply state in one transaction with a `conversation.changed` / `state` signal
>
> — `contracts/events.md §Event: inbox.deliver-replies, Work, abridged` · full text: [events.md](../contracts/events.md)

> - **Options:** policy `stately`, `singletonKey = conversation_id`, `retryLimit = 3` (re-runs exist for crashes only), `expireInSeconds = 60`, queue polling interval 0.5 s (the reply-latency target, sad.md §11). A Telegram back-off is a **new** job with `startAfter = retry_after` (or the default back-off). It is never a pg-boss retry.
>
> — `contracts/events.md §Event: inbox.deliver-replies, verbatim` · full text: [events.md](../contracts/events.md)

> - **Dead-letter:** after 3 failed runs the job goes to `inbox.deliver-replies-dlq`, and an alert is raised (sad.md §7). The dead-letter handler marks: […] in-flight attempts `unknown` […]; its never-attempted `sending` replies `not_delivered` / `delivery_interrupted` […]. **Pending design confirmation** — […] api-sync-report.md OQ-2.
>
> — `contracts/events.md §Event: inbox.deliver-replies, abridged` · full text: [events.md](../contracts/events.md)

> run the worker with a local concurrency of 2 and raise the pool before raising either
>
> — `sad.md §7, Scaling thresholds, abridged` · full text: [sad.md](../sad.md)

> | Reply latency p95 — operator presses send → marked "sent" (Telegram healthy) | ≤ 2 s | request timing on the reply path, logged per reply |
> | Duplicate replies | 0 replies delivered twice without a member's explicit "send again" | delivery log reconciliation: replies with more than one accepted send and no confirmed resend |
>
> — `spec.md §6, NFR table, verbatim` · full text: [spec.md](../spec.md)

> delivery logs carry workspace id, conversation id, reply id and attempt id — never reply text, message text, the token or a Telegram file URL
>
> — `sad.md §7, Tracing, abridged` · full text: [sad.md](../sad.md)

> **Cross-module:** call the other module's **app layer** (passed in via the composition root). Never query another module's tables. Async work → pg-boss queue `<module>.<job>`.
>
> — `CLAUDE.md §Rules, Cross-module, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (state writes through `conversations` delivery-side calls from T11).

## API contract

Internal — no API surface. Queue `inbox.deliver-replies` `{ workspace_id, conversation_id }` (zod `DeliverRepliesJob`), dead letter `inbox.deliver-replies-dlq` (`events.md`).

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

### AC-17 — happy path

> **Given** an end customer who wrote to the bot of "Acme Flowers" and an operator who replied in their conversation
> **When** the reply is sent
> **Then** the customer receives the text as a message from the business's bot in their chat with it, with its line breaks, without any operator name or mark of tg-inbox; when the customer answers, the message continues the same conversation
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `deliverConversation({ workspaceId, conversationId })`: stale in-flight check → loop pending replies: author active (`workspaces.activeMembersAmong`) and `bots.canCarryReplies` pre-checks → pace ≥ 1 s since `lastStartedAt` → `startAttempt` → `bots.sendText` → `decideOutcome` (T6) → `finishAttempt`; on `not_accepted` inside the window enqueue a delayed job (`startAfter`) and stop — `modules/inbox/app/deliver.ts`
- [ ] Worker registration: queue options above, `DeliverRepliesJob` zod payload, concurrency 2, polling 0.5 s; dead-letter queue handler calling `resolveDeadLetter` and logging an alert — `modules/inbox/infra/jobs.ts`
- [ ] Register the workers in `buildApp()` beside the bots workers; stop them in `destroy()` — `apps/api/src/app.ts`, `deps.ts`
- [ ] Unit tests with fakes for every branch; integration tests with pg-boss + fake Bot API: happy path within 2 s, 429 then success keeps order while a second conversation delivers, hang past 10 s → `not_confirmed` and no second `sendMessage`, a killed job leaving `in flight` → re-run resolves `not_confirmed`, deactivated author, broken bot, 5-minute expiry, dead-letter — `modules/inbox/app/deliver.test.ts`, `infra/jobs.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Two replies of one conversation, first gets 429 | second waits; neither is reordered (AC-12) |
| A second conversation while the first backs off | delivers without waiting |
| Author deactivated before the attempt | `not_delivered` / `author_access_removed`, attempt `skipped`, no call |
| Bot turns `needs_token` mid-queue | remaining replies `not_delivered` / `bot_not_working` |
| Process dies after `started_at` | re-run marks the attempt `unknown`, reply `not_confirmed`, never re-sent |
| Duplicate job for one conversation | absorbed by `singletonKey` |
| Drain with nothing pending | no-op |

## Definition of Done

- [ ] unit tests cover every branch; integration tests prove order per conversation, isolation between conversations, at-most-once on timeout and crash, pre-checks, the 5-minute window and the dead-letter handler
- [ ] seeded latency test: p95 send → `sent` ≤ 2 s with a healthy fake
- [ ] the duplicate reconciliation query over `reply_attempts` returns 0 after the suite
- [ ] delivery logs carry ids only
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
