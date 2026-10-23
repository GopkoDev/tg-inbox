---
id: T11
title: "Teach the conversations read side lenses, per-row state and version, the summary's close snapshot, the thread's activity half and the single activity item"
layer: "infra"
deps: ["T4", "T6"]
blocks: ["T12"]
acs: ["AC-01", "AC-09"]
files_hint: ["apps/api/src/modules/conversations/infra/list-queries.ts", "apps/api/src/modules/conversations/infra/list-queries.int.test.ts", "apps/api/src/modules/conversations/infra/thread-queries.ts", "apps/api/src/modules/conversations/infra/thread-queries.int.test.ts", "apps/api/src/modules/conversations/app/inbox-reads.ts", "apps/api/src/modules/conversations/app/inbox-reads.test.ts", "apps/api/src/modules/conversations/app/inbox-reads.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T11 — Teach the conversations read side lenses, per-row state and version, the summary's close snapshot, the thread's activity half and the single activity item

## Place in the sequence

- **Blocked by:** T4 — Extend the thread domain with the activity kind: merge order message < reply < activity and a three-kind cursor that still decodes old cursors, T6 — Build the conversations persistence for state and activity: locked row read, versioned state update, activity repository and the close-reason reads · **Blocks:** T12 — Serve lenses, state and activity through the inbox reads: change the list, summary and thread schemas, add getThreadActivity and listActiveMembers · **Wave:** 3 — after T4, T6.
- **Lane:** own lane (`list-queries.ts`, `thread-queries.ts`, `inbox-reads.ts`).

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

It answers the list through the lenses and the thread with its history of changes, ready for the inbox routes.

## Inlined context

> `conversations.listPage` gains `status` (open / closed, ignored while a search query is present) and `assignee` (all / mine = the caller / unassigned) filters, and each row returns its status, assignee account id and state version. Assignee names come from `workspaces` display names, as reply authors' names already do. […] The existing `(workspace_id, last_activity_at, id)` index stays for search across statuses.
>
> — `sad.md §4, List lenses, abridged` · full text: [sad.md](../sad.md)

> - Status lens, assignee "all": `(workspace_id, status, last_activity_at DESC, id DESC)` keyset → `conversations_workspace_id_status_idx`.
> - Assignee lens "mine" / "unassigned" within a status: `(workspace_id, assignee_account_id = ? | IS NULL, status, …)` → `conversations_workspace_id_assignee_status_idx`.
> - Search (status lens set aside, assignee lens kept): existing `conversations_workspace_id_last_activity_at_idx` + `contact_id = ANY(…)`, assignee as a filter.
>
> — `data-model.md §conversations, Access patterns, abridged` · full text: [data-model.md](../data-model.md)

> For a member, the thread page merges three keyset halves (messages, replies, activity entries) by position time, with ties ordered message, reply, activity (ADR-0006). […] Older pages load with the three-kind cursor. A change made while the thread is open in another tab arrives live as one new line, and unread counts do not change (AC-09, ADR-0007).
>
> — `sad.md §6, Flow 11 prose, abridged` · full text: [sad.md](../sad.md)

> a seeded integration test with 1 000 conversations per lens (open · all, open · mine, open · unassigned, closed · each, search) asserting server time
>
> — `sad.md §10, QG-3 How verify, verbatim` · full text: [sad.md](../sad.md)

> **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation.
>
> — `CLAUDE.md §Rules, Tenancy, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Table | Access | Change |
|---|---|---|
| `conversations` | lens keysets on `…_status_idx` / `…_assignee_status_idx`; search on `…_last_activity_at_idx` | read-only |
| `conversation_activities` | thread half on `conversation_activities_conversation_id_position_at_idx`; item by PK | read-only |
| `replies` | latest reply for the summary's snapshot (`replies_conversation_id_position_at_idx`, backward, limit 1) | read-only |

— `data-model.md §Indexes, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — feeds T12's `listConversations` (`status`, `assignee`, `q`, `after`), `getConversation` (`ConversationSummary`), `listThreadItems` (`ThreadActivity` items) and `getThreadActivity`. A cursor is valid only with the lenses and `q` it was issued for — `contracts/openapi.yaml, listConversations, abridged`.

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" whose workspace has 30 conversations — some assigned to them, some to a teammate, some unassigned, some closed
> **When** they open the inbox
> **Then** the list shows the open conversations of every assignee, newest activity first as before, each row showing its assignee's name (or "unassigned") and keeping its last message and time — an assignee or status change never becomes a row's preview or time; choosing "mine" shows only open conversations assigned to them, "unassigned" only open conversations with no assignee, and "closed" the closed conversations in the chosen assignee lens, also newest activity first; while searching, the status lens is set aside and matches of both statuses are shown within the chosen assignee lens, each closed row marked "closed"; when a lens holds nothing the inbox says so; the chosen lenses are part of the page's address, so a reload, the back button or a saved link opens the same lenses, and switching to another workspace starts again at open · all; a business owner sees and does the same
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — happy path

> **Given** a conversation of "Acme Flowers" that has been assigned, reassigned, unassigned, closed and reopened
> **When** any member opens its thread
> **Then** each change appears in the thread at the time it happened (its position time), among the messages and replies, as a short line naming the member who made it (or "the customer wrote" / "a reply was not delivered" / "the assignee was deactivated" for automatic changes) and the time; these lines are never sent to the end customer, do not count as unread, and appear live in a thread open in another member's tab
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `listPage({ workspaceId, callerAccountId, status, assignee, q?, after?, limit })`: lens filters, `status` ignored with a non-empty trimmed `q`, rows gain `status`, `assigneeAccountId`, `stateVersion`; cursor bound to lenses + `q` — `conversations/infra/list-queries.ts`
- [ ] `summary(workspaceId, conversationId, accountId)` = row + `closeSnapshot { customerMessageSeq, latestReply }` — `list-queries.ts` / `inbox-reads.ts`
- [ ] Thread page: third keyset half over activity entries merged with T4's order; `activityItem(workspaceId, conversationId, activityId)` — `conversations/infra/thread-queries.ts`, `inbox-reads.ts`
- [ ] Integration tests per lens, search across statuses, unchanged `last_item` / `last_activity_at` after changes, isolation, old cursor, seeded 1 000 rows timing — `list-queries.int.test.ts`, `thread-queries.int.test.ts`, `inbox-reads.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `q` = "  " (spaces only) | not a search — the status lens applies |
| Cursor issued for `status=open` used with `status=closed` | rejected as an invalid cursor |
| Activity id of another conversation or workspace | not found |
| Conversation closed after its last message | row keeps its last item and time; only `status` changes |

## Definition of Done

- [ ] Integration tests prove every lens (open/closed × all/mine/unassigned) and search across both statuses within the assignee lens, rows with status / assignee id / version and unchanged last item and time, the summary's close snapshot, the three-way thread page with activity items and old cursors, the activity item by id, workspace isolation, and the seeded 1 000-conversation lens timings under 500 ms.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
