---
id: T13
title: "Add the assign and unassign routes: one transaction that share-locks the memberships, then changes the conversation, with every refusal of the contract"
layer: "ports"
deps: ["T7", "T10", "T12"]
blocks: ["T14"]
acs: ["AC-02", "AC-03", "AC-04", "AC-10", "AC-11"]
files_hint: ["apps/api/src/modules/inbox/app/change-state.ts", "apps/api/src/modules/inbox/app/change-state.test.ts", "apps/api/src/modules/inbox/app/ports.ts", "apps/api/src/modules/inbox/http/routes.ts", "apps/api/src/modules/inbox/http/changes.int.test.ts", "apps/api/src/deps.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T13 — Add the assign and unassign routes: one transaction that share-locks the memberships, then changes the conversation, with every refusal of the contract

## Place in the sequence

- **Blocked by:** T7 — Add the changeAssignee and changeStatus use cases in conversations: version guard, close reasons against the snapshot, the per-member change limit, the write, the activity entry and its signal, T10 — Unassign a deactivated member's conversations through the port inside the deactivation transaction, and build conversations before team in buildDeps, T12 — Serve lenses, state and activity through the inbox reads: change the list, summary and thread schemas, add getThreadActivity and listActiveMembers · **Blocks:** T14 — Add the close and reopen routes with the close snapshot and confirm, and prove the change limit across all four change routes · **Wave:** 5 — after T7, T10, T12.
- **Lane:** shares `inbox/http/routes.ts` with T12 / T14, `change-state.ts` and `changes.int.test.ts` with T14, `deps.ts` with T5 / T10 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to assign a conversation to myself or a teammate, or unassign it
> **So that** the team knows who answers this customer
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It lets a member take, hand over or drop a conversation without ever overwriting a change they had not seen.

## Inlined context

> Inside one transaction the service share-locks the caller's and the pick's memberships. A caller deactivated meanwhile gets the access-removed landing (AC-11). A pick that is not an active member of this workspace, which includes a foreign account, is refused with the same "active members only" answer, and the chooser reloads (AC-04). Under the conversation row lock, a request that matches the current state is a no-op and a version mismatch goes to flow 6.
>
> — `sad.md §6, Flow 5 prose, abridged` · full text: [sad.md](../sad.md)

> A concurrent assignment that serialises after the deactivation is refused. One that took its share lock first commits first and is then unassigned by the deactivation's port in the same transaction. Either way no assignment to a deactivated member ever exists.
>
> — `sad.md §4, choice 5, abridged` · full text: [sad.md](../sad.md)

> integration test "deactivate during a concurrent assign → the assign is refused, no assignment remains", run in both lock orders. When the assign takes its lock first, it commits and the deactivation then clears it with an activity entry (§1 decision override); integrity check in the integration suite after every concurrency test; […] a route test with a foreign account id as assignee.
>
> — `sad.md §10, QG-2 How verify, abridged` · full text: [sad.md](../sad.md)

> - **N1. Assignee check before conversation lookup** (flow 5 order). A foreign or unknown conversation id with an inactive pick gets `400 ASSIGNEE_NOT_ACTIVE`, not `404`. This leaks nothing […]. *Accept* — keep the flow's lock order.
>
> — `contracts/api-sync-report.md §B, N1, abridged` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> Change logs carry the workspace, conversation, activity id, kind, cause and outcome code, and never display names or message text.
>
> — `sad.md §7, Tracing, abridged` · full text: [sad.md](../sad.md)

> **Member change:** (1) memberships `FOR SHARE`; (2) the conversation row `FOR UPDATE`; (3) the `changes:<ws>:<account>` advisory lock, after the no-op, version and close checks; (4) the activity insert.
> **Deactivation:** (1) the workspace row `FOR UPDATE`; (2) the membership `UPDATE`, whose row lock conflicts with `FOR SHARE`; (3) the conversation rows assigned to the member (`UPDATE`); (4) activity inserts.
> **Capture:** contact upsert and message insert (unique key), then the conversation row (the raise `UPDATE`, returning status).
> **Reply outcome** (`settle()`): the `drain:` advisory lock and the reply / attempt rows, then the conversation row.
>
> — `sad.md §8, Concurrency, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (writes go through T7's `changeAssignee`).

## API contract

- `POST …/conversations/{conversationId}/assign` (`assignConversation`) body `AssignRequest { assignee_account_id, expected_state_version }` → `200 ConversationStateChange` (`recorded` | `unchanged`) · `400 ASSIGNEE_NOT_ACTIVE` · `409 CONVERSATION_STATE_CHANGED` · `429 CHANGE_LIMIT_REACHED` · `401` · `403 ACCESS_REMOVED` (`CallerAccessRemoved`) · `404`.
- `POST …/conversations/{conversationId}/unassign` (`unassignConversation`) body `StateChangeRequest { expected_state_version }` → same, without `400 ASSIGNEE_NOT_ACTIVE`.
- Names in `conversation.assignee` and `activity` resolved through `workspaces.displayNames`.

— `contracts/openapi.yaml, assignConversation + unassignConversation, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

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

### AC-04 — error

> **Given** an operator of "Acme Flowers" choosing an assignee for a conversation
> **When** the person they pick is no longer an active member of "Acme Flowers" (deactivated a moment ago), or belongs to another workspace
> **Then** nothing changes, the inbox says that a conversation can be assigned only to an active member of this workspace, and the list of members to choose from shows only active members of "Acme Flowers"
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — cross-context

> **Given** an operator of "Acme Flowers" who is the assignee of open and closed conversations
> **When** a business owner deactivates their membership
> **Then** every conversation of "Acme Flowers" assigned to them, open and closed, becomes unassigned as part of the deactivation itself — there is no moment when a deactivated member is anyone's assignee, and an assignment to them made at the same moment is either refused (AC-04) or, if it was recorded first, undone by the deactivation itself with its own activity line — open ones appear under "unassigned" for the team without reloading, and each thread records "unassigned — <member> was deactivated"; conversations of another workspace the same account belongs to keep that assignee; reactivating the member later does not give the conversations back
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to assign, unassign, close or reopen a conversation of "Acme Flowers", or to see its assignee, status or activity (for example through a saved link)
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace or the conversation exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Use cases `assign` / `unassign`: one transaction; `lockActiveMembers(tx, ws, [caller, pick?])`; caller missing → `CallerAccessRemoved` 403; pick missing → `AssigneeNotActiveError`; then `conversations.changeAssignee(tx, …)`; resolve names; log outcome codes only — `inbox/app/change-state.ts`, `inbox/app/ports.ts`
- [ ] Routes with `preHandler: pre`, zod bodies, `ConversationStateChange` response — `inbox/http/routes.ts`
- [ ] Wire the use cases in `buildDeps()` — `apps/api/src/deps.ts`
- [ ] Unit tests for the check order with fakes — `change-state.test.ts`; route tests incl. both deactivation lock orders + the integrity query (no assignee who is not an active member) — `inbox/http/changes.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Pick = account of another workspace | `400 ASSIGNEE_NOT_ACTIVE`, same body as a deactivated pick |
| Unknown conversation id + inactive pick | `400 ASSIGNEE_NOT_ACTIVE` (N1) |
| Caller deactivated between guard and share lock | `403 ACCESS_REMOVED`, nothing changed |
| Assign a closed conversation | recorded; stays closed |
| Bot `needs_token` / `not_connected` | assign works (no bot check) |

## Definition of Done

- [ ] Unit tests prove the check order (caller share-lock → pick active → conversation); route tests prove 200 recorded / unchanged, 409 CONVERSATION_STATE_CHANGED, 400 ASSIGNEE_NOT_ACTIVE for a deactivated or foreign pick, 403 when the caller is deactivated under the lock, 404 for a foreign conversation, and the deactivation race in both lock orders leaves no assignment to a deactivated member.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
