---
id: T3
title: "Add the conversations domain change rules: no-op, stale and close-reason decision, snapshot equality, activity kinds and causes, position rule and the change-limit window"
layer: "domain"
deps: []
blocks: ["T6"]
acs: ["AC-03", "AC-05", "AC-06", "AC-12"]
files_hint: ["apps/api/src/modules/conversations/domain/state.ts", "apps/api/src/modules/conversations/domain/state.test.ts", "apps/api/src/modules/conversations/domain/activity.ts", "apps/api/src/modules/conversations/domain/activity.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T3 — Add the conversations domain change rules: no-op, stale and close-reason decision, snapshot equality, activity kinds and causes, position rule and the change-limit window

## Place in the sequence

- **Blocked by:** — · **Blocks:** T6 — Build the conversations persistence for state and activity: locked row read, versioned state update, activity repository and the close-reason reads · **Wave:** 1 — no upstream task.
- **Lane:** own lane (new files in `conversations/domain`).

## Why (user story)

> **As an** Operator
> **I want** to assign a conversation to myself or a teammate, or unassign it
> **So that** the team knows who answers this customer
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to close a conversation when the customer needs nothing more, and see closed ones when I look for them
> **So that** the working list holds only what still needs work
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It is the pure decision every change path calls under the row lock: what is a no-op, what must be asked, and which one activity entry a recorded change writes.

## Inlined context

> Every change of assignee or status, by a member or automatic, raises an integer version on the conversation in the same row update. […]
> - If the conversation is already in the requested state, nothing happens and nothing is recorded.
> - If the version differs, the request is refused with `CONVERSATION_STATE_CHANGED`. The refusal carries the current assignee, the status, the latest activity entry (who or what cause, when) and the current version. "Go ahead" repeats the request with that version, so a third change in between asks again.
>
> — `sad.md §4, choice 2, abridged` · full text: [sad.md](../sad.md)

> - the customer is waiting for a reply;
> - this member has an unread customer message, i.e. one that arrived after the later of their arrival watermark and their active-since;
> - a customer message was recorded after the snapshot the screen shows (the counter grew);
> - the latest reply is "not delivered" or "not confirmed".
>
> The close is recorded if the version matches and either no reason holds, or `confirm` is set and the current snapshot equals the one sent. Otherwise it is refused with `CLOSE_NEEDS_CONFIRMATION`. The refusal carries every reason, the stale change if there is one, and the current snapshot and version; "close anyway" resends those with `confirm`.
>
> — `sad.md §4, choice 3 The rule, verbatim` · full text: [sad.md](../sad.md)

> - **The no-op check runs before the version check (flows 5, 6, 8).** AC-03 asks that a request matching the current state change nothing even if the state moved meanwhile.
> - **A member reopen does not evaluate close reasons (flow 8)**, and a member close that is already closed is a no-op even with `confirm`.
>
> — `sad.md §6, Flagged by sequences, abridged` · full text: [sad.md](../sad.md)

> The position time is when the change happened: the server clock read **after** the conversation row lock is taken, and never earlier than the conversation's latest activity entry. […] Activity entries never count as unread, never move last activity and are never sent to Telegram.
>
> — `sad.md §4, Supporting choices — activity entries, abridged` · full text: [sad.md](../sad.md)

> The limit is 60 recorded changes per rolling 60 s per member per workspace. […] The lock is taken and the count run after the conversation row lock and after the no-op, stale and close checks, just before the write, so refused, declined and already-in-place requests never count, and a reassignment is one entry. Automatic entries have no actor, so they are never counted and never refused. The refusal is `TooManyRequestsError` with the code `CHANGE_LIMIT_REACHED` and the time the oldest counted change leaves the window.
>
> — `sad.md §4, Per-member change limit, abridged` · full text: [sad.md](../sad.md)

> **Assignee pair `CHECK`:** `assigned` → (null, set); `reassigned` → (set, set, different); `unassigned` → (set, null); `closed` / `reopened` → (null, null).
> Cause values: `member`, `customer_wrote`, `reply_not_delivered`, `member_deactivated`. `reply_not_delivered` covers both "not delivered" and "not confirmed" outcomes, as AC-08's single line does.
>
> — `data-model.md §conversation_activities + Assumption 6, abridged` · full text: [data-model.md](../data-model.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface. Reason names are the contract's `CloseReason` values (`state_changed`, `customer_waiting`, `unread_customer_message`, `new_customer_message`, `reply_not_delivered`, `reply_not_confirmed`) — `contracts/openapi.yaml, CloseReason, verbatim`.

## Acceptance criteria

### AC-03 — domain invariant

> **Given** an operator of "Acme Flowers" looking at a conversation with the assignee and status they last saw
> **When** its assignee or status has changed since then — by a teammate or automatically (reopened by the customer, unassigned by a deactivation) — and the operator now assigns, reassigns, unassigns, closes or reopens it; including when two members act at the same moment, where one change is recorded first and the other member counts as having seen the old state
> **Then** nothing changes yet: the inbox shows the current assignee and status, who changed them and how long ago, and asks whether to go ahead (take it over, close anyway…) or leave it; the change happens only if the operator confirms; when the conversation is already in the state the operator asked for, nothing changes, no line is recorded and the inbox simply shows it — a conversation has at most one assignee, and two members never take or close one conversation by accident
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

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

- [ ] Conversation state type (`status`, `assigneeAccountId`, `stateVersion`, `customerMessageSeq`) and the request union (assign X / unassign / close / reopen) — `conversations/domain/state.ts`
- [ ] `decideChange(current, request, ctx)` → `unchanged` | `stale` | `needsConfirmation(reasons)` | `allowed(kind, previous, new)`; order: no-op → (close: reasons incl. `state_changed`, confirm + snapshot equality) / (other: version) — `state.ts`
- [ ] `closeReasons(...)` from pure inputs (waiting flag, newest unread arrival vs `max(watermark, activeSince)`, counter vs snapshot, latest reply state) and `sameSnapshot(a, b)` field by field — `state.ts`
- [ ] Activity kinds, causes, the kind↔cause / actor↔cause / assignee-pair rules, `activityKindFor(previous, next)` (assigned / reassigned / unassigned) — `conversations/domain/activity.ts`
- [ ] `positionAt(now, latestPositionAt)` = the later of the two; `CHANGE_LIMIT = 60`, `CHANGE_WINDOW_MS = 60_000`, `changeRetryAt(oldestCreatedAt)` — `activity.ts`
- [ ] Unit tests for every row of the edge table — `state.test.ts`, `activity.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Assign to the current assignee with a stale version | `unchanged` (no-op checked first) |
| Close an already-closed conversation with `confirm` | `unchanged` |
| Close with stale version and no other reason | `needsConfirmation([state_changed])`, never `stale` |
| Confirm with a snapshot whose `latest_reply.state` differs | `needsConfirmation` again with the current reasons |
| Reopen with reasons that would block a close | `allowed` — a member reopen evaluates no close reasons |
| Unread arrival equal to `max(watermark, activeSince)` | not unread (strictly after) |
| Clock earlier than the latest entry | position = latest entry's position |

## Definition of Done

- [ ] Domain unit tests cover every branch of the change decision (no-op before version, stale, close reasons with and without confirm and snapshot equality, member reopen without reasons, already-closed close with confirm), the activity kind / cause / assignee-pair rules, the position rule and the 60/60 s limit with its retry_at.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
