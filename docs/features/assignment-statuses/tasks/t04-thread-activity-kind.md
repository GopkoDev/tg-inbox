---
id: T4
title: "Extend the thread domain with the activity kind: merge order message < reply < activity and a three-kind cursor that still decodes old cursors"
layer: "domain"
deps: []
blocks: ["T11"]
acs: ["AC-09"]
files_hint: ["apps/api/src/modules/conversations/domain/thread.ts", "apps/api/src/modules/conversations/domain/thread.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
status: "todo"
---

# T4 — Extend the thread domain with the activity kind: merge order message < reply < activity and a three-kind cursor that still decodes old cursors

## Place in the sequence

- **Blocked by:** — · **Blocks:** T11 — Teach the conversations read side lenses, per-row state and version, the summary's close snapshot, the thread's activity half and the single activity item · **Wave:** 1 — no upstream task.
- **Lane:** own lane (`conversations/domain/thread.ts`).

## Why (user story)

> **As an** Operator
> **I want** the thread to show who assigned, unassigned, closed or reopened the conversation and when
> **So that** I understand its history before I act
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It lets the thread place each change line among messages and replies at the time it happened.

## Inlined context

> **Chosen:** Option 1. It follows the existing per-kind table plus in-memory merge pattern exactly, keeps replies' invariants intact, and gives the change limit a natural log to count.
>
> — `adr/0006 §Decision outcome, verbatim` · full text: [ADR-0006](../adr/0006-store-activity-entries-in-their-own-table-and-merge-them-into-the-thread-by-position-time.md)

> The thread page adds a keyset half over activity entries and merges three halves with the existing cursor, extended with the kind `activity`; at equal positions the order is message < reply < activity.
>
> — `sad.md §4, Supporting choices — activity entries, abridged` · full text: [sad.md](../sad.md)

> Thread: messages by Telegram `sent_at` and replies by `position_at`, merged in memory with the cursor `(positionAt, kind, id)` (`conversations/domain/thread.ts`)
>
> — `sad.md §2, Constraints, abridged` · full text: [sad.md](../sad.md)

> - **Cursor:** the thread cursor's `kind` gains `activity`; a cursor encoded before the deploy (kinds `message` / `reply`) must still decode.
>
> — `contracts/api-sync-report.md §Notes for tasks / implement, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface. The cursor stays the opaque shared-inbox `Cursor` string.

## Acceptance criteria

### AC-09 — happy path

> **Given** a conversation of "Acme Flowers" that has been assigned, reassigned, unassigned, closed and reopened
> **When** any member opens its thread
> **Then** each change appears in the thread at the time it happened (its position time), among the messages and replies, as a short line naming the member who made it (or "the customer wrote" / "a reply was not delivered" / "the assignee was deactivated" for automatic changes) and the time; these lines are never sent to the end customer, do not count as unread, and appear live in a thread open in another member's tab
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Add `activity` to the thread item kind and its rank (message 0 < reply 1 < activity 2) — `conversations/domain/thread.ts`
- [ ] Merge three sorted halves by `(positionAt, kindRank, id)`; page before / after a cursor across the three — `thread.ts`
- [ ] Cursor encode / decode accepts `activity`; an old cursor (kind `message` / `reply`) decodes unchanged; a malformed kind is rejected as today — `thread.ts`
- [ ] Unit tests: equal positions of all three kinds, page boundary on an activity item, old-cursor fixture string — `thread.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Message, reply and activity at the same millisecond | message, then reply, then activity |
| Cursor issued before the deploy | decodes; the next page includes activity items after it |
| Cursor with an unknown kind | rejected (`VALIDATION_ERROR` at the route, as today) |

## Definition of Done

- [ ] Thread domain unit tests prove the three-way merge with ties message < reply < activity, cursor round-trips for the activity kind, and that a cursor encoded with kinds message / reply before the deploy still decodes.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
