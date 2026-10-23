# Audit — data-model — operator-notifications — 2026-10-19

Mode: brownfield delta. Size M, route standard (from the `sad.md` frontmatter and SAD §2). `target_surfaces: [backend-service, web-frontend]`. This was an autonomous run: every stage question was decided with the defaults recorded in `data-model.md` § Assumptions.

## Staged migrations

> **The migrations are staged.** They are not yet in the live `apps/api/migrations/` tree. `implement` promotes them.

| Ordinal | File pair (`docs/features/operator-notifications/migrations/`) | Kind |
|---|---|---|
| 01 | `01_add_conversations_waiting_period.{up,down}.sql` | expand: 2 nullable columns, 3 `CHECK`s (value, pair, closed ⇒ not waiting) |
| 02 | `02_backfill_conversations_waiting_period.{up,down}.sql` | backfill: the current period's start from replies, close and reopen entries, and messages. The down is a no-op |
| 03 | `03_add_conversations_waiting_index.{up,down}.sql` | 1 partial index on an existing table |
| 04 | `04_add_bots_send_paused_until.{up,down}.sql` | 1 nullable column on `bots` |
| 05 | `05_create_telegram_links.{up,down}.sql` | new table: 7 `CHECK`s, composite FK to `memberships`, 2 partial unique indexes and 1 index |
| 06 | `06_create_connect_links.{up,down}.sql` | new table: 6 `CHECK`s, composite FK, unique hash per workspace and 1 index |
| 07 | `07_create_tab_presences.{up,down}.sql` | new table: 2 `CHECK`s, composite FK and 1 index |
| 08 | `08_create_pings.{up,down}.sql` | 2 new tables (`pings`, `ping_items`): composite FKs, `ON DELETE CASCADE` for items, the ledger unique and 4 indexes |

There is no contract step. Both new `conversations` columns and `bots.send_paused_until` stay nullable by design (NULL = not waiting / not paused). Nothing becomes NOT NULL on an existing table, so no existing fixture or insert must change.

**Promote-time hint.** The repo uses Kysely Migrator via kysely-ctl, with files named `<timestamp>_<name>.ts`.
- The latest file is `1791681109997_contract_conversations_state_columns.ts`, so the next timestamp is ≈ `1791681109998`. `implement` assigns the real values at promotion, because another feature may promote first.
- Promote one TS migration per ordinal, in order (8 files).
- Put the SQL inline in `` sql`…`.execute(db) ``, with the header comment `// Promoted from docs/features/operator-notifications/migrations/NN_….{up,down}.sql.` (precedent: `1791681109995_create_conversation_activities.ts`).
- The SQL holds no backslash, backtick or `${`, so no template-literal escaping is needed.

After promotion:

1. Run `pnpm db:migrate` → `pnpm db:codegen` and commit `db.types.gen.ts`. `Conversations` gains `waiting_since` and `waiting_started_by`. `Bots` gains `send_paused_until`. The new interfaces are `TelegramLinks`, `ConnectLinks`, `TabPresences`, `Pings` and `PingItems` (Telegram ids map to `Int8`).
2. Add an `operator-notifications migrations` block to `apps/api/src/test/migrations.int.test.ts`, like assignment-statuses'. It should cover the backfill shapes, a constraint smoke test, and a revert and re-apply.
3. Update `CLAUDE.md` and `docs/architecture-map.md`: the sixth controlled tenancy exception (*workspaces with a live Telegram link*, served by a live partial index) and the new tables under `notifications` (SAD §11).

**Ordering with code (expand → backfill).**
- Promote `01`–`03` with the `conversations` code that maintains the period: capture, settle, close, member reopen and failed-reply reopen (ADR-0007).
- `02` touches only rows that are open, waiting and still NULL, so a re-run after deploying that code fills any row that changed in the gap. Under the new code an open waiting conversation always has a start, so the re-run is safe.
- `04` goes with `bots.sendMemberMessage` and the `429` mapping. `05`–`08` go with the `notifications` module.
- No production deployment exists yet (architecture map: deferred until the first pilot), so all eight can promote in one release. The interceptor and the connect routes must ship together (SAD §11).

## Verification (throwaway `postgres:16-alpine`, tmpfs, container removed)

- **Setup.** All 27 live migrations were applied first, with the SQL extracted from the TS files. Pre-existing data was seeded: 2 workspaces, 3 accounts and memberships, and 10 conversations with messages, sent-reply times, close entries and reopen entries (member, customer, failed reply).
- **Idempotence.** Ups `01`–`08` were applied, then applied a second time (`IF NOT EXISTS`, constraints dropped and re-added, the backfill touches only NULL rows).
- **Backfill.** It matched the expected start on all 10 history shapes:

  | # | History (minutes) | Result |
  |---|---|---|
  | 1 | message 1, no reply | `message` @ 1 |
  | 2 | message 1, reply 2 | NULL (answered) |
  | 3 | message 1, reply 2, messages 3, 4 | `message` @ 3 |
  | 4 | message 1, closed | NULL (closed) |
  | 5 | message 1, close 2, member reopen 3 | `reopen` @ 3 |
  | 6 | message 1, reply 2, close 3, member reopen 4 | NULL (customer not waiting at the reopen) |
  | 7 | message 1, close 2, customer reopen with message 3 | `message` @ 3 |
  | 8 | message 1, close 2, failed-reply reopen 3 | `reopen` @ 3 |
  | 9 | message 1, reply 2, close 3, reopen 4, message 5 | `message` @ 5 |
  | 10 | messages 1, 2, close 3, reopen 4, close 5, reopen 6 | `reopen` @ 6 |

- **Rejected as intended:**
  - `conversations`:
    - an unknown start kind;
    - a start without a kind;
    - a closed conversation that is still waiting.
  - `telegram_links`:
    - a second live link for a membership;
    - one Telegram user linked to two members of one workspace;
    - an account of another workspace;
    - a live link without a Telegram id or without a name;
    - a removed link that keeps its name;
    - removed with no reason;
    - deactivated or bot-replaced while keeping the Telegram id;
    - an unknown reason;
    - blocked before linked.
  - `connect_links`:
    - a duplicate hash in one workspace;
    - a 1-byte hash;
    - an expiry not after creation;
    - an account of another workspace;
    - used and replaced at once.
  - `tab_presences`:
    - an account of another workspace;
    - a lease that is not after the open.
  - `pings`:
    - an unknown outcome (`rate_limited`);
    - an account of another workspace;
    - opened before created.
  - `ping_items`:
    - a second item for the same member, conversation and period;
    - an item whose member differs from its ping's.
- **Accepted as intended:**
  - closing ends the period;
  - a reopen starts a `reopen` period;
  - the same Telegram user linked in another workspace;
  - a member-removed link that keeps its Telegram id until the answer job clears it;
  - re-linking after a removal (the partial uniques free both sides);
  - bot-replaced removal with both ids cleared;
  - a hidden-on-open lease with no `last_on_screen_at`;
  - a second item for the next period;
  - the rollout `DELETE` of a ping removed its items by cascade (0 left).
- **`EXPLAIN`** with 6 000 conversations (1 000 in one workspace, 107 of them waiting), 53 live links and 1 000 presence rows:
  - the sweep read is a bitmap scan on `conversations_workspace_id_waiting_since_idx`, 107 rows;
  - the away predicate is an index scan on `tab_presences_workspace_id_account_id_live_until_idx`.

  On the small tables the planner chose sequential scans, so their plans were re-checked with `enable_seqscan = off`. Each query is then served by its intended index:

  | Query | Index |
  |---|---|
  | Interceptor | `telegram_links_live_workspace_id_telegram_user_id_key` |
  | Cron backstop | index-only scan of a live partial index |
  | Bot-connected hook | workspace prefix of `telegram_links_workspace_id_account_id_idx` |
  | Presence expiry delete | `tab_presences_workspace_id_account_id_live_until_idx` |
  | Ping spacing | backward scan of `pings_workspace_id_account_id_created_at_idx` |
  | Ledger read | index-only scan of `ping_items_conversation_id_waiting_since_account_id_key` |

  On the 1-row `connect_links` table, the planner swapped the two connect-link indexes between the redeem and limit queries. Both are workspace-prefixed. Re-check at realistic sizes in the integration suite.
- **Downs** `08` → `01` restored the live schema exactly: the `pg_dump -s` diff against a fresh database with only the 27 live migrations is empty. The ups then applied again cleanly over the seeded data.
- **Mermaid.** The `erDiagram` rendered with `@mermaid-js/mermaid-cli` (exit 0).

## Conventions: sources and decisions

| Topic | Decision | Source |
|---|---|---|
| Naming | `snake_case`, plural tables, `<table>_<cols>_{pkey,key,fkey,check,idx}`. Composite FK to memberships `<table>_membership_fkey`, live partial uniques `<table>_live_<cols>_key` | precedent |
| PK | `uuid` UUIDv7 from `newId()`, no DB default. The presence id is the hub's per-socket id | `CLAUDE.md`, SAD §8 |
| Values and timestamps | app-supplied, no `DEFAULT`, no `updated_at` | precedent, SAD §8 |
| Telegram ids | `bigint`, never keys | `CLAUDE.md` |
| Kinds, reasons, outcomes | `text` + `CHECK IN`, combinations tied by `CHECK`s | precedent |
| Secret hashes | `bytea`, `octet_length = 32` | precedent (`sessions`, `invitations`) |
| Cross-module FK | composite `(workspace_id, account_id) → memberships`, constraint only | assignment-statuses, SAD §5 |
| Tenancy | non-null `workspace_id` FK on every new table. One new controlled exception, as the SAD records | `CLAUDE.md`, SAD §8, ADR-0005 |
| Delete strategy | keep links, connect links, pings and items. Hard-delete presence rows, and pings not accepted by Telegram (cascade) | SAD §2, ADR-0002, ADR-0006 |
| Breaking change | none. Expand + backfill only, no NOT NULL on an existing table | ADR-0007 |
| Existing-table index | plain `CREATE INDEX` (the Kysely Migrator wraps each migration in a transaction, and tables are pre-pilot size) | shared-inbox deviation 8, assignment-statuses deviation 5 |

There are no conflicts between the architecture and the repo.

## Deviations and additions vs SAD §5 ("names indicative")

1. **`reachable (ok / blocked)` became `blocked_at timestamptz NULL`.** It holds the state and the time in one column. The KPI history comes from `blocked` pings (data-model assumption 2).
2. **`telegram_user_id` survives a member's own Disconnect until the answer job clears it** (assumption 3). This answers the "Flagged by sequences" item on flow 9 in favour of carrying the link id. SAD §2 "cleared at removal" becomes "cleared at removal, or by the notifications-off answer job right after a member's own Disconnect". **The security review must confirm** this, and also that answers to unlinked senders ("link expired", "cannot connect") carry a Telegram user id in the pg-boss job until pg-boss deletes it.
3. **`ping_items` gets an `id` PK and a composite FK to `pings (id, workspace_id, account_id)`**, plus a unique key on `pings` to back it. The ledger unique is ordered `(conversation_id, waiting_since, account_id)`, not `(workspace_id, account_id, conversation_id, waiting_since)`. That order serves the sweep's read across members and the conversation FK. The conversation id already fixes the workspace.
4. **`telegram_links.removed_reason` + `removed_at`** are kept as the SAD gives them. A `telegram_links_workspace_id_account_id_idx` over all rows is added as the FK index, because the partial uniques cover only live rows.
5. **`(workspace_id, telegram_bot_id)` and `tab_presences (workspace_id, live_until)` are not created** (assumption 9), and `EXPLAIN` confirmed the reuse.
6. **`conversations_waiting_open_check`** (`status = 'open' OR waiting_since IS NULL`) is added beyond the SAD. It is the DB's guard that a close ends the period.
7. **The SAD §7 KPI "answered within 15 minutes"** cannot read ended periods from `waiting_since`, which is cleared at the end. It is a run-book query that derives periods the way `02` does (assumption 5). There is no history table, so nothing is added "just in case".
8. **Expired presence rows in workspaces without a sweep** are deleted on the member's next open (assumption 10). This is a use-case detail for `tasks`.

## New integrity queries for the run book (SAD §7)

- A link removed by its member that still holds `telegram_user_id` more than 1 hour after `removed_at`. This catches a dead-lettered notifications-off job, and an ops task clears the id.
- Live links whose `telegram_bot_id` differs from the workspace's current bot (already in SAD §7). Served by the live partial index plus `bots_workspace_id_key`.
- Open conversations that are waiting by the shared-inbox marker but have `waiting_since IS NULL`. This catches a write path that forgot the period.

## Drift

None. The code for the new columns and tables does not exist yet, and its writers are listed under "Ordering with code". The existing `conversations/infra/conversation-repo.ts`, `bots` repositories and the `insertConversation` / `insertBot` fixtures map exactly to the generated interfaces (`db.types.gen.ts`). The added columns are nullable, so they cause no insert drift. No `_drift/` files.

## Breaking-change decompositions

- `conversations.waiting_since` / `waiting_started_by`: `01` expand → `02` backfill. There is no contract, because the columns stay nullable by design.

## Open items (`<!-- TBD -->`)

- None in `data-model.md`.
- Security review: retention of the Telegram user id in the job table and on member-removed links (deviation 2).
- Spec §8 open questions need no schema now:
  - quiet hours would be one more due-rule condition;
  - per-workspace thresholds would be a settings column, added when decided;
  - a message preview in pings would be a text-builder input, with no stored text.

## Self-check

| Check | Result |
|---|---|
| Naming matches the repo convention | pass |
| Down reversibility | pass. Every ADD COLUMN, ADD CONSTRAINT, CREATE TABLE and CREATE INDEX has its drop. The backfill's down is a no-op, because its values go with the columns. Verified by running downs `08` → `01` (empty schema diff) and re-applying |
| FK indexes | pass. `telegram_links`: workspace and membership via `…_workspace_id_account_id_idx`. `connect_links` / `tab_presences` / `pings`: workspace and membership via their `(workspace_id, account_id, …)` index. `pings.telegram_link_id` via `pings_telegram_link_id_idx`. `ping_items`: the ping composite via `ping_items_ping_id_idx`, the conversation via the ledger unique and the workspace via `ping_items_workspace_id_idx` |
| Convention adherence | pass. Deviations from the SAD's indicative names are listed above. There are no deviations from repo conventions |
| Mermaid `erDiagram` | pass (`mmdc` render) |
| PII in seeds and fixtures | pass. There are no seeds. Fixtures and the verification seed use `Test User`, `@example.test` and synthetic ids |

## Next stage

`/sdd:api operator-notifications`. The feature adds notifications routes, the attention route, a live frame and a client frame, so the contract changes and `api` cannot be skipped.
