# Audit — data-model — broadcasts — 2026-10-23

Mode: brownfield delta. Size L, route full (from `.size` / `.route`). `target_surfaces: [backend-service, web-frontend]`. This was an autonomous run: every stage question was decided with the defaults recorded in `data-model.md` § Assumptions, consistently with SAD §4/§5/§8 and ADR-0001…0012.

## Staged migrations

> **The migrations are staged.** They are not yet in the live `apps/api/migrations/` tree. `implement` promotes them.

| Ordinal | File pair (`docs/features/broadcasts/migrations/`) | Module | Kind |
|---|---|---|---|
| 01 | `01_create_contact_bot_reach.{up,down}.sql` | contacts | new table: natural composite PK, composite FK to `contacts`, 2 `CHECK`s |
| 02 | `02_backfill_contact_bot_reach.{up,down}.sql` | contacts | backfill: a "wrote" row per contact that wrote, for its workspace's bot row (any state). Re-runnable (`ON CONFLICT DO NOTHING`). The down is a no-op |
| 03 | `03_add_conversations_workspace_id_id_key.{up,down}.sql` | conversations | 1 unique index on an existing table, the target of the items FK |
| 04 | `04_create_broadcasts.{up,down}.sql` | broadcasts | new table: unique `(workspace_id, id)`, 4 composite FKs to `memberships`, 10 `CHECK`s, 7 indexes |
| 05 | `05_create_broadcast_audience_tags.{up,down}.sql` | broadcasts | new table: natural PK, composite FK to `broadcasts`, no FK to `tags`, 2 `CHECK`s |
| 06 | `06_create_broadcast_group_contacts.{up,down}.sql` | broadcasts | new table: natural PK, composite FKs to `broadcasts`, `contacts`, `memberships`, 3 indexes |
| 07 | `07_create_broadcast_recipients.{up,down}.sql` | broadcasts | new table: 2 uniques, composite FKs to `broadcasts`, `contacts`, 7 `CHECK`s, 2 indexes |
| 08 | `08_create_broadcast_items.{up,down}.sql` | conversations | new table: unique per broadcast and conversation, composite FKs to `conversations`, `broadcasts`, 2 `CHECK`s, 1 index |

There is no contract step and no NOT NULL on an existing table. No existing fixture or insert must change.

**Promote-time hint.** The repo uses the Kysely Migrator via kysely-ctl, with files named `<timestamp>_<name>.ts`.
- The latest live file is `1791681110011_create_contact_tag_history.ts`, so the next timestamp is ≈ `1791681110012`. `implement` assigns the real values at promotion, because another feature may promote first.
- Promote one TS migration per ordinal, in order (8 files), with the SQL inline in `` sql`…`.execute(db) `` and the header comment `// Promoted from docs/features/broadcasts/migrations/NN_….{up,down}.sql.` (precedent: `1791681110011_create_contact_tag_history.ts`).
- The staged SQL holds no backtick, no `${` and no backslash, so no template-literal escaping is needed.
- The Kysely Migrator wraps every migration in a transaction, so 03 uses a plain `CREATE UNIQUE INDEX` (no `CONCURRENTLY`). Pre-pilot table sizes.

After promotion:

1. Run `pnpm db:migrate` → `pnpm db:codegen` and commit `db.types.gen.ts`. New interfaces: `Broadcasts`, `BroadcastAudienceTags`, `BroadcastGroupContacts`, `BroadcastRecipients`, `BroadcastItems`, `ContactBotReach`.
2. Add a `broadcasts migrations` block to `apps/api/src/test/migrations.int.test.ts`, like the contacts one: the backfill shapes, a constraint smoke test, and a revert and re-apply.
3. Update `CLAUDE.md` and `docs/architecture-map.md` with the new module, its tables, `contact_bot_reach` under `contacts` and `broadcast_items` under `conversations`.

**Ordering with code (expand → backfill).**
- `01`–`02` go with capture's `upsertFromProfile(…, telegramBotId)` writing reach rows (ADR-0002). `02` is re-runnable: run after that deploy, it keeps the rows capture wrote and fills the rest.
- `03` and `08` go with `conversations.recordBroadcastItem` and the thread kind `broadcast`.
- `04`–`07` go with the `broadcasts` module. `08` needs `04` (FK to `broadcasts`).
- All eight can promote in one release (no production deployment yet, architecture map).

## Verification (throwaway `postgres:16-alpine`, tmpfs, `--rm`, container removed)

- **Setup.** All 41 live migrations were applied first, with the SQL extracted from the TS files, to two databases (`tg` and an untouched `base`). Pre-existing data was seeded in `tg`: 3 workspaces, 3 accounts and memberships, a `connected` bot (9001) in A, a `disconnected` bot row (9002) in B, no bot in C, 4 contacts (A1 wrote 02-01…02-03, A2 never wrote, B1 wrote, C1 wrote), 2 conversations.
- **Idempotence.** Ups `01`–`08` were applied, then applied a second time. Both passes succeeded.
- **Backfill.** It matched the expected values on all 4 shapes:

  | Contact | Shape | Row |
  |---|---|---|
  | A1 | wrote, bot connected | `(9001, wrote 02-01 10:00, not blocked, changed 02-03 10:00)` |
  | A2 | never wrote | none |
  | B1 | wrote, bot row disconnected | `(9002, wrote 02-09 09:00, changed 02-09 09:00)`: reconnecting the same Telegram bot keeps it |
  | C1 | wrote, no bot row | none |

- **Rejected as intended (48 cases)**, among them:
  - `broadcasts`: an unknown status; version 0; an empty or untidy name; untidy text; 4 097 code points; a launched broadcast with empty text; a group with a tag mode and a tag audience without one (this case first passed because `NULL IN (…)` is unknown, and `broadcasts_tag_mode_check` was fixed with `tag_mode IS NOT NULL`); a draft with `launched_at`; `sending` without the frozen counts; a breakdown that does not add up, with no recipient, or over 10 000; `stopped` without who; `sent` without an end, or with reason `stopped`; an author or launcher of another workspace (composite FKs).
  - `broadcast_audience_tags`: an unknown kind; an empty name; another workspace's broadcast; the same tag chosen and left out (`…_pkey`).
  - `broadcast_group_contacts`: another workspace's contact, draft or adder; the same contact twice.
  - `broadcast_recipients`: another workspace's contact; the same contact or position twice; position 0; failed without a reason; delivered with a reason, without a claim or without a message id; an unknown reason; waiting with a claim; sending with an outcome time; stopped without one.
  - `broadcast_items`: another workspace's conversation or broadcast; two items for one broadcast and conversation; delivered without a message id; an unknown state; deleting a conversation that has an item.
  - `contact_bot_reach`: another workspace's contact; `blocked_at` after `changed_at`; the same contact and bot twice.
- **Accepted as intended (15 cases):** a draft with empty text; a group audience; 2 048 emoji (4 096 UTF-16 units, 2 048 code points); a stopped broadcast with its owner; an aborted `sent` with `bot_stopped`; the same name in two drafts; include and exclude rows for tags that do not exist (no FK); a second group add as a no-op (`ON CONFLICT DO NOTHING`); claim → rate limit back to `waiting` → claim → delivered with its item; an abort settling waiting recipients as `failed`/`bot_stopped` without a claim; blocked at the turn without a claim; a stale in-flight recipient resolved to `not_confirmed` with an item at its claim time; capture's upsert for a new bot, then a block, then an older message ignored by the `changed_at` guard; a block notice for a contact who never wrote through that bot; deleting a draft with its tag and group rows.
- **`EXPLAIN (ANALYZE)`** with 15 004 contacts (10 002 in one workspace), 7 102 tag links, 19 804 reach rows (two bots, 300 blocked, 200 never wrote), 34 broadcasts, a 10 000-contact group and a launched broadcast with 9 503 recipients:

  | Query | Plan | Time |
  |---|---|---|
  | Tag breakdown: any of 2 tags, 1 left out, current bot | hash semi / anti joins, reach by hash join | 12.1 ms |
  | Tag breakdown: no tag (every contact) | hash join | 5.9 ms |
  | Add all matching: 10 000 group rows | insert `ON CONFLICT DO NOTHING` | 436 ms |
  | Group breakdown: 10 000 contacts | hash join | 6.2 ms |
  | Group page, newest added | index-only `broadcast_group_contacts_added_at_idx` | 0.08 ms |
  | "Which of these 50 are in the group" | `broadcast_group_contacts_workspace_id_contact_id_idx` | 0.18 ms |
  | Launch: frozen breakdown + 9 503 recipients in one transaction | insert from the group joined to contacts and reach | 306 ms (target 2 s) |
  | Launch cap, last 24 h | index-only backward `broadcasts_workspace_id_launched_at_idx` | 0.04 ms |
  | Link's sending broadcasts | `broadcasts_sending_idx` | 0.04 ms |
  | Next waiting recipient, early in the broadcast | `broadcast_recipients_broadcast_position_key` + filter, 1 row | 0.03 ms |
  | Next waiting recipient after 9 000 delivered | `broadcast_recipients_state_position_idx` | 1.2 ms |
  | Claim (conditional single-row update) | pkey | 0.26 ms |
  | Stale in-flight of the sending broadcasts | `broadcast_recipients_state_position_idx` | 0.02 ms |
  | Totals by state | seq scan of 9 503 rows (whole table is this broadcast) | 2.3–2.7 ms |
  | Report page after a position | `broadcast_recipients_broadcast_position_key` | 0.05 ms |
  | Report narrowed to one outcome | `broadcast_recipients_state_position_idx` | 0.26 ms |
  | Stop: settle 503 waiting | bitmap on `…_state_position_idx` | 11 ms |
  | "Did not reach" set | bitmap on `…_state_position_idx` (two arms) | 1.5 ms |
  | Thread's broadcast items before a cursor | backward `broadcast_items_conversation_position_at_idx` | 0.12 ms |
  | Reach of one contact for the launch bot | `contact_bot_reach_pkey` | 0.09 ms |

  On the 34-row `broadcasts` table the planner chose sequential scans, so those plans were re-checked with `enable_seqscan = off`. The totals read scans the table only because the table holds one broadcast; with many broadcasts it uses the `state_position` index prefix.
- **Reversibility.** Downs `08` → `01` were run, then `pg_dump -s` was compared with `base`: the only difference is pg_dump's random `\restrict` token, so the schema diff is **empty**. Ups `01`–`08` were re-applied afterwards; the backfill wrote 15 002 rows, one per contact with a send time in a workspace with a bot row.

## Deviations from the SAD (`sad.md` §4/§5/§6 names are indicative)

1. **No `id` on `contact_bot_reach`, `broadcast_group_contacts`, `broadcast_audience_tags`** (assumption 2). SAD §8's ID row lists group and reach rows among the UUIDv7 ids; their natural keys are the PKs instead (the `contact_tags` precedent), and the backfill needs no ids.
2. **`last_changed_at` / `last_changed_by_account_id`** name the SAD's "last changed by / at"; the sequences flag's index on `updated_at` is `broadcasts_workspace_id_last_changed_at_idx`.
3. **`end_reason` and `ended_at`** are explicit columns (assumption 9). The SAD named "finished at, end reason".
4. **Frozen breakdown columns** (`audience_size`, `blocked_count`, `never_wrote_count`, `recipient_count`) are added per the sequences flag, with a `CHECK` that they add up.
5. **The broadcast items thread index leads with `workspace_id`** (`(workspace_id, conversation_id, position_at, id)`), unlike the older thread indexes on `(conversation_id, position_at, id)`. It is also the FK index of the composite conversation FK. The thread query already filters by both.
6. **A new unique index on `conversations (workspace_id, id)`** is needed as the composite FK target. SAD §8 asks for composite FKs to `conversations`; no such key existed.

## Code-level findings for `tasks` (no schema change)

- **`contacts.upsertFromProfile` gains `telegramBotId`** (ADR-0002). `contacts/infra/contact-repo.ts` then upserts `contact_bot_reach` in the same transaction: `wrote_at = LEAST(stored, sentAt)`, and when `sentAt >= changed_at`, clear `blocked_at` and set `changed_at = sentAt`. Capture must pass the receiving bot's Telegram id (the webhook resolves the bot row first, so it is at hand). `contacts/app/fakes.ts` follows.
- **`recordBlockChange` applies a fact only when `at >= changed_at`** (`INSERT … ON CONFLICT … DO UPDATE … WHERE contact_bot_reach.changed_at <= excluded.changed_at`). A missing contact (a linked member who is not a contact) is a no-op (ADR-0003).
- **The thread's `KIND_ORDER`** (`conversations/domain/thread.ts`) gains `broadcast` after `activity`. The cursor's `kind` and the item union gain it too, and `thread-queries.ts` adds a fourth keyset half on `broadcast_items_conversation_position_at_idx`.
- **The launch inserts up to 10 000 recipients with app-generated UUIDv7 ids**: use one `INSERT … SELECT … FROM unnest($ids, $contact_ids, $positions, $user_ids)`, not 10 000 statements (measured above at ~300 ms with a join).
- **Recipient position** = rank of the contact id in the sorted reachable set, the same sort as the fingerprint (ADR-0006), so the fingerprint and the positions come from one ordered read.

## New integrity queries for the run book (SAD §8)

The SAD's `broadcastIntegrity.*` list holds. Two are now enforced by the schema and stay as smoke checks: "more than one broadcast item per recipient" (`broadcast_items_broadcast_conversation_key`) and "group rows or recipients of another workspace" (composite FKs). Two more are added:
- launched broadcasts whose `recipient_count` differs from their recipient rows;
- recipients `delivered` / `not_confirmed` with no broadcast item for their contact's conversation (the SAD's last item), joined through `conversations_contact_id_key`.

## Drift

None. The tables are new, and their writers do not exist yet. The existing `contacts/infra/contact-repo.ts`, `conversations/infra/thread-queries.ts` and the fixtures map exactly to the generated interfaces (`db.types.gen.ts`). The only change to an existing table is a unique index, which causes no insert drift. The `upsertFromProfile` signature change is a behaviour change for `tasks`, not a field-to-column drift. No `_drift/` files.

## Breaking-change decompositions

- `contact_bot_reach`: `01` create → `02` backfill. No contract: nothing on an existing table changes.
- `conversations`: `03` adds a unique index only.

## Open items (`<!-- TBD -->`)

- None in `data-model.md`.
- Spec §8 OQ-1 (recent or opted-in audiences) needs no schema: one more predicate on `contacts.last_wrote_at` or a future opt-in column.
- Spec §8 OQ-4 (contact removal): the erasure order is reach rows, group rows, recipients, items (via the contact's conversation), contact tags, history, then the contact; or `ON DELETE CASCADE` on the composite FKs to `contacts`, decided with that feature.
- Security review: recipients, outcomes and reach rows are new personal data about end customers (SAD §2). No columns beyond the SAD's were added apart from the frozen counts, position and `end_reason` (no personal content). The broadcast text is stored once on `broadcasts`, never per recipient or item.

## Self-check

| Check | Result |
|---|---|
| Naming matches the repo convention | pass |
| Down reversibility | pass. Every CREATE TABLE and CREATE INDEX has its drop; the backfill's down is a no-op because its rows go with the table. Verified by running downs `08` → `01` (empty schema diff) and re-applying |
| FK indexes | pass. Every composite FK leads an index: the PKs / uniques for `workspace_id` and the broadcast FKs; `…_workspace_id_contact_id_idx` for the contact FKs of group rows and recipients; `contact_bot_reach_pkey` for its contact FK; `broadcast_items_conversation_position_at_idx` and `…_broadcast_conversation_key` for the items' FKs; one index per member FK of `broadcasts` and `broadcast_group_contacts` |
| Convention adherence | pass. Deviations from the SAD's indicative names are listed above. No deviation from repo conventions (UUIDv7 from the app, non-null `workspace_id`, `text` + `CHECK`, no `DEFAULT`, no triggers, composite FKs to `memberships`, natural PKs for link tables) |
| Mermaid `erDiagram` | pass (`mmdc` render) |
| PII in seeds and fixtures | pass. There are no seeds. Fixtures and the verification seed use `Test User`, `@example.test` and synthetic ids |

## Next stage

`/sdd:api broadcasts`. The feature adds the broadcasts routes, a group picker read, the inbox thread kind `broadcast`, `blocked_since` on the contacts reads and three live frame changes, so the contract changes and `api` cannot be skipped (route `full`).
