# Audit — data-model — shared-inbox — 2026-10-18

Mode: brownfield delta. Size M, route standard (from `sad.md` frontmatter / SAD §2). The run was autonomous: stage questions were decided with the defaults recorded below.

## Staged migrations

> **Migrations are staged.** They are not yet in the live `apps/api/migrations/` tree; `implement` promotes them.

| Ordinal | File pair (`docs/features/shared-inbox/migrations/`) | Kind |
|---|---|---|
| 01 | `01_add_memberships_active_since.{up,down}.sql` | expand: nullable column |
| 02 | `02_backfill_memberships_active_since.{up,down}.sql` | backfill: `active_since = created_at`; down is a no-op |
| 03 | `03_add_conversations_list_columns.{up,down}.sql` | expand: 3 nullable columns + the list index |
| 04 | `04_backfill_conversations_list_columns.{up,down}.sql` | backfill: newest `messages.received_at` (fallback `created_at`); down is a no-op |
| 05 | `05_create_replies.{up,down}.sql` | new table + 4 indexes |
| 06 | `06_create_reply_attempts.{up,down}.sql` | new table + 4 indexes |
| 07 | `07_create_read_marks.{up,down}.sql` | new table + 2 indexes |
| 08 | `08_add_messages_inbox_indexes.{up,down}.sql` | 2 indexes on an existing table |
| 09 | `09_contract_memberships_active_since.{up,down}.sql` | contract: `SET NOT NULL` |
| 10 | `10_contract_conversations_list_columns.{up,down}.sql` | contract: `SET NOT NULL` + `conversations_last_activity_at_check` |

**Promote-time hint.** The repo uses Kysely Migrator via kysely-ctl, with files named `<timestamp>_<name>.ts`. The latest is `1791681109982_create_messages.ts`, so the next timestamp is ≈ `1791681109983`. `implement` assigns the real values at promotion, because another feature may promote first. Promote one TS migration per ordinal, in order, with the SQL inline in `` sql`…`.execute(db) `` and a header comment `// Promoted from docs/features/shared-inbox/migrations/NN_….{up,down}.sql.` (precedent: `1791681109982_create_messages.ts`). After promotion:

1. Run `pnpm db:migrate` → `pnpm db:codegen` and commit `db.types.gen.ts`.
2. Add a `shared-inbox migrations` block to `apps/api/src/test/migrations.int.test.ts` (revert + re-apply), like bot-connection's.

**Ordering with code (expand → backfill → contract).**
- `09` and `10` must not run before the code that writes `active_since` (join, reactivation, the first-owner CLI) and the conversation list columns (capture, reply marked sent) is in place.
- No production deployment exists yet (architecture map: deferred until the first pilot), so the feature may promote all ten in one release. The condition is that the contract migrations land in the same task or PR as that code and the fixture updates (`insertMembership`, `insertConversation`). Otherwise existing fixtures fail the NOT NULL.
- Once a live database exists, ship `09`/`10` one release after `01`–`08`.

## Verification (throwaway `postgres:16-alpine`, tmpfs, container removed)

- All 12 live migrations were applied first (SQL extracted from the TS files). Pre-existing data was then seeded: 2 workspaces, 1 membership, 2 conversations (one with messages, one without).
- Ups `01`–`10` applied, then applied a second time: idempotent (`IF NOT EXISTS`, the backfills touch only NULL rows, the CHECK is dropped and re-added).
- Backfill: the conversation with messages got its newest `received_at`; the one without got `created_at`. The membership got `created_at`.
- The constraint smoke test rejected all of these:
  - a blank body
  - a 4097-character body
  - `not_delivered` without a reason
  - `sent` without a Telegram id
  - a `retry` attempt with an initiator
  - an `accepted` attempt that never started
  - `last_reply_sent_at` moved without `last_activity_at`
  - a membership without `active_since`
- Accepted as intended:
  - a duplicate `client_key` with `ON CONFLICT DO NOTHING` kept 1 row
  - a `skipped` attempt with no start
  - the read-mark upsert with `GREATEST` did not move back
- `EXPLAIN` at spec scale (1 000 conversations, a 5 000-message + 700-reply thread):

  | Query | Plan |
  |---|---|
  | List page | index-only scan on `conversations_workspace_id_last_activity_at_idx` |
  | Unread count | `messages_conversation_id_received_at_idx` |
  | Thread messages | backward scan on `messages_conversation_id_sent_at_idx` |
  | Thread replies / teammate check | backward index-only scan on `replies_conversation_id_position_at_idx` |
  | Drain | index-only scan on `replies_pending_idx` |
  | Limit | index-only scan on `reply_attempts_workspace_id_initiator_created_at_idx` |
  | Pacing / in-flight | backward scan on `reply_attempts_conversation_id_started_at_idx` |
  | `read_marks` lookup | sequential scan only because the table held 1 row |

- Downs `10` → `01` restored the bot-connection schema exactly: 11 tables, no new columns, `messages` back to its 3 indexes. Ups applied again cleanly over the 1 000 seeded conversations.

## Conventions — sources and decisions

| Topic | Decision | Source |
|---|---|---|
| Naming | `snake_case`, plural tables, `<table>_<cols>_{pkey,key,fkey,check,idx}` | bot-connection / workspace-operators precedent |
| PK | `uuid` UUIDv7 from `newId()`, no DB default; `client_key` is a separate unique column | `CLAUDE.md`, SAD §8 ID strategy |
| Timestamps | app-supplied, no `DEFAULT now()`, no `updated_at` | precedent, SAD §8 Time and order |
| States / reasons / kinds | `text` + `CHECK IN`; state ↔ nullable-column `CHECK`s | precedent (`bots`, `memberships`) |
| Derived columns | written by the app in one statement, guarded by a `CHECK`; no triggers | `CLAUDE.md` (no triggers, constraints welcome) |
| Cross-module FK | `accounts(id)` referenced from `conversations`-owned tables, constraint only | `memberships.account_id` precedent |
| Tenancy | non-null `workspace_id` FK on every new table; no new controlled exception | `CLAUDE.md`, SAD §5 |
| Delete strategy | none (kept indefinitely) | SAD §11 |
| Breaking change | expand → backfill → contract for both NOT NULL additions | skill rule, architecture map §Constraints |

## Deviations and additions vs SAD §5 ("names indicative")

1. **The "last shown item" is not stored on `conversations`.** It is derived from two indexed reads: the newest message by arrival, and the newest sent reply. Storing a pointer would mean:
   - circular FKs (`conversations ↔ messages/replies`);
   - two FK indexes that serve no query;
   - a row refresh on every edit.

   The derived form reuses indexes the list already needs for unread counts and the thread.
2. **`reply_attempts.conversation_id`** was added. SAD flow 9 reads attempts "by (conversation, in flight, started)" for the stale in-flight check and the 1 s per-chat pace.
3. **"Initiated by (member / automatic)"** is modelled as `kind` (`send` / `try_again` / `send_again` / `retry`) + `initiated_by_account_id`. The spec §6 duplicate reconciliation must tell a confirmed "send again" apart, and a "Try again" may be pressed by a member other than the author, who is the one charged against the limit.
4. **No contacts schema change.** Search scans one workspace's contacts, bounded by the leading `workspace_id` of the existing unique. SAD §7 sets the trigram-index threshold at ~10 000 contacts per workspace.
5. **`failure_reason`** keeps `chat_not_found` separate from `customer_account_gone`, because the gateway classifies them separately (ADR-0004). It also adds `delivery_interrupted` for never-attempted replies of a dead-lettered drain. That case was flagged by `sequences` in SAD §6 and is not yet reconciled by `design`, so the reason exists in the schema while its UI text is left to `screens`. If `design` instead decides those replies reuse `telegram_not_accepted`, drop the value before promotion.
6. **`replies.sent_at` is our clock at acceptance**, not Telegram's `date`. That way the "waiting" marker and `last_activity_at` compare two server-clock times, like `received_at`.
7. **`read_marks` is keyed by `account_id`**, not membership. This matches `replies.author_account_id` and the guard's account. The workspace comes from `workspace_id` + the conversation.
8. **No `CREATE INDEX CONCURRENTLY`** on `messages` / `conversations`. The Kysely Migrator wraps every migration in a transaction, and the repo does not set `disableTransactions`. The tables are pre-pilot sized. Once production data exists, an index on a large existing table needs a non-transactional migration path; record that as a decision when it first happens.
9. **The `active_since` backfill uses `created_at`.** A membership reactivated before this step therefore gets an earlier floor than the truth, so older messages could show as unread until the member opens the conversation. This only affects pre-pilot data.
10. **No time-order `CHECK`s across processes** (e.g. `started_at >= created_at`). The request and the drain may run on different instances with slight clock skew, and a `CHECK` there would turn skew into a 5xx.

There are no conflicts between the architecture and the repo.

## Drift

None. `conversations/infra` (`conversation-repo.ts`, `message-repo.ts`) and `workspaces/infra/membership-repo.ts` map exactly to the generated `Conversations`, `Messages` and `Memberships` interfaces (`db.types.gen.ts`). `MESSAGE_KINDS` matches `messages_kind_check`. No `_drift/` files.

## Breaking-change decompositions

- `memberships.active_since`: `01` expand → `02` backfill → `09` contract.
- `conversations.last_activity_at` / `last_message_received_at`: `03` expand → `04` backfill → `10` contract. `last_reply_sent_at` stays nullable, so it needs no contract.

## Open items (`<!-- TBD -->`)

- None in `data-model.md`.
- `delivery_interrupted` depends on the open SAD §6 flag (deviation 5).
- Spec §8 OQs need no schema now. Editing replies would later add an edited state or column on `replies`; muting would add a per-conversation flag.

## Self-check

| Check | Result |
|---|---|
| Naming matches the repo convention | pass |
| Down reversibility | pass. Every ADD COLUMN, CREATE TABLE, CREATE INDEX and ADD CONSTRAINT has its drop, and SET NOT NULL has DROP NOT NULL. The backfills' downs are no-ops, because their values go with the column. Verified by running downs `10` → `01` and re-applying |
| FK indexes | pass. Every FK leads an index: `replies` (conversation via the client-key unique, workspace, author); `reply_attempts` (workspace via the limit index, conversation, reply, initiator partial); `read_marks` (conversation via the unique, workspace, account) |
| Convention adherence | pass. Deviations are listed above |
| Mermaid `erDiagram` | structural lint pass (`mmdc` not installed): cardinality glyphs `\|\|--o{` and `\|o--o{`; attribute lines are `type name [PK\|FK\|UK] "comment"` |
| PII in seeds / fixtures | pass. No seeds; fixtures use `Test User`, `@example.test` and synthetic ids |

## Next stage

`/sdd:api shared-inbox`. The feature adds endpoints, a socket and signals, so the contract changes and `api` cannot be skipped.
