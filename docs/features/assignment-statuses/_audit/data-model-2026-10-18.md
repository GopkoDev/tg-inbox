# Audit — data-model — assignment-statuses — 2026-10-18

Mode: brownfield delta. Size M, route standard (from `sad.md` frontmatter / SAD §2). The run was autonomous: stage questions were decided with the defaults recorded in `data-model.md` § Assumptions.

## Staged migrations

> **Migrations are staged.** They are not yet in the live `apps/api/migrations/` tree; `implement` promotes them.

| Ordinal | File pair (`docs/features/assignment-statuses/migrations/`) | Kind |
|---|---|---|
| 01 | `01_add_conversations_state_columns.{up,down}.sql` | expand: 4 nullable columns, 3 value `CHECK`s, composite FK to `memberships` |
| 02 | `02_backfill_conversations_state_columns.{up,down}.sql` | backfill: `open` / version 0 / message count; down is a no-op |
| 03 | `03_create_conversation_activities.{up,down}.sql` | new table, 5 `CHECK`s, 3 composite FKs, 4 indexes |
| 04 | `04_add_conversations_lens_indexes.{up,down}.sql` | 2 indexes on an existing table |
| 05 | `05_contract_conversations_state_columns.{up,down}.sql` | contract: `SET NOT NULL` on `status`, `state_version`, `customer_message_seq` |

**Promote-time hint.** The repo uses Kysely Migrator via kysely-ctl, with files named `<timestamp>_<name>.ts`. The latest is `1791681109992_contract_conversations_list_columns.ts`, so the next timestamp is ≈ `1791681109993`. `implement` assigns the real values at promotion, because another feature may promote first. Promote one TS migration per ordinal, in order, with the SQL inline in `` sql`…`.execute(db) `` and a header comment `// Promoted from docs/features/assignment-statuses/migrations/NN_….{up,down}.sql.` (precedent: `1791681109985_add_conversations_list_columns.ts`). The SQL holds no backslashes, so no template-literal escaping is needed. After promotion:

1. Run `pnpm db:migrate` → `pnpm db:codegen` and commit `db.types.gen.ts` (`Conversations` gains four fields; a new `ConversationActivities` interface).
2. Add an `assignment-statuses migrations` block to `apps/api/src/test/migrations.int.test.ts` (constraint smoke + revert and re-apply), like shared-inbox's.

**Ordering with code (expand → backfill → contract).**
- `05` must not run before the code that writes the three columns: `conversation-repo.ts` capture insert (`status 'open'`, `state_version 0`, `customer_message_seq 0`), the capture raise of the counter, and the change paths. The `insertConversation` fixture must change in the same task, or existing integration tests fail the NOT NULL.
- No production deployment exists yet (architecture map: deferred until the first pilot), so all five may promote in one release, provided `05` lands in the same task or PR as that code. Once a live database exists, ship `05` one release after `01`–`04`.

## Verification (throwaway `postgres:16-alpine`, tmpfs, container removed)

- All 22 live migrations applied first (SQL extracted from the TS files). Pre-existing data seeded: 2 workspaces, 3 accounts and memberships, 3 conversations (one with 3 messages).
- Ups `01`–`05` applied, then applied a second time: idempotent (`IF NOT EXISTS`, constraints dropped and re-added, the backfill touches only NULL rows).
- Backfill: every row `open`, unassigned, version 0; the counter equals the message count (3 / 0 / 0).
- Rejected as intended:
  - `status = 'archived'`, `status = NULL` after contract, a negative version, a negative counter;
  - an assignee who is a member of another workspace (`conversations_workspace_id_assignee_account_id_fkey`);
  - activity: an automatic `closed`, an `assigned` caused by deactivation, a `member` entry with no actor, an automatic entry with an actor, a reassignment to the same member, `assigned` with a previous assignee, `unassigned` without one, `closed` with an assignee, an actor or new assignee of another workspace, an unknown kind.
- Accepted as intended: an assignee of the same workspace; `assigned`, `reassigned`, `closed` by a member; `unassigned` by deactivation; `reopened` by the customer and by a failed reply.
- `EXPLAIN ANALYZE` with 1 000 conversations in the workspace (⅓ closed, ⅓ per assignee / unassigned), 5 000 in other workspaces, and 3 000 activity entries in one conversation:

  | Query | Plan | Time |
  |---|---|---|
  | Open · all | index scan on `conversations_workspace_id_last_activity_at_idx` + status filter (planner's choice at this density) | 0.08 ms |
  | Closed · all | bitmap scan on `conversations_workspace_id_status_idx` | 0.25 ms |
  | Closed · mine | bitmap scan on `conversations_workspace_id_assignee_status_idx` | 0.16 ms |
  | Open · unassigned | index scan on the list index + filter | 0.06 ms |
  | Deactivation unassign (`FOR UPDATE`) | bitmap scan on `conversations_workspace_id_assignee_status_idx` | — |
  | Thread activity half | backward index scan on `conversation_activities_conversation_id_position_at_idx` | — |
  | Change-limit count | bitmap scan on `conversation_activities_workspace_id_actor_created_at_idx` | — |

  Every lens is far under the 500 ms target. For dense lenses the planner may keep using the existing list index with a filter; both plans stay index-bounded by `workspace_id`.
- Downs `05` → `01` restored the shared-inbox schema exactly: 14 tables, `conversations` back to 8 columns, 4 indexes and its original constraints. Ups applied again cleanly over the 6 000 seeded conversations.
- `erDiagram` rendered with `@mermaid-js/mermaid-cli` (exit 0).

## Conventions — sources and decisions

| Topic | Decision | Source |
|---|---|---|
| Naming | `snake_case`, plural tables, `<table>_<cols>_{pkey,key,fkey,check,idx}`; three activity FK names shortened to stay ≤ 63 characters | precedent |
| PK | `uuid` UUIDv7 from `newId()`, no DB default | `CLAUDE.md` |
| Values and timestamps | app-supplied, no `DEFAULT` (also none for `status`), no `updated_at` | precedent, SAD §8 |
| Kinds / causes / states | `text` + `CHECK IN`; combinations tied by `CHECK`s | precedent (`replies`, `reply_attempts`) |
| Counters | raised by the app in the same `UPDATE`; no triggers | `CLAUDE.md` |
| Cross-module FK | composite `(workspace_id, account) → memberships (workspace_id, account_id)`, constraint only | SAD §5, §11 |
| Tenancy | non-null `workspace_id` FK on the new table; no new controlled exception | `CLAUDE.md`, SAD §5 |
| Delete strategy | none (kept indefinitely) | precedent |
| Breaking change | expand → backfill → contract for the three NOT NULL columns | skill rule, architecture map |

## Deviations and additions vs SAD §5 ("names indicative")

1. **Activity actor / assignees use composite FKs to `memberships`**, not `accounts(id)` as `replies.author_account_id` does. That way the DB itself refuses a cross-workspace actor or assignee in history, matching the SAD's `conversations` FK.
2. **`conversation_activities.created_at`** was added beside `position_at`. The change limit counts on it (data-model assumption 4).
3. **Cause vocabulary fixed** as `member` / `customer_wrote` / `reply_not_delivered` / `member_deactivated`. "Not confirmed" reopens also use `reply_not_delivered`, because AC-08 renders one line for both. `api` and `screens` take these names.
4. **No `closed_at` and no stored "latest activity" pointer on `conversations`.** Both are one backward index read.
5. **No `CREATE INDEX CONCURRENTLY`** on `conversations` (Kysely Migrator wraps every migration in a transaction; pre-pilot table sizes), same as shared-inbox deviation 8.
6. **The SAD's thread index `(workspace, conversation, position time, id)`** is built as `(conversation_id, position_at, id)` with `workspace_id` as a filter, like `replies_conversation_id_position_at_idx`. The conversation id already fixes the workspace.
7. **No partial index for `status = 'open'`.** SAD §7 sets its threshold at ~50 000 conversations per workspace.

There are no conflicts between the architecture and the repo.

## Drift

None. `conversations/infra/conversation-repo.ts` and the `insertConversation` fixture map exactly to the generated `Conversations` interface (`db.types.gen.ts`). The new columns have no code yet; their writers are listed under "Ordering with code". No `_drift/` files.

## Breaking-change decompositions

- `conversations.status` / `state_version` / `customer_message_seq`: `01` expand → `02` backfill → `05` contract. `assignee_account_id` stays nullable and needs no contract.

## Open items (`<!-- TBD -->`)

- None in `data-model.md`.
- Spec §8 OQs need no schema now. "Auto-assign on first reply" would add a cause value; "short acknowledgements don't reopen" changes only capture's rule.

## Self-check

| Check | Result |
|---|---|
| Naming matches the repo convention | pass |
| Down reversibility | pass. Every ADD COLUMN, ADD CONSTRAINT, CREATE TABLE and CREATE INDEX has its drop, and SET NOT NULL has DROP NOT NULL. The backfill's down is a no-op, because its values go with the columns. Verified by running downs `05` → `01` and re-applying |
| FK indexes | pass. `conversations (workspace_id, assignee_account_id)` leads `…_assignee_status_idx`; `conversation_activities`: `conversation_id` via the thread index, `workspace_id` and the actor FK via the limit index, the two assignee FKs via partial indexes |
| Convention adherence | pass. Deviations are listed above |
| Mermaid `erDiagram` | pass (`mmdc` render) |
| PII in seeds / fixtures | pass. No seeds; fixtures use `Test User`, `@example.test` and synthetic ids |

## Next stage

`/sdd:api assignment-statuses`. The feature adds change routes, a members read, list lens parameters and a live item type, so the contract changes and `api` cannot be skipped.
