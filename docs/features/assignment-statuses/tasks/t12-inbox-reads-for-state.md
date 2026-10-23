---
id: T12
title: "Serve lenses, state and activity through the inbox reads: change the list, summary and thread schemas, add getThreadActivity and listActiveMembers"
layer: "ports"
deps: ["T2", "T5", "T11"]
blocks: ["T13", "T16"]
acs: ["AC-01", "AC-04", "AC-09", "AC-11"]
files_hint: ["packages/shared/src/inbox.ts", "packages/shared/src/inbox.test.ts", "apps/api/src/modules/inbox/app/reads.ts", "apps/api/src/modules/inbox/app/ports.ts", "apps/api/src/modules/inbox/http/routes.ts", "apps/api/src/modules/inbox/http/reads.int.test.ts", "apps/web/src/features/inbox/api-source.ts", "apps/web/src/features/inbox/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T12 — Serve lenses, state and activity through the inbox reads: change the list, summary and thread schemas, add getThreadActivity and listActiveMembers

## Place in the sequence

- **Blocked by:** T2 — Add the assignment zod contracts, the four error codes and the activity item type on the live frame and the realtime signal, T5 — Give workspaces lockActiveMembers, activeMembers and the onMembershipDeactivated port called inside the deactivation transaction, T11 — Teach the conversations read side lenses, per-row state and version, the summary's close snapshot, the thread's activity half and the single activity item · **Blocks:** T13 — Add the assign and unassign routes: one transaction that share-locks the memberships, then changes the conversation, with every refusal of the contract, T16 — Teach the web inbox store and API source lenses in the address, the state version and close snapshot, the change actions and activity frames · **Wave:** 4 — after T2, T5, T11.
- **Lane:** compile-coupled with T2 through `packages/shared/src/inbox.ts` (serialized after it); shares `inbox/http/routes.ts` with T13 / T14 and web `features/inbox/` fixtures with T16.

## Why (user story)

> **As an** Operator
> **I want** the list to show each conversation's assignee and let me switch between all, mine and unassigned conversations
> **So that** I pick up only what nobody handles or what is mine
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** the thread to show who assigned, unassigned, closed or reopened the conversation and when
> **So that** I understand its history before I act
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It puts each row's assignee and status, the thread's history and the team list in front of the panel.

## Inlined context

> - **Routes** (`modules/inbox/http/routes.ts`): querystring of `GET /conversations` gains `status` / `assignee` (zod enums with defaults); `GET /conversations/:id` response becomes `ConversationSummary` (update `response-schemas` tests); add the 6 routes with `preHandler: pre`. `GET /members` uses `pre` (any active member) — **not** `ownerOnly`.
> - **`X-Background-Request: 1`** on the live refetches (`getConversation`, `getThreadActivity`), as for the existing reads.
>
> — `contracts/api-sync-report.md §Notes for tasks / implement, abridged` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> 5. **`getConversation` now answers `ConversationSummary`** (row + `close_snapshot`), while list rows (`Conversation`) carry status, assignee and version but **not** the snapshot.
> 7. **The page echoes its lenses** (`ConversationPage.lens`) — flow 4 "list page tagged with the workspace id and the lenses it answers". `lens.status` is null while searching.
>
> — `contracts/api-sync-report.md §Assumptions, 5 + 7, abridged` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> Every change route and read sits under `/api/workspaces/:workspaceId/…` behind the `workspaces` guard. Another workspace's account gets not found with no hint, a deactivated member gets `ACCESS_REMOVED`, and a signed-out visitor is sent to sign in (AC-11). Both roles have identical rights (spec §1).
>
> — `sad.md §8, Authorization, abridged` · full text: [sad.md](../sad.md)

> **Contracts:** request/response bodies are zod schemas in `packages/shared`, validated by `fastify-type-provider-zod`; the web client parses responses with the same schemas (`apps/web/src/shared/api/client.ts`).
>
> — `CLAUDE.md §Rules, Contracts, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> Display names in assignee labels and activity lines are rendered as plain text (React escaping, spec §6.1 abuse case). Activity entries store account ids and resolve names at read time.
>
> — `sad.md §8, Untrusted content, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `GET …/inbox/conversations?status=&assignee=&q=&after=&limit=` (`listConversations`, changed) → `200 ConversationPage` with `lens { status | null, assignee }`; rows add `status`, `assignee: MemberRef|null`, `state_version` · errors `400 VALIDATION_ERROR`, `401`, `403 ACCESS_REMOVED`, `404`.
- `GET …/conversations/{conversationId}` (`getConversation`, changed) → `200 ConversationSummary` (+ `close_snapshot`).
- `GET …/conversations/{conversationId}/items` (`listThreadItems`, changed) → `ThreadPage`, `items[]` may be `ThreadActivity` (actor / assignee names resolved, plain text).
- `GET …/conversations/{conversationId}/activities/{activityId}` (`getThreadActivity`, added) → `200 ThreadActivity` · `404` for a foreign or unknown id.
- `GET …/inbox/members` (`listActiveMembers`, added) → `200 ActiveMemberList` (active only, by display name then account id, not paged), any role.

— `contracts/openapi.yaml, listConversations / getConversation / listThreadItems / getThreadActivity / listActiveMembers, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" whose workspace has 30 conversations — some assigned to them, some to a teammate, some unassigned, some closed
> **When** they open the inbox
> **Then** the list shows the open conversations of every assignee, newest activity first as before, each row showing its assignee's name (or "unassigned") and keeping its last message and time — an assignee or status change never becomes a row's preview or time; choosing "mine" shows only open conversations assigned to them, "unassigned" only open conversations with no assignee, and "closed" the closed conversations in the chosen assignee lens, also newest activity first; while searching, the status lens is set aside and matches of both statuses are shown within the chosen assignee lens, each closed row marked "closed"; when a lens holds nothing the inbox says so; the chosen lenses are part of the page's address, so a reload, the back button or a saved link opens the same lenses, and switching to another workspace starts again at open · all; a business owner sees and does the same
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-04 — error

> **Given** an operator of "Acme Flowers" choosing an assignee for a conversation
> **When** the person they pick is no longer an active member of "Acme Flowers" (deactivated a moment ago), or belongs to another workspace
> **Then** nothing changes, the inbox says that a conversation can be assigned only to an active member of this workspace, and the list of members to choose from shows only active members of "Acme Flowers"
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — happy path

> **Given** a conversation of "Acme Flowers" that has been assigned, reassigned, unassigned, closed and reopened
> **When** any member opens its thread
> **Then** each change appears in the thread at the time it happened (its position time), among the messages and replies, as a short line naming the member who made it (or "the customer wrote" / "a reply was not delivered" / "the assignee was deactivated" for automatic changes) and the time; these lines are never sent to the end customer, do not count as unread, and appear live in a thread open in another member's tab
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to assign, unassign, close or reopen a conversation of "Acme Flowers", or to see its assignee, status or activity (for example through a saved link)
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace or the conversation exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Change the shared `Conversation` (strict: `status`, `assignee`, `state_version`), `ConversationPage` (`lens`), `ThreadItem` (+ `ThreadActivity`); `getConversation` answers `ConversationSummary` — `packages/shared/src/inbox.ts`, `inbox.test.ts`
- [ ] Inbox read use cases resolve assignee / actor / previous / new names through `workspaces.displayNames`; add `getThreadActivity`, `listActiveMembers` (T5's `activeMembers`) — `inbox/app/reads.ts`, `inbox/app/ports.ts`
- [ ] Routes: lens querystring with defaults, the two new GETs behind `pre` (not `ownerOnly`) — `inbox/http/routes.ts`
- [ ] Keep the web compiling: api-source parses the new shapes; test fixtures typed as `Conversation` / `ThreadItem` gain the fields; Thread renders nothing for `activity` items until T18 — `apps/web/src/features/inbox/`
- [ ] Route integration tests: each lens, search echo `lens.status: null`, summary snapshot, activity item, members for an operator, guard trio, foreign ids — `inbox/http/reads.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `?status=archived` | `400 VALIDATION_ERROR` (the panel never sends it — SCR-01 Decision 1) |
| Operator calls `GET …/members` | 200 (not owner-only) |
| Activity whose actor was deactivated since | name still resolved and shown |
| Member name `<b>Bob</b>` | returned as data; rendered as text by the panel |

## Definition of Done

- [ ] Route integration tests pass for the changed listConversations (status / assignee / q and the lens echo), getConversation as ConversationSummary, listThreadItems with activity items, getThreadActivity and listActiveMembers (any active member, active only), with the guard trio and foreign ids, and the api and web typecheck stay green with the changed shared schemas.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
