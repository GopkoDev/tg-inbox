---
id: T9
title: "Reopen a closed conversation in settle() when a reply ends not delivered or not confirmed"
layer: "app"
deps: ["T7"]
blocks: ["T15"]
acs: ["AC-08", "AC-09"]
files_hint: ["apps/api/src/modules/conversations/app/replies.ts", "apps/api/src/modules/conversations/app/replies.test.ts", "apps/api/src/modules/conversations/app/delivery.test.ts", "apps/api/src/modules/conversations/infra/delivery.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T9 — Reopen a closed conversation in settle() when a reply ends not delivered or not confirmed

## Place in the sequence

- **Blocked by:** T7 — Add the changeAssignee and changeStatus use cases in conversations: version guard, close reasons against the snapshot, the per-member change limit, the write, the activity entry and its signal · **Blocks:** T15 — Add the API end-to-end assignment stories, the integrity checks, and the secrecy and log assertions for the new responses and frames · **Wave:** 4 — after T7.
- **Lane:** own lane (`conversations/app/replies.ts`); reuses T7's `recordChange` read-only.

## Why (user story)

> **As an** End customer
> **I want** my new message to a business to reach the team even if they had closed our conversation
> **So that** I get an answer whenever I write again
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It makes a reply that failed after a close bring the conversation back so the team can try again.

## Inlined context

> Every reply that becomes "not delivered" or "not confirmed" goes through `settle()` in `conversations/app/replies.ts`. That covers `finishAttempt`, `skipReply`, the stale in-flight resolution `resolveStaleInFlight` and the dead-letter resolution. `settle()` is therefore the single reopen point for failed replies: in a closed conversation it reopens the same way, with the activity entry "reopened — a reply was not delivered".
>
> — `sad.md §4, choice 4 Reply outcomes, verbatim` · full text: [sad.md](../sad.md)

> The drain's idempotency step reads the reply's current state, so a reply that already ended never settles twice. A reply that is accepted leaves the conversation closed. Every failed outcome passes `settle()`: a permanent refusal, a failed pre-check, "not accepted" past 5 minutes, an unknown outcome, a stale in-flight attempt or a dead-lettered job. `settle()` sets the reply state and then locks the conversation row.
>
> — `sad.md §6, Flow 10 prose, abridged` · full text: [sad.md](../sad.md)

> **Reply outcome** (`settle()`): the `drain:` advisory lock and the reply / attempt rows, then the conversation row.
>
> — `sad.md §8, Concurrency, verbatim` · full text: [sad.md](../sad.md)

> Cause values: […] `reply_not_delivered` covers both "not delivered" and "not confirmed" outcomes, as AC-08's single line does.
>
> — `data-model.md §Assumptions, 6, abridged` · full text: [data-model.md](../data-model.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Table | Change |
|---|---|
| `conversations` | `status → 'open'`, `state_version + 1` when closed (assignee kept) |
| `conversation_activities` | insert `reopened` / `reply_not_delivered`, no actor |

— `data-model.md §Entities, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no new operation. The drain `inbox.deliver-replies` and its DLQ keep their contract; a reopen adds a `created`/`activity` frame next to the `state`/`reply` frame — `contracts/events.md, Channel pg-boss, abridged`.

## Acceptance criteria

### AC-08 — cross-context

> **Given** a closed conversation of "Acme Flowers" holding a reply that is still sending (the conversation was closed right after the reply was sent)
> **When** that reply ends "not delivered" or "not confirmed"
> **Then** the conversation opens again and returns to the open lenses for the whole team without reloading, with its assignee, and the thread records "reopened — a reply was not delivered" with the time, so the team sees it and can try again; closing a conversation whose latest reply is already "not delivered" or "not confirmed" asks first (AC-06) — the "waiting for a reply" marker itself keeps its meaning (the customer wrote after the last reply marked sent)
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — happy path

> **Given** a conversation of "Acme Flowers" that has been assigned, reassigned, unassigned, closed and reopened
> **When** any member opens its thread
> **Then** each change appears in the thread at the time it happened (its position time), among the messages and replies, as a short line naming the member who made it (or "the customer wrote" / "a reply was not delivered" / "the assignee was deactivated" for automatic changes) and the time; these lines are never sent to the end customer, do not count as unread, and appear live in a thread open in another member's tab
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] In `settle()`, for `not_delivered` / `not_confirmed`: after the reply write, lock the conversation row (T6) and, when closed, `recordChange(tx, reopen, cause 'reply_not_delivered')` (T7) — `conversations/app/replies.ts`
- [ ] Unit tests per entry point (`finishAttempt`, `skipReply`, `resolveStaleInFlight`, dead-letter) with fakes — `replies.test.ts`, `delivery.test.ts`
- [ ] Integration tests: closed conversation + each failed outcome → open + one entry + signal; accepted reply → stays closed; second settle of a final reply → no second reopen — `conversations/infra/delivery.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Reply accepted (`sent`) in a closed conversation | stays closed |
| Failed reply in an open conversation | no activity entry, no version change |
| Dead-letter job for a reply already `not_confirmed` | idempotent — no second reopen |
| Conversation closed by a member while the reply is `sending` | the later failure reopens it (AC-08) |

## Definition of Done

- [ ] Unit and integration tests prove that finishAttempt, skipReply, resolveStaleInFlight and the dead-letter resolution each reopen a closed conversation once with a reopened/reply_not_delivered entry and its signal, that an accepted reply leaves it closed, and that a reply already final never settles or reopens twice.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
