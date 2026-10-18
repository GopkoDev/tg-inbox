---
id: T14
title: "Add the close and reopen routes with the close snapshot and confirm, and prove the change limit across all four change routes"
layer: "ports"
deps: ["T13"]
blocks: ["T15", "T24"]
acs: ["AC-05", "AC-06", "AC-12"]
files_hint: ["apps/api/src/modules/inbox/app/change-state.ts", "apps/api/src/modules/inbox/app/change-state.test.ts", "apps/api/src/modules/inbox/http/routes.ts", "apps/api/src/modules/inbox/http/changes.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T14 — Add the close and reopen routes with the close snapshot and confirm, and prove the change limit across all four change routes

## Place in the sequence

- **Blocked by:** T13 — Add the assign and unassign routes: one transaction that share-locks the memberships, then changes the conversation, with every refusal of the contract · **Blocks:** T15 — Add the API end-to-end assignment stories, the integrity checks, and the secrecy and log assertions for the new responses and frames, T24 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the conversation state, the activity table, the deactivation port and the new components · **Wave:** 6 — after T13.
- **Lane:** shares `change-state.ts`, `routes.ts` and `changes.int.test.ts` with T13 — serialized after it.

## Why (user story)

> **As an** Operator
> **I want** to close a conversation when the customer needs nothing more, and see closed ones when I look for them
> **So that** the working list holds only what still needs work
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It lets a member close a finished conversation — asked first whenever a customer might still need an answer — and reopen it.

## Inlined context

> The close carries the version and the close snapshot on screen. Under the conversation row lock the service evaluates the reasons. […] With no reason, the close is recorded at once (AC-05). With any reason, the single confirmation (SCR-12) names all of them. "Keep it open" changes nothing. "Close anyway" resends with the refusal's snapshot and version and `confirm`. The reasons are evaluated again at record time, so a customer message or failed reply recorded in between asks again. The change limit applies just before the write (AC-12).
>
> — `sad.md §6, Flow 7 prose, abridged` · full text: [sad.md](../sad.md)

> Any member can reopen a closed conversation from its thread. If it is already open again, nothing is recorded and the thread shows it. If its state changed since the screen showed it, the flow 6 confirmation applies (AC-03). Past the change limit it is refused (AC-12). Otherwise it opens with the same assignee, records "<member> reopened this", and returns to the open lenses for the team (AC-05).
>
> — `sad.md §6, Flow 8 prose, verbatim` · full text: [sad.md](../sad.md)

> - **N3. A stale close is never `CONVERSATION_STATE_CHANGED`.** The stale version is the `state_changed` reason of `CLOSE_NEEDS_CONFIRMATION` (ADR-0002 *Neutral*, ux-flows: one dialog, SCR-12).
>
> — `contracts/api-sync-report.md §B, N3, abridged` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> integration test "the 61st change within a minute is refused", including 61 concurrent requests, and automatic changes not counted
>
> — `sad.md §10, QG-2 How verify, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (writes go through T7's `changeStatus`).

## API contract

- `POST …/conversations/{conversationId}/close` (`closeConversation`) body `CloseRequest { expected_state_version, expected_close_snapshot, confirm_close_reasons? }` → `200 ConversationStateChange` · `409 CLOSE_NEEDS_CONFIRMATION { reasons[≥1], stale_change, newest_unread_message, conversation }` · `429 CHANGE_LIMIT_REACHED` · `401` · `403` · `404`.
- `POST …/conversations/{conversationId}/reopen` (`reopenConversation`) body `StateChangeRequest` → `200` · `409 CONVERSATION_STATE_CHANGED` · `429` · `401` · `403` · `404`.
- `ChangeLimitReachedError` `{ limit: 60, window_seconds: 60, retry_at }` + `Retry-After` on all four change routes.

— `contracts/openapi.yaml, closeConversation + reopenConversation + ChangeLimitReached, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-05 — happy path

> **Given** an operator in an open conversation of "Acme Flowers" whose customer is not waiting for a reply and who has read every customer message in it (none arrived after their arrival watermark)
> **When** they close it
> **Then** the conversation leaves the open lenses for the whole team without reloading and appears under "closed", keeping its assignee; the thread records "<member> closed this" with the time; closing does not count as activity and does not change anyone's unread count; the conversation can be opened again from the thread ("reopen") by any member, which records "<member> reopened this" and returns it to the open lenses with the same assignee
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — domain invariant

> **Given** an operator of "Acme Flowers" about to close a conversation
> **When** its customer is still waiting for a reply, or a customer message arrived after the operator's own arrival watermark (they have not read it — a thread in a background tab marks nothing read)
> **Then** before closing the inbox shows why — the customer is waiting for a reply, the newest message the operator has not read, or the conversation's latest reply was "not delivered" / "not confirmed" — and asks whether to close anyway or keep it open; the conversation is closed only if the operator confirms; the condition is checked again at the moment the close is recorded, so a customer message recorded between the question and the close asks again — a customer is never put out of sight by a close made over a message the closer had not read; a customer message recorded after the close reopens it (AC-07)
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — error

> **Given** an operator of "Acme Flowers" who has assigned, unassigned, closed or reopened 60 conversations within the last 60 seconds
> **When** they try to make another such change
> **Then** nothing changes, the inbox says that changes are limited to 60 per minute per member and when they can continue; only recorded changes count (a reassignment is one change; a refused, declined or already-in-place request is none); the limit is per workspace, so changes in another workspace of the same account are not affected; automatic changes (a customer's message, a failed reply, a deactivation) never count and are never refused
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Use cases `close` / `reopen`: share-lock the caller, pass the caller's watermark context (active-since from the guard) to `conversations.changeStatus` — `inbox/app/change-state.ts`
- [ ] Routes with zod bodies, `confirm_close_reasons` default false — `inbox/http/routes.ts`
- [ ] Route tests: each close reason alone and together; close anyway; capture between refusal and confirm → asks again (counter grew); failed reply between → asks again; reopen paths; 61 concurrent mixed changes → exactly 60 recorded, the rest 429; automatic reopen during the window not counted — `inbox/http/changes.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Close with only a stale version | `409 CLOSE_NEEDS_CONFIRMATION` with `[state_changed]` and `stale_change` |
| Close anyway on a conversation closed meanwhile by a teammate | `200 unchanged` |
| `confirm_close_reasons: true` without a prior refusal but with the current snapshot | recorded (confirm is valid against the current snapshot) |
| Background tab never marked the new message read | `unread_customer_message` reason (AC-06) |
| 61st request is an `unchanged` no-op | 200, not counted, not refused |

## Definition of Done

- [ ] Route tests prove close recorded with no reason, 409 CLOSE_NEEDS_CONFIRMATION with every reason, close anyway with the refusal's snapshot, asks again after a capture or failed reply in between, reopen recorded / unchanged / stale, and the 61st change across assign, unassign, close and reopen refused with 429 and Retry-After while refused and unchanged requests are not counted.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
