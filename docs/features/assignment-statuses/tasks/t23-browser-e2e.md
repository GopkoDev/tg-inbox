---
id: T23
title: "Add browser end-to-end assignment flows against the real API and the fake Bot API"
layer: "tests"
deps: ["T15", "T17", "T20", "T21", "T22"]
blocks: []
acs: ["AC-01", "AC-02", "AC-03", "AC-06", "AC-07"]
files_hint: ["apps/web/e2e/assignment.spec.ts", "apps/web/e2e/support/world.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T23 — Add browser end-to-end assignment flows against the real API and the fake Bot API

## Place in the sequence

- **Blocked by:** T15 — Add the API end-to-end assignment stories, the integrity checks, and the secrecy and log assertions for the new responses and frames, T17 — Build the SCR-01 lenses: status tabs and assignee select, the assignee line and closed mark on rows, per-lens empty states and live join and leave, T20 — Build SCR-11, the confirm-over-a-recent-change dialog: current state, who or what changed it and when, go ahead or leave it, asks again, T21 — Build SCR-12, the close confirmation: every close reason, close anyway with the refusal's version and snapshot, asks again, T22 — Add the unassign sentence to the deactivate confirmation (SCR-14) and keep the lenses in the sign-in return address (SCR-09) · **Blocks:** — · **Wave:** 9 — after T15, T17, T20, T21, T22.
- **Lane:** shares `apps/web/e2e/support/world.ts` with nothing else in this epic.

## Why (user story)

> **As an** Operator
> **I want** the list to show each conversation's assignee and let me switch between all, mine and unassigned conversations
> **So that** I pick up only what nobody handles or what is mine
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to close a conversation when the customer needs nothing more, and see closed ones when I look for them
> **So that** the working list holds only what still needs work
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As an** End customer
> **I want** my new message to a business to reach the team even if they had closed our conversation
> **So that** I get an answer whenever I write again
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It proves the lenses, the assignment, the two confirmations and the customer reopen through a real browser.

## Inlined context

> Integration: `*.int.test.ts` — real Postgres via Testcontainers (`apps/api/src/test/postgres.ts` applies migrations), HTTP via `app.inject()`. Needs Docker.
>
> — `CLAUDE.md §Tests, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> - **Live update p95 — change made → shown in another member's open inbox:** ≤ 3 s (as shared-inbox §6)
>
> — `spec.md §6, NFR table, abridged` · full text: [spec.md](../spec.md)

> server-side timing from commit to socket write, logged per signal, and a CI integration test that asserts the activity signal reaches a connected socket of a teammate and that the row moves lens in the web store test
>
> — `sad.md §10, QG-3 How verify, abridged` · full text: [sad.md](../sad.md)

> SCR-01 lens states, SCR-02 actions and activity lines, SCR-10 chooser, SCR-11 confirm over a recent change, SCR-12 confirm close.
>
> — `screens.md §Screens, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Drives the panel against the real API (`listConversations`, the four change routes, `listActiveMembers`, `openLiveSocket`) and the fake Bot API webhook for a customer message.

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" whose workspace has 30 conversations — some assigned to them, some to a teammate, some unassigned, some closed
> **When** they open the inbox
> **Then** the list shows the open conversations of every assignee, newest activity first as before, each row showing its assignee's name (or "unassigned") and keeping its last message and time — an assignee or status change never becomes a row's preview or time; choosing "mine" shows only open conversations assigned to them, "unassigned" only open conversations with no assignee, and "closed" the closed conversations in the chosen assignee lens, also newest activity first; while searching, the status lens is set aside and matches of both statuses are shown within the chosen assignee lens, each closed row marked "closed"; when a lens holds nothing the inbox says so; the chosen lenses are part of the page's address, so a reload, the back button or a saved link opens the same lenses, and switching to another workspace starts again at open · all; a business owner sees and does the same
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — happy path

> **Given** an operator with a conversation of "Acme Flowers" open in its thread (assignee, status and their changes are made from the thread; list rows only show them)
> **When** they assign it to themselves or to a teammate who is an active member of "Acme Flowers", reassign it from one member to another, or unassign it
> **Then** the conversation shows the new assignee in its header and in the list for the whole team without reloading (within the live-update target of §6), it moves between the "mine" and "unassigned" lenses accordingly, the thread records one line — "<member> assigned this to <assignee>", "<member> reassigned this from <previous> to <assignee>" or "<member> unassigned this" — with the time, and the conversation keeps its place in the activity order (assigning does not count as activity); a closed conversation can be assigned or unassigned too and stays closed; a teammate reading the thread while it drops out of their current lens keeps it open with the new assignee shown, and only its row leaves their list; choosing the assignee it already has changes nothing and records nothing; assignment, closing and reopening work in every state of the bot
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-03 — domain invariant

> **Given** an operator of "Acme Flowers" looking at a conversation with the assignee and status they last saw
> **When** its assignee or status has changed since then — by a teammate or automatically (reopened by the customer, unassigned by a deactivation) — and the operator now assigns, reassigns, unassigns, closes or reopens it; including when two members act at the same moment, where one change is recorded first and the other member counts as having seen the old state
> **Then** nothing changes yet: the inbox shows the current assignee and status, who changed them and how long ago, and asks whether to go ahead (take it over, close anyway…) or leave it; the change happens only if the operator confirms; when the conversation is already in the state the operator asked for, nothing changes, no line is recorded and the inbox simply shows it — a conversation has at most one assignee, and two members never take or close one conversation by accident
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — domain invariant

> **Given** an operator of "Acme Flowers" about to close a conversation
> **When** its customer is still waiting for a reply, or a customer message arrived after the operator's own arrival watermark (they have not read it — a thread in a background tab marks nothing read)
> **Then** before closing the inbox shows why — the customer is waiting for a reply, the newest message the operator has not read, or the conversation's latest reply was "not delivered" / "not confirmed" — and asks whether to close anyway or keep it open; the conversation is closed only if the operator confirms; the condition is checked again at the moment the close is recorded, so a customer message recorded between the question and the close asks again — a customer is never put out of sight by a close made over a message the closer had not read; a customer message recorded after the close reopens it (AC-07)
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-07 — cross-context

> **Given** a closed conversation of "Acme Flowers" assigned to an operator
> **When** its end customer sends a new message to the business bot
> **Then** the conversation opens again and returns to the open lenses for the whole team without reloading, with the same assignee (an assignee is always an active member — AC-10), the thread records "reopened — the customer wrote" with the time, and the message counts as unread and as waiting for a reply exactly as for an open conversation; this holds for a customer message that arrives late and takes an earlier place in the history (a late redelivery) — it reopens by its arrival, the message keeps its earlier place, and the "reopened" line sits at the time it arrived; an edit of an earlier message does not reopen
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Flow 1: open `?status=closed&assignee=mine`, reload, back → same lenses; switch workspace → open · all (AC-01) — `apps/web/e2e/assignment.spec.ts`
- [ ] Flow 2: two browser contexts; A assigns to themself → B's list and open thread update live; B on «Unassigned» loses the row, keeps the thread (AC-02)
- [ ] Flow 3: A and B both look; B reassigns; A assigns → SCR-11 → Leave it / Go ahead (AC-03)
- [ ] Flow 4: close over a waiting customer → SCR-12 → Close anyway → row under «Closed» (AC-06)
- [ ] Flow 5: customer writes through the fake webhook → row back in open with the same assignee and «reopened — the customer wrote» (AC-07); helpers in `apps/web/e2e/support/world.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Socket reconnect during a flow | resync shows the current state |
| Slow CI | assertions wait up to the 3 s live target, not fixed sleeps |

## Definition of Done

- [ ] The five browser flows pass locally and in CI with pnpm test:e2e.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
