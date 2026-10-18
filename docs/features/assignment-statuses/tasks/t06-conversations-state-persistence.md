---
id: T6
title: "Build the conversations persistence for state and activity: locked row read, versioned state update, activity repository and the close-reason reads"
layer: "infra"
deps: ["T1", "T3"]
blocks: ["T7", "T11"]
acs: ["AC-06", "AC-09"]
files_hint: ["apps/api/src/modules/conversations/infra/conversation-repo.ts", "apps/api/src/modules/conversations/infra/conversation-repo.int.test.ts", "apps/api/src/modules/conversations/infra/activity-repo.ts", "apps/api/src/modules/conversations/infra/activity-repo.int.test.ts", "apps/api/src/modules/conversations/app/ports.ts", "apps/api/src/modules/conversations/app/fakes.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T6 — Build the conversations persistence for state and activity: locked row read, versioned state update, activity repository and the close-reason reads

## Place in the sequence

- **Blocked by:** T1 — Promote the expand, backfill, activity-table and lens-index migrations 01–04, regenerate DB types and extend the test fixtures, T3 — Add the conversations domain change rules: no-op, stale and close-reason decision, snapshot equality, activity kinds and causes, position rule and the change-limit window · **Blocks:** T7 — Add the changeAssignee and changeStatus use cases in conversations: version guard, close reasons against the snapshot, the per-member change limit, the write, the activity entry and its signal, T11 — Teach the conversations read side lenses, per-row state and version, the summary's close snapshot, the thread's activity half and the single activity item · **Wave:** 2 — after T1, T3.
- **Lane:** shares `conversation-repo.ts` with T8 and T10 — serialized, T6 first; `ports.ts` / `fakes.ts` also with T7.

## Why (user story)

> **As an** Operator
> **I want** to close a conversation when the customer needs nothing more, and see closed ones when I look for them
> **So that** the working list holds only what still needs work
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** the thread to show who assigned, unassigned, closed or reopened the conversation and when
> **So that** I understand its history before I act
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It gives the change use cases the row lock, the version bump, the history log and the facts a close is judged on.

## Inlined context

> **Close reasons** are derived under the row lock, all from existing indexes:
> - waiting: `last_reply_sent_at IS NULL OR last_message_received_at > last_reply_sent_at` (the row itself);
> - unread for this member: a message with `received_at > GREATEST(read_through_at, active_since)` (`read_marks_conversation_id_account_id_key`, `messages_conversation_id_received_at_idx`);
> - the counter grew past the snapshot sent (the row itself);
> - the latest reply is `not_delivered` or `not_confirmed` (`replies_conversation_id_position_at_idx`).
>
> — `data-model.md §conversations, Close reasons, verbatim` · full text: [data-model.md](../data-model.md)

> - Thread page before/after a `(position_at, kind, id)` cursor, the activity half (flow 11) → `conversation_activities_conversation_id_position_at_idx`.
> - The latest entry of a conversation, for a stale refusal's details and the position rule (flows 6, 7) → same index, backward, limit 1.
> - Change-limit count and the oldest counted entry: `workspace_id = ? AND actor_account_id = ? AND created_at > now − 60 s` under the `changes:<ws>:<account>` advisory lock (flows 5–8) → `conversation_activities_workspace_id_actor_created_at_idx`.
> - Live item by `(workspace_id, id)` (flow 13) → PK.
>
> — `data-model.md §conversation_activities, Access patterns, verbatim` · full text: [data-model.md](../data-model.md)

> **Close snapshot** (ADR-0003) is derived, not stored: `customer_message_seq` + the latest reply's `(id, state)` (backward scan of `replies_conversation_id_position_at_idx`, limit 1).
>
> — `data-model.md §conversations, Close snapshot, verbatim` · full text: [data-model.md](../data-model.md)

> Assumption 4. **The change limit counts on `created_at`, not `position_at`.** `position_at` can be pushed forward to "never earlier than the latest entry" (SAD §4), while `created_at` is the plain server clock at insert, which is what "the last 60 s" means.
>
> — `data-model.md §Assumptions, 4, abridged` · full text: [data-model.md](../data-model.md)

> The close only reads the latest reply and the member's read mark. Member changes take memberships before conversation rows, and so does deactivation.
>
> — `sad.md §8, Concurrency — why deadlock-free, abridged` · full text: [sad.md](../sad.md)

> **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation.
>
> — `CLAUDE.md §Rules, Tenancy, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Table · column | Type | Constraints | Change |
|---|---|---|---|
| `conversations.status`, `assignee_account_id`, `state_version`, `customer_message_seq` | text, uuid, integer, integer | see T1 | read `FOR UPDATE`; written by the versioned update |
| `conversation_activities.*` | — | PK, CHECKs, composite FKs | insert / read |
| `messages.received_at`, `read_marks.read_through_at`, `memberships.active_since` (via the caller's guard result), `replies.state` | — | existing | read-only (close reasons, snapshot) |

— `data-model.md §Entities, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-06 — domain invariant

> **Given** an operator of "Acme Flowers" about to close a conversation
> **When** its customer is still waiting for a reply, or a customer message arrived after the operator's own arrival watermark (they have not read it — a thread in a background tab marks nothing read)
> **Then** before closing the inbox shows why — the customer is waiting for a reply, the newest message the operator has not read, or the conversation's latest reply was "not delivered" / "not confirmed" — and asks whether to close anyway or keep it open; the conversation is closed only if the operator confirms; the condition is checked again at the moment the close is recorded, so a customer message recorded between the question and the close asks again — a customer is never put out of sight by a close made over a message the closer had not read; a customer message recorded after the close reopens it (AC-07)
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — happy path

> **Given** a conversation of "Acme Flowers" that has been assigned, reassigned, unassigned, closed and reopened
> **When** any member opens its thread
> **Then** each change appears in the thread at the time it happened (its position time), among the messages and replies, as a short line naming the member who made it (or "the customer wrote" / "a reply was not delivered" / "the assignee was deactivated" for automatic changes) and the time; these lines are never sent to the end customer, do not count as unread, and appear live in a thread open in another member's tab
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `lockState(workspaceId, conversationId, tx)` → `{ status, assigneeAccountId, stateVersion, customerMessageSeq, lastActivityAt, waitingForReply } | null` with `FOR UPDATE` — `conversations/infra/conversation-repo.ts`
- [ ] `writeState(workspaceId, conversationId, { status?, assigneeAccountId? }, tx)` raising `state_version = state_version + 1` in the same `UPDATE`, never touching `last_activity_at` — `conversation-repo.ts`
- [ ] Activity repo: `insert`, `latestFor(conversationId)`, `byId`, `countByActorSince(workspaceId, accountId, since)` → `{ count, oldestCreatedAt }` — `conversations/infra/activity-repo.ts`
- [ ] Close-reason reads: newest unread customer message for `(account, max(watermark, activeSince))` → `{ id, receivedAt } | null`; latest reply `{ id, state } | null` — `conversation-repo.ts` (or a reads helper in the same folder)
- [ ] Port types + in-memory fakes for T7's unit tests — `conversations/app/ports.ts`, `fakes.ts`
- [ ] Integration tests incl. isolation with `twoWorkspacesWithInbox` — `conversation-repo.int.test.ts`, `activity-repo.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Conversation id of another workspace | `lockState` → null (404 upstream), nothing locked |
| No replies yet | latest reply null; waiting is true when a customer message exists |
| Entry exactly 60 s old | outside the window (`created_at > now − 60 s`) |
| Two activity entries with the same `position_at` | `latestFor` breaks ties by id |

## Definition of Done

- [ ] Integration tests prove the FOR UPDATE row read with status / assignee / version / counter, the versioned update raising state_version by one, activity insert / latest / by id / count-by-actor over 60 s with the oldest created_at, and the four close-reason reads — every method scoped by workspace with a cross-workspace isolation test.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
