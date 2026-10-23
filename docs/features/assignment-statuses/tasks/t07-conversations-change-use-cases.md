---
id: T7
title: "Add the changeAssignee and changeStatus use cases in conversations: version guard, close reasons against the snapshot, the per-member change limit, the write, the activity entry and its signal"
layer: "app"
deps: ["T2", "T6"]
blocks: ["T8", "T9", "T10", "T13"]
acs: ["AC-02", "AC-03", "AC-05", "AC-06", "AC-12"]
files_hint: ["apps/api/src/modules/conversations/app/state-changes.ts", "apps/api/src/modules/conversations/app/state-changes.test.ts", "apps/api/src/modules/conversations/app/state-changes.int.test.ts", "apps/api/src/modules/conversations/app/ports.ts", "apps/api/src/modules/conversations/app/fakes.ts", "apps/api/src/modules/conversations/infra/conversation-signals.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T7 — Add the changeAssignee and changeStatus use cases in conversations: version guard, close reasons against the snapshot, the per-member change limit, the write, the activity entry and its signal

## Place in the sequence

- **Blocked by:** T2 — Add the assignment zod contracts, the four error codes and the activity item type on the live frame and the realtime signal, T6 — Build the conversations persistence for state and activity: locked row read, versioned state update, activity repository and the close-reason reads · **Blocks:** T8 — Reopen a closed conversation on a newly captured customer message, raise the customer message counter under the row lock, and promote contract migration 05, T9 — Reopen a closed conversation in settle() when a reply ends not delivered or not confirmed, T10 — Unassign a deactivated member's conversations through the port inside the deactivation transaction, and build conversations before team in buildDeps, T13 — Add the assign and unassign routes: one transaction that share-locks the memberships, then changes the conversation, with every refusal of the contract · **Wave:** 3 — after T2, T6.
- **Lane:** shares `ports.ts` / `fakes.ts` with T6 and `state-changes.ts` with T8, T9, T10 (which reuse its `recordChange`) — serialized, T7 first.

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

It is the one place a member's change is decided and recorded, so every route, the reopen paths and the deactivation write the same way.

## Inlined context

> else version differs and the request is not a close → refused, state changed, with current state, latest activity and version
> else close with a stale version, or a close reason holds without confirm or with a snapshot unlike the one sent → refused, close needs confirmation, with every reason and the current snapshot
> else 60 recorded changes by this member in the last 60 s → refused, change limit, with the time changes resume
> else allowed → write status or assignee, raise the version, insert the activity entry; signal activity item created, inside the transaction
>
> — `sad.md §6, Critical flow 1, abridged` · full text: [sad.md](../sad.md)

> The count runs under `pg_advisory_xact_lock(hashtextextended('changes:<ws>:<account>', 0))`. The `changes:` prefix keeps it apart from the reply limit's `<ws>:<account>` key.
>
> — `sad.md §4, Per-member change limit, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. It catches every intervening change, ABA included. It costs one integer column and one comparison under the row lock the change takes anyway, and it serialises concurrent members exactly as AC-03 describes.
>
> — `adr/0002 §Decision outcome, verbatim` · full text: [ADR-0002](../adr/0002-guard-member-changes-with-a-per-conversation-state-version-the-client-echoes.md)

> The counter is raised under the row lock, so it follows commit order. The row lock that capture also takes means either the close sees the new arrival (and asks again) or the arrival comes after the close and reopens it (ADR-0004). The snapshot ties the confirmation to exactly what the dialog showed.
>
> — `adr/0003 §Decision outcome, abridged` · full text: [ADR-0003](../adr/0003-recheck-close-reasons-under-the-conversation-row-lock-against-an-acknowledged-close-snapshot.md)

> - (a) close with each reason, then close-anyway with the returned snapshot: closes;
> - (b2) a first close (no refusal yet) after a customer message the screen has not shown: refused with the new-message reason;
> - (d) two concurrent assigns with the same version: one recorded, the other `CONVERSATION_STATE_CHANGED`;
>
> — `sad.md §10, QG-1 How verify, abridged` · full text: [sad.md](../sad.md)

> `conversation.changed` with item `{ type: 'activity', id }`, change `created`, one per recorded change, published inside the writing transaction. `membership.deactivated` is unchanged.
>
> — `sad.md §8, Events, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Table · column | Change |
|---|---|
| `conversations.status`, `assignee_account_id`, `state_version` | written through T6's versioned update (`last_activity_at` untouched) |
| `conversation_activities` | one row per recorded change: actor = caller, `cause = member`, `position_at` = `max(now after lock, latest)`, `created_at` = now |

— `data-model.md §Entities, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — the use cases raise the contract's refusals, which the inbox routes (T13, T14) return as is:

- `ConversationStateChangedError` 409 `{ conversation: ConversationSummary, latest_change: ThreadActivity|null }` (assign, unassign, reopen);
- `CloseNeedsConfirmationError` 409 `{ reasons, stale_change, newest_unread_message, conversation }` (close);
- `ChangeLimitReachedError` 429 `{ limit: 60, window_seconds: 60, retry_at }` + `Retry-After` (all four);
- success → `{ outcome: 'recorded' | 'unchanged', conversation, activity }` (names resolved by the inbox).

— `contracts/openapi.yaml, components/schemas *Error + ConversationStateChange, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

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

- [ ] `changeAssignee(tx, { workspaceId, actorAccountId, conversationId, assigneeAccountId | null, expectedStateVersion })` and `changeStatus(tx, { …, to: 'closed' | 'open', expectedStateVersion, expectedCloseSnapshot?, confirm? , actorActiveSince })` — lock row (T6) → `decideChange` (T3) → limit → write — `conversations/app/state-changes.ts`
- [ ] Shared `recordChange(tx, …)`: versioned write + activity insert + `conversation.changed` `{ type: 'activity', id }` signal; exported for T8 / T9 / T10 (automatic causes skip the limit) — `state-changes.ts`, `conversation-signals.ts`
- [ ] Limit: advisory lock `changes:<ws>:<account>`, count since now − 60 s, refuse at 60 with `retry_at = oldest.created_at + 60 s` — only on the `allowed` branch
- [ ] Refusal details: current summary fields + latest entry (stale), reasons + newest unread message + snapshot (close)
- [ ] Unit tests with fakes for every branch order; integration tests QG-1 (a), (b2), (d), 61 concurrent changes, signal only on commit — `state-changes.test.ts`, `state-changes.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Assign the current assignee with a stale version | `unchanged`, nothing recorded, not counted |
| Reassign A → B | one `reassigned` entry, one count |
| 60 changes in this workspace, change in another workspace | allowed (limit per workspace) |
| Transaction rolls back after `recordChange` | no signal delivered (published inside the transaction) |
| Close anyway with the refusal's snapshot, but a reply turned `not_confirmed` meanwhile | refused again with `reply_not_confirmed` |

## Definition of Done

- [ ] Unit tests cover every outcome of both use cases in check order; integration tests prove QG-1 (a), (b2) and (d), the 61st change refused under 61 concurrent requests with retry_at, refused / unchanged requests not counted, and one activity signal published only on commit.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
