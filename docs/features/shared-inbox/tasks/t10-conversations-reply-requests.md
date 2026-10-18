---
id: T10
title: "Build reply creation and re-queueing in conversations: idempotent client key, per-member limit under an advisory lock, teammate check, attempt row and drain job in one transaction"
layer: "infra"
deps: ["T5", "T8"]
blocks: ["T11", "T17"]
acs: ["AC-11", "AC-12", "AC-12b", "AC-16"]
files_hint: ["apps/api/src/modules/conversations/app/ports.ts", "apps/api/src/modules/conversations/app/fakes.ts", "apps/api/src/modules/conversations/app/replies.ts", "apps/api/src/modules/conversations/infra/reply-repo.ts", "apps/api/src/modules/conversations/infra/reply-repo.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T10 — Build reply creation and re-queueing in conversations: idempotent client key, per-member limit under an advisory lock, teammate check, attempt row and drain job in one transaction

## Place in the sequence

- **Blocked by:** T5 — Add the conversations domain rules: reply states and transitions, thread position order and cursors, the arrival-watermark rule, T8 — Maintain the conversation list columns on capture and edit, publish conversation.changed, and promote migration 10 · **Blocks:** T11 — Build the delivery side in conversations: pending replies, in-flight mark, outcome recording, mark sent, stale in-flight and dead-letter resolution, T17 — Add the sendReply and resendReply use cases and routes with the flow-1 check order and the drain-job hook · **Wave:** 4 — after T5, T8.
- **Lane:** serialized lane with T8, T9, T11 (shared `ports.ts` / `fakes.ts`; `reply-repo.ts` with T11).

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

> **As an** Operator
> **I want** new customer messages and my teammates' replies to appear live, and to be warned before I answer a customer a teammate has just answered
> **So that** our team does not miss messages or give a customer two different answers
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It is the request side of at-most-once: a double press finds the same reply, the 31st send is refused, and a teammate's newer reply stops an accidental second answer.

## Inlined context

> **At-most-once reply delivery through a per-conversation delivery queue with an in-flight mark** — sending stores the reply as "sending" under a client-generated reply key (a double press finds the same reply), together with its member-initiated attempt row, and enqueues a per-conversation drain job — all in one transaction, so a committed reply always has a job
>
> — `sad.md §4, choice 3, abridged` · full text: [sad.md](../sad.md)

> every member-initiated send (new reply, "Try again", "send again"; automatic retries excluded) inserts its attempt row in the request's own transaction […]; a send first counts that member's initiated attempts in this workspace over the last 60 s under a transaction-level advisory lock on (workspace, member), so the 31st is refused even under concurrent requests, and the refusal says when the oldest of the 30 leaves the window.
>
> — `sad.md §4, Per-member reply limit, abridged` · full text: [sad.md](../sad.md)

> a send carries the newest teammate reply the composer had seen when typing began; if another member's reply was added to the conversation after it, the API refuses with a "teammate replied" conflict naming who and when, and the client asks; "send anyway" repeats the send with an explicit confirmation flag.
>
> — `sad.md §4, Stateless teammate-collision check, abridged` · full text: [sad.md](../sad.md)

> sent through pg-boss inside the reply's own transaction (pg-boss `send` with the caller's database executor), so a committed reply always has a job
>
> — `sad.md §8, Jobs, abridged` · full text: [sad.md](../sad.md)

> 1. The reply is not `not_delivered` or `not_confirmed` (it is already `sending` again, or `sent`) → `409 REPLY_NOT_RESENDABLE`. […]
> 2. 30 member-initiated sends in the last 60 s → `429 REPLY_LIMIT_REACHED` (AC-12b). […]
> 3. `not_confirmed` without `confirm_duplicate_risk: true` → `409 DUPLICATE_RISK_CONFIRMATION_REQUIRED` (AC-11).
>
> — `contracts/openapi.yaml, resendReply, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

> **Cross-module:** call the other module's **app layer** (passed in via the composition root). Never query another module's tables. Async work → pg-boss queue `<module>.<job>`.
>
> — `CLAUDE.md §Rules, Cross-module, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

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
| `replies` | `client_key`, `body`, `state = 'sending'`, `position_at`, `author_account_id`, `created_at` | insert (`ON CONFLICT (conversation_id, client_key) DO NOTHING`, then read back); re-queue sets `state = 'sending'`, `failure_reason = NULL`, new `position_at` |
| `reply_attempts` | `kind` (`send` / `try_again` / `send_again`), `initiated_by_account_id`, `created_at` | insert one member-initiated attempt per accepted request |

Indexes used: `replies_conversation_id_client_key_key`, `replies_conversation_id_position_at_idx` (teammate check), `reply_attempts_workspace_id_initiator_created_at_idx` (limit count).

— `data-model.md §replies + §reply_attempts, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface; returns typed results the `inbox` routes (T17) map to `201`/`200`, `409 TEAMMATE_REPLIED`, `409 REPLY_NOT_RESENDABLE`, `409 DUPLICATE_RISK_CONFIRMATION_REQUIRED`, `429 REPLY_LIMIT_REACHED` (`retry_at`).

## Acceptance criteria

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

### AC-16 — domain invariant

> **Given** an operator of "Acme Flowers" writing a reply in a conversation
> **When** a teammate's reply to the same customer appears in the thread after the operator started typing, and the operator sends
> **Then** before anything is sent the inbox shows that the teammate replied and how long ago, and asks whether to send anyway or keep editing; the reply is sent only if the operator confirms — two members do not answer one customer by accident
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `createReply({ workspaceId, conversationId, authorId, clientKey, body, lastSeenReplyId, confirmTeammate, limit, windowMs, enqueueDrain })` in one transaction: client-key replay → existing; `pg_advisory_xact_lock(workspace, member)` + count → limited(retryAt); teammate reply after `lastSeenReplyId` (unknown id = null) → teammate(reply); else insert reply + `send` attempt, `enqueueDrain(trx)`, publish `conversation.changed { created, reply }` — `modules/conversations/app/replies.ts`, `infra/reply-repo.ts`
- [ ] `requeueReply({ …, replyId, memberId, confirmDuplicate, enqueueDrain })`: state check → limit → confirmation → set `sending` at new `position_at` + `try_again`/`send_again` attempt + job + `state` signal — same files
- [ ] Take `enqueueDrain(trx, workspaceId, conversationId)` as a parameter supplied by `inbox` (no import of `inbox`) — `modules/conversations/app/ports.ts`
- [ ] Integration tests incl. 31 concurrent creates by one member → exactly 30 stored, double submit → one reply, isolation per method — `modules/conversations/infra/reply-repo.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Same `client_key` again (double press, lost connection) | the stored reply returned as it is now, nothing new stored or enqueued (AC-11) |
| Same text, new `client_key` | a second reply (deliberate) |
| 31 concurrent sends by one member | 30 accepted, 1 limited — the lock serialises the count |
| Automatic `retry` attempts in the window | not counted |
| Same member in another workspace | own limit (per workspace) |
| `confirmTeammate: true` | skips only the teammate check — client key and limit still apply |
| Re-queue of a `sending` / `sent` reply, or two members at once | not resendable, with the current reply |

## Definition of Done

- [ ] integration tests prove idempotent create, the 30/60 s limit under 31 concurrent requests with `retry_at`, the teammate check, re-queue rules, and that reply + attempt + job commit together
- [ ] a cross-workspace isolation test exists for every new repository method
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
