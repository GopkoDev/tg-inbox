---
id: T1
title: "Promote the expand, backfill, activity-table and lens-index migrations 01–04, regenerate DB types and extend the test fixtures"
layer: "migration"
deps: []
blocks: ["T6", "T8"]
acs: ["AC-04", "AC-09"]
files_hint: ["docs/features/assignment-statuses/migrations/01_add_conversations_state_columns.up.sql", "docs/features/assignment-statuses/migrations/02_backfill_conversations_state_columns.up.sql", "docs/features/assignment-statuses/migrations/03_create_conversation_activities.up.sql", "docs/features/assignment-statuses/migrations/04_add_conversations_lens_indexes.up.sql", "apps/api/migrations/", "apps/api/src/platform/db.types.gen.ts", "apps/api/src/test/migrations.int.test.ts", "apps/api/src/test/fixtures/conversations.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T1 — Promote the expand, backfill, activity-table and lens-index migrations 01–04, regenerate DB types and extend the test fixtures

## Place in the sequence

- **Blocked by:** — · **Blocks:** T6 — Build the conversations persistence for state and activity: locked row read, versioned state update, activity repository and the close-reason reads, T8 — Reopen a closed conversation on a newly captured customer message, raise the customer message counter under the row lock, and promote contract migration 05 · **Wave:** 1 — no upstream task.
- **Lane:** shares `apps/api/migrations/`, `db.types.gen.ts`, `migrations.int.test.ts` and `fixtures/conversations.ts` with T8 (contract `05`) — serialized, T1 first. `layer: migration` is serialized by `implement`.

## Why (user story)

> **As an** Operator
> **I want** the thread to show who assigned, unassigned, closed or reopened the conversation and when
> **So that** I understand its history before I act
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to assign a conversation to myself or a teammate, or unassign it
> **So that** the team knows who answers this customer
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It lays the storage every later task writes: the conversation's status, assignee, state version and customer message counter, and the activity table the thread history is read from.

## Inlined context

> - Tables `snake_case` and plural; constraints named `<table>_<cols>_{pkey,key,fkey,check,idx}`, shortened where the full name would pass Postgres's 63-character limit.
> - The application supplies every value and timestamp. No `DEFAULT` (not even `DEFAULT 'open'`), no generic `updated_at`.
> - Kinds, causes and states are `text` + `CHECK (… IN (…))`, no `ENUM`. Column combinations are tied by `CHECK`s.
> - No triggers. `state_version` and `customer_message_seq` are raised by the application in the same `UPDATE` that changes their source.
> - A cross-module FK is a constraint only. Here it is a **composite** FK `(workspace_id, <account>) → memberships (workspace_id, account_id)` (SAD §5), so every assignee and actor is a member of the row's own workspace.
>
> — `data-model.md §Conventions applied, abridged` · full text: [data-model.md](../data-model.md)

> The latest is `1791681109992_contract_conversations_list_columns.ts`, so the next timestamp is ≈ `1791681109993`. `implement` assigns the real values at promotion, because another feature may promote first. Promote one TS migration per ordinal, in order, with the SQL inline in `` sql`…`.execute(db) `` and a header comment `// Promoted from docs/features/assignment-statuses/migrations/NN_….{up,down}.sql.` (precedent: `1791681109985_add_conversations_list_columns.ts`).
> 1. Run `pnpm db:migrate` → `pnpm db:codegen` and commit `db.types.gen.ts` (`Conversations` gains four fields; a new `ConversationActivities` interface).
> 2. Add an `assignment-statuses migrations` block to `apps/api/src/test/migrations.int.test.ts` (constraint smoke + revert and re-apply), like shared-inbox's.
>
> — `_audit/data-model-2026-10-18.md §Staged migrations, promote-time hint, abridged` · full text: [data-model audit](../_audit/data-model-2026-10-18.md)

> - `05` must not run before the code that writes the three columns: `conversation-repo.ts` capture insert (`status 'open'`, `state_version 0`, `customer_message_seq 0`), the capture raise of the counter, and the change paths. The `insertConversation` fixture must change in the same task, or existing integration tests fail the NOT NULL.
>
> — `_audit/data-model-2026-10-18.md §Ordering with code, verbatim` · full text: [data-model audit](../_audit/data-model-2026-10-18.md)

> **Migrations:** reversible — every migration exports a working `up` **and** `down`. After migrating, run `pnpm db:codegen` and commit the regenerated types. Destructive changes still go expand → migrate → contract.
>
> — `CLAUDE.md §Rules, Migrations, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Staged pairs promoted by this task (`05` is **not** promoted here — it lands with capture's writer in T8):

- `docs/features/assignment-statuses/migrations/01_add_conversations_state_columns.{up,down}.sql` — expand
- `…/02_backfill_conversations_state_columns.{up,down}.sql` — backfill (`open`, version 0, counter = message count; down is a no-op)
- `…/03_create_conversation_activities.{up,down}.sql` — new table, 5 `CHECK`s, 3 composite FKs, 4 indexes
- `…/04_add_conversations_lens_indexes.{up,down}.sql` — 2 indexes, plain `CREATE INDEX` (Migrator wraps a transaction)

| Table · column | Type | Constraints | Change |
|---|---|---|---|
| `conversations.status` | text | NULL until `05`; `CHECK IN ('open','closed')` | added |
| `conversations.assignee_account_id` | uuid | NULL; FK `(workspace_id, assignee_account_id) → memberships (workspace_id, account_id)` | added |
| `conversations.state_version` | integer | NULL until `05`; `CHECK >= 0` | added |
| `conversations.customer_message_seq` | integer | NULL until `05`; `CHECK >= 0` | added |
| `conversation_activities` | id, workspace_id, conversation_id, kind, cause, actor_account_id, previous_assignee_account_id, new_assignee_account_id, position_at, created_at | PK; kind / cause / kind↔cause / actor↔cause / assignee-pair `CHECK`s; composite FKs to `memberships` | new |
| `conversations_workspace_id_status_idx` | `(workspace_id, status, last_activity_at DESC, id DESC)` | — | new index |
| `conversations_workspace_id_assignee_status_idx` | `(workspace_id, assignee_account_id, status, last_activity_at DESC, id DESC)` | — | new index |

Fixtures (data-model §Test fixtures): `insertConversation(db, { …, status?, assigneeAccountId?, stateVersion?, customerMessageSeq? })` — defaults `'open'` / `null` / `0` / `0`; `insertActivity(db, { workspaceId, conversationId, kind, cause?, actorAccountId?, previousAssigneeAccountId?, newAssigneeAccountId?, positionAt?, createdAt? })` — default cause `member`; `twoWorkspacesWithInbox(db)` extended with an assigned conversation and one activity entry per workspace, sharing one account that is a member of both.

— `data-model.md §Entities + §Indexes + §Test fixtures, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

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

## Checklist

- [ ] Promote `01`–`04` as four TS migrations in order (next timestamps after `1791681109992`), SQL inline, header comment naming the staged pair — `apps/api/migrations/`
- [ ] `pnpm db:migrate` → `pnpm db:codegen`; commit `Conversations` (4 new fields) and `ConversationActivities` — `apps/api/src/platform/db.types.gen.ts`
- [ ] Add the `assignment-statuses migrations` block: every rejection of the audit's list (status `archived`, negative version / counter, foreign-workspace assignee, automatic `closed`, `assigned` by deactivation, member entry without actor, automatic entry with actor, reassign to the same member, `closed` with an assignee, foreign actor), the accepted rows, revert `04`→`01` and re-apply — `apps/api/src/test/migrations.int.test.ts`
- [ ] Extend `insertConversation` (writes the four columns with defaults even before `05`), add `insertActivity`, extend `twoWorkspacesWithInbox` — `apps/api/src/test/fixtures/conversations.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Up applied twice | no-op (`IF NOT EXISTS`, constraints dropped and re-added, backfill touches only NULL rows) |
| Existing conversation with 3 messages | backfilled `open`, unassigned, version 0, counter 3 |
| Capture code still inserting without the new columns | allowed until `05` (columns nullable); T8 changes the insert and promotes `05` |
| Down `04` → `01` | schema back to the shared-inbox shape exactly (14 tables, `conversations` 8 columns) |

## Definition of Done

- [ ] Migrations 01–04 are promoted to live apps/api/migrations/, apply and revert cleanly on a fresh Postgres 16, the regenerated db.types.gen.ts is committed, the migrations integration test rejects every listed constraint violation, and insertConversation / insertActivity / twoWorkspacesWithInbox carry the new state.
- [ ] staged migrations 01–04 are promoted to live `apps/api/migrations/`, then apply and revert cleanly
- [ ] `pnpm test` stays green with the extended fixtures
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
