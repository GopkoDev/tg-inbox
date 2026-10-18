---
id: T2
title: "Add the assignment zod contracts, the four error codes and the activity item type on the live frame and the realtime signal"
layer: "ports"
deps: []
blocks: ["T7", "T12"]
acs: ["AC-03", "AC-12"]
files_hint: ["packages/shared/src/inbox.ts", "packages/shared/src/inbox.test.ts", "packages/shared/src/errors.ts", "packages/shared/src/errors.test.ts", "apps/api/src/platform/errors.ts", "apps/api/src/platform/errors.test.ts", "apps/api/src/platform/realtime.ts", "apps/api/src/platform/realtime.test.ts", "apps/web/src/features/inbox/store.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T2 — Add the assignment zod contracts, the four error codes and the activity item type on the live frame and the realtime signal

## Place in the sequence

- **Blocked by:** — · **Blocks:** T7 — Add the changeAssignee and changeStatus use cases in conversations: version guard, close reasons against the snapshot, the per-member change limit, the write, the activity entry and its signal, T12 — Serve lenses, state and activity through the inbox reads: change the list, summary and thread schemas, add getThreadActivity and listActiveMembers · **Wave:** 1 — no upstream task.
- **Lane:** shares `packages/shared/src/inbox.ts` with T12 (which changes the existing list / summary / thread schemas) — serialized, T2 first; touches `store.ts` only to ignore `activity` frames until T16.

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

It fixes the wire shapes and refusal codes every change route, read and screen of this feature uses.

## Inlined context

> | `CONVERSATION_STATE_CHANGED` | 409 | `ConversationStateChangedError` (Conflict family) | `{ conversation, latest_change }` | assign, unassign, reopen |
> | `CLOSE_NEEDS_CONFIRMATION` | 409 | `CloseNeedsConfirmationError` (Conflict family) | `{ reasons, stale_change, newest_unread_message, conversation }` | close |
> | `ASSIGNEE_NOT_ACTIVE` | 400 | `AssigneeNotActiveError` (Validation family, like `BotTokenInvalidError`) | `{ field: 'assignee_account_id' }` | assign |
> | `CHANGE_LIMIT_REACHED` | 429 | `ChangeLimitReachedError` (TooManyRequests family, with `headers: { 'Retry-After' }` like `ReplyLimitReachedError`) | `{ limit: 60, window_seconds: 60, retry_at }` | assign, unassign, close, reopen |
>
> — `contracts/api-sync-report.md §B.2, new codes, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> - **Shared schemas** (`packages/shared/src/inbox.ts`): `StatusLens`, `AssigneeLens`, `ConversationStatus`, `StateVersion`, `CloseSnapshot`, `ConversationSummary`, `ThreadActivity` (with `.refine`s for the actor ⇔ cause and assignee-pair rules), `ActiveMemberList`, `AssignRequest`, `StateChangeRequest`, `CloseRequest`, `ConversationStateChange`, `CloseReason`, and the four `refusal(...)` schemas. Extend `Conversation` (strict) with `status`, `assignee`, `state_version`; `ConversationPage` with `lens`; `ThreadItem` union with `ThreadActivity`; `ConversationChangedFrame.item.type` with `'activity'`.
> - **Realtime** (`platform/realtime.ts`): `item.type` enum gains `'activity'`; the hub already forwards `item` unchanged.
>
> — `contracts/api-sync-report.md §Notes for tasks / implement, abridged` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> - **Delta:** `item.type` enum `message | reply` → `message | reply | activity`. With `activity`, `change` is always `created` (activity entries are immutable — data-model `conversation_activities`). Still `v: 1`: the change is additive under the shared-inbox policy (a new enum value, no field removed or renamed).
> - **Old bundles:** a tab opened before the deploy parses `LiveFrame` with the old `item.type` enum, so an `activity` frame fails `safeParse` and is ignored (the existing "unknown → ignore" rule in `packages/shared/src/inbox.ts`). […] `tasks` verifies the frame is dropped without breaking the socket.
>
> — `contracts/events.md §Frame conversation.changed, abridged` · full text: [events.md](../contracts/events.md)

> **Errors:** throw `ValidationError` / `NotFoundError` / `ForbiddenError` / `ConflictError` / `UnauthenticatedError` / `TooManyRequestsError` (or a specific-code subclass such as `InvalidCredentialsError`) from `src/platform/errors.ts`. […] The one error handler returns `{ "error": { "code", "message", "details"? } }`; codes are declared in `packages/shared/src/errors.ts`.
>
> — `CLAUDE.md §Rules, Errors, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> **Contract-task rule (this breakdown):** this task is **additive only**. The changes to the existing `Conversation`, `ConversationPage`, `ThreadItem` and the `getConversation` response break the shipped read routes' types, so they land in T12 together with the routes that fill them.
>
> — `tasks/_epic.md §Risks, Contract split, abridged` · full text: [_epic.md](./_epic.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Schemas added (`packages/shared/src/inbox.ts`), mirroring `components/schemas` of the delta contract:

- `StatusLens` `open|closed` (default `open`) · `AssigneeLens` `all|mine|unassigned` (default `all`) · `ConversationStatus` · `StateVersion` integer 0…2147483647.
- `CloseSnapshot` `{ customer_message_seq, latest_reply: { id, state } | null }` · `ConversationSummary` = row fields + `status`, `assignee: MemberRef|null`, `state_version`, `close_snapshot` (defined here; `getConversation` switches to it in T12).
- `ActivityKind` `assigned|reassigned|unassigned|closed|reopened` · `ActivityCause` `member|customer_wrote|reply_not_delivered|member_deactivated` · `ThreadActivity` `{ type: 'activity', id, workspace_id, conversation_id, kind, cause, actor, previous_assignee, new_assignee, position_at }` with refines: `actor` non-null ⇔ `cause = member`; `assigned` (null, set), `reassigned` (set, set, different), `unassigned` (set, null), `closed`/`reopened` (null, null).
- `ActiveMemberList` `{ workspace_id, items: MemberRef[] }` · `AssignRequest` `{ assignee_account_id, expected_state_version }` · `StateChangeRequest` `{ expected_state_version }` · `CloseRequest` `{ expected_state_version, expected_close_snapshot, confirm_close_reasons? = false }` · `ConversationStateChange` `{ workspace_id, outcome: recorded|unchanged, conversation: ConversationSummary, activity: ThreadActivity|null }`.
- `CloseReason` `state_changed|customer_waiting|unread_customer_message|new_customer_message|reply_not_delivered|reply_not_confirmed` · the four refusal schemas `ConversationStateChangedError`, `CloseNeedsConfirmationError` (`reasons` ≥ 1, unique; `stale_change`; `newest_unread_message { id, received_at } | null`; `conversation`), `AssigneeNotActiveError` (`details.field = 'assignee_account_id'`), `ChangeLimitReachedError` (`limit: 60`, `window_seconds: 60`, `retry_at`).
- `ConversationChangedFrame.item.type` and `realtimeSignalSchema` `item.type` gain `'activity'`.

— `contracts/openapi.yaml, components/schemas (added), abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-03 — domain invariant

> **Given** an operator of "Acme Flowers" looking at a conversation with the assignee and status they last saw
> **When** its assignee or status has changed since then — by a teammate or automatically (reopened by the customer, unassigned by a deactivation) — and the operator now assigns, reassigns, unassigns, closes or reopens it; including when two members act at the same moment, where one change is recorded first and the other member counts as having seen the old state
> **Then** nothing changes yet: the inbox shows the current assignee and status, who changed them and how long ago, and asks whether to go ahead (take it over, close anyway…) or leave it; the change happens only if the operator confirms; when the conversation is already in the state the operator asked for, nothing changes, no line is recorded and the inbox simply shows it — a conversation has at most one assignee, and two members never take or close one conversation by accident
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — error

> **Given** an operator of "Acme Flowers" who has assigned, unassigned, closed or reopened 60 conversations within the last 60 seconds
> **When** they try to make another such change
> **Then** nothing changes, the inbox says that changes are limited to 60 per minute per member and when they can continue; only recorded changes count (a reassignment is one change; a refused, declined or already-in-place request is none); the limit is per workspace, so changes in another workspace of the same account are not affected; automatic changes (a customer's message, a failed reply, a deactivation) never count and are never refused
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Add the schemas above and their unit tests (every contract example parses; each refine rejects its violation; `CloseRequest` rejects extra keys) — `packages/shared/src/inbox.ts`, `inbox.test.ts`
- [ ] Register `CONVERSATION_STATE_CHANGED`, `CLOSE_NEEDS_CONFIRMATION`, `ASSIGNEE_NOT_ACTIVE`, `CHANGE_LIMIT_REACHED` — `packages/shared/src/errors.ts`
- [ ] Add `ConversationStateChangedError`, `CloseNeedsConfirmationError` (Conflict), `AssigneeNotActiveError` (Validation, `details.field`), `ChangeLimitReachedError` (TooManyRequests, `Retry-After` seconds) — `apps/api/src/platform/errors.ts`, `errors.test.ts`
- [ ] `item.type` gains `'activity'` (with `change: 'created'` only) in the signal schema; a payload test stays under `MAX_SIGNAL_BYTES` — `apps/api/src/platform/realtime.ts`, `realtime.test.ts`
- [ ] Test that a frame with `item.type: 'activity'` fails the *old* enum's `safeParse` (old-bundle rule) and parses the new one
- [ ] Make the web store ignore `activity` frames for now (no refetch of a reply by an activity id) — `apps/web/src/features/inbox/store.ts` (T16 replaces this)

## Edge cases

| Case | Behaviour |
|---|---|
| `activity` frame with `change: 'state'` | rejected by the signal schema — activity entries are immutable |
| `ThreadActivity` `reassigned` with previous = new | refine rejects |
| `ChangeLimitReachedError` with `retry_at` in 14.2 s | `Retry-After: 15` (rounded up), body `retry_at` exact |
| Old bundle receives an `activity` frame | `safeParse` fails → frame ignored, socket stays open |

## Definition of Done

- [ ] packages/shared and platform unit tests pass for every new schema (incl. the ThreadActivity refines and the contract examples), the four codes map to their AppError subclasses and statuses with Retry-After on the limit, and an activity frame parses in the new LiveFrame and the realtime signal while the old enum rejects it.
- [ ] `packages/shared` builds and the api + web typecheck stay green (`pnpm -r build`)
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
