# Audit — data-model — contacts — 2026-10-19

Mode: brownfield delta. Size M, route standard (from `.size` / `.route`). `target_surfaces: [backend-service, web-frontend]`. This was an autonomous run: every stage question was decided with the defaults recorded in `data-model.md` § Assumptions.

## Staged migrations

> **The migrations are staged.** They are not yet in the live `apps/api/migrations/` tree. `implement` promotes them.

| Ordinal | File pair (`docs/features/contacts/migrations/`) | Kind |
|---|---|---|
| 01 | `01_add_contacts_wrote_times.{up,down}.sql` | expand: 2 nullable columns on `contacts`, 2 `CHECK`s (pair, order) |
| 02 | `02_backfill_contacts_wrote_times.{up,down}.sql` | backfill: min / max `messages.sent_at` per contact through its conversation, gap-safe (`LEAST` / `GREATEST`). The down is a no-op |
| 03 | `03_add_contacts_list_indexes.{up,down}.sql` | 2 indexes on an existing table: the list keyset and the unique `(workspace_id, id)` target of the composite FKs |
| 04 | `04_create_tags.{up,down}.sql` | new table: 2 uniques, composite FK to `memberships`, 2 `CHECK`s, 1 FK index |
| 05 | `05_create_contact_tags.{up,down}.sql` | new table: composite PK, composite FKs to `contacts`, `tags` and `memberships`, 2 indexes |
| 06 | `06_create_contact_tag_history.{up,down}.sql` | new table: composite FKs to `contacts` and `memberships`, 6 `CHECK`s, 2 indexes |

There is no contract step. `first_wrote_at` / `last_wrote_at` stay nullable by design (a contact whose messages are all gone has neither). Nothing becomes NOT NULL on an existing table, so no existing fixture or insert must change.

**Promote-time hint.** The repo uses Kysely Migrator via kysely-ctl, with files named `<timestamp>_<name>.ts`.
- The latest file is `1791681110005_add_conversations_waiting_index.ts`, so the next timestamp is ≈ `1791681110006`. `implement` assigns the real values at promotion, because another feature may promote first.
- Promote one TS migration per ordinal, in order (6 files).
- Put the SQL inline in `` sql`…`.execute(db) ``, with the header comment `// Promoted from docs/features/contacts/migrations/NN_….{up,down}.sql.` (precedent: `1791681110005_add_conversations_waiting_index.ts`).
- The SQL holds no backtick and no `${`, so no template-literal escaping is needed. (03's comment contains `$id` / `$t`, which are plain text in a template literal.)
- The Kysely Migrator wraps every migration in a transaction, so 03 uses a plain `CREATE INDEX` (no `CONCURRENTLY`). Pre-pilot table sizes; no production deployment exists yet (architecture map).

After promotion:

1. Run `pnpm db:migrate` → `pnpm db:codegen` and commit `db.types.gen.ts`. `Contacts` gains `first_wrote_at` and `last_wrote_at` (`Timestamp | null`). The new interfaces are `Tags`, `ContactTags` and `ContactTagHistory`.
2. Add a `contacts migrations` block to `apps/api/src/test/migrations.int.test.ts`, like operator-notifications': backfill shapes, a constraint smoke test, and a revert and re-apply.
3. Update `CLAUDE.md` and `docs/architecture-map.md` with the new tables under `contacts` and the `contacts → workspaces` edge (SAD §11).

**Ordering with code (expand → backfill).**
- Promote `01`–`03` with the capture change to `contacts.upsertFromProfile` that keeps first and last wrote (ADR-0005, flow 14). `02` is gap-safe, so it may run before or after that deploy, and a re-run after it fills any contact captured in the gap.
- `04`–`06` go with the tag use cases and routes.
- All six can promote in one release (no production deployment yet).

## Verification (throwaway `postgres:16-alpine`, tmpfs, `--rm`, container removed)

- **Setup.** All 35 live migrations were applied first, with the SQL extracted from the TS files. Pre-existing data was seeded: 2 workspaces, 3 accounts and memberships, 4 contacts (one with 3 messages incl. an edited one whose `received_at` differs from `sent_at`, one with a single photo, one with no conversation, one in the other workspace with the same Telegram user id), 3 conversations and 5 messages.
- **Idempotence.** Ups `01`–`06` were applied, then applied a second time. The first second-pass failed on 03 (`DROP CONSTRAINT IF EXISTS` on a constraint that 05 / 06 FKs depend on); 03 was changed to `CREATE UNIQUE INDEX IF NOT EXISTS` (data-model assumption 3) and both passes then succeeded.
- **Backfill.** It matched the expected values on all 4 shapes:

  | Contact | History | Result |
  |---|---|---|
  | A1 | messages sent 02-01 10:00, 02-02 10:00 (edited 02-05), 02-03 10:00 (received 02-04) | first 02-01 10:00, last 02-03 10:00 (send time, not arrival or edit) |
  | A2 | one photo 02-01 12:00 | first = last = 02-01 12:00 |
  | A3 | no conversation | NULL / NULL |
  | B1 | other workspace, same Telegram user, message 02-09 | its own 02-09 09:00, A's untouched |

- **Rejected as intended (20 cases):**
  - `tags`: a duplicate name key in the same workspace (`tags_workspace_id_name_key_key`); an untidy name ` VIP ` and an empty name (`tags_name_check`); a creator from another workspace (`tags_created_by_membership_fkey`).
  - `contact_tags`: the same link twice (`contact_tags_pkey`); another workspace's tag on a contact (`contact_tags_tag_fkey`); another workspace's contact with this workspace's tag (`contact_tags_contact_fkey`); a row that claims the other workspace with this workspace's tag (`contact_tags_tag_fkey`); an adder from another workspace (`contact_tags_added_by_membership_fkey`); deleting a tag that still has links (`contact_tags_tag_fkey`).
  - `contact_tag_history`: an unknown kind `renamed`; a member kind from `settings` and an owner kind from `inbox` (`…_kind_source_check`); a merge without a target, an `added` with a target, a target id without its name (`…_merged_into_check`); a contact and an actor of another workspace (composite FKs).
  - `contacts`: first after last (`contacts_wrote_order_check`); only one of the two times (`contacts_wrote_pair_check`).
- **Accepted as intended (10 cases):** the same name key in another workspace; history entries for `added`, for `merged` and for `deleted` whose tag no longer exists (no FK on `tag_id`); the capture `LEAST` / `GREATEST` update; a rename that keeps the id; the owner delete `DELETE … RETURNING contact_id` then the tag; a full set-based merge in one transaction (merged entries for 301 contacts, keep-earlier update, delete of duplicate links, re-point of the rest, delete of the merged tag, all under `FOR UPDATE` of both tag rows in id order).
- **ICU collation.** `und-x-icu` exists in `postgres:16-alpine` (the Testcontainers and compose image). Sample order: `ábaco | Apple | apple pie | banana | Zebra | Ёлка | єнот | Яблуко` (case-insensitive, accents grouped, each alphabet in its own order), as SAD §4 "Tag-list order" wants. SAD §11 risk row closed.
- **`EXPLAIN (ANALYZE)`** with 12 000 contacts (10 000 in one workspace), 100 tags, 29 409 links and 58 851 history entries (including a 29 409-row owner merge burst inside the 60 s window):

  | Query | Plan | Time |
  |---|---|---|
  | List first page | index-only scan `contacts_workspace_id_last_wrote_at_id_idx`, 50 rows | 0.1 ms |
  | List next page after a cursor | same index | 0.3 ms |
  | `any of` 2 tags, page | keyset index + `contact_tags_pkey` probes | 8.6 ms |
  | `any of` 2 tags, count | bitmap on `contact_tags_workspace_id_tag_id_contact_id_idx` | 3.6 ms |
  | `all of` 2 tags, count — correlated count per contact | `contact_tags_pkey` probed 10 003 times | **466 ms** |
  | `all of` 2 tags, count — grouped semi-join (assumption 10) | bitmap on `…_tag_id_contact_id_idx`, group, `contacts_pkey` | **3.8 ms** |
  | `all of`, page — grouped semi-join | same | 0.5 ms |
  | `no tags` count | hash anti-join | 11 ms |
  | Tag list with counts, ICU order | 100 bitmap probes on `…_tag_id_contact_id_idx`, quicksort of 100 rows | 21 ms |
  | Profile tags of a contact | index-only `contact_tags_pkey` | 0.1 ms |
  | Profile tag history keyset | index-only `contact_tag_history_workspace_id_contact_id_created_at_idx` | 0.2 ms |
  | Rate limit for an owner right after the merge burst | bitmap on `…_actor_kind_created_at_idx`, 30 rows, merged entries skipped | 0.1 ms |
  | Owner delete links of a tag | bitmap on `…_tag_id_contact_id_idx` | — |

  On the 100-row `tags` table the planner chose sequential scans, so those plans were re-checked with `enable_seqscan = off`: find by name key uses `tags_workspace_id_name_key_key`, the member add's `FOR KEY SHARE` uses `tags_workspace_id_id_key`, and the contact `FOR NO KEY UPDATE` by `(workspace, id)` uses `contacts_workspace_id_id_key`.
- **Reversibility.** Downs `06` → `01` were run, then `pg_dump -s` was compared with a second database that had only the 35 live migrations: **empty diff**. Ups `01`–`06` were re-applied afterwards; the backfill restored the seeded contacts' times.

## Deviations from the SAD (`sad.md` §4/§5 names are indicative)

1. **`contact_tags` PK is `(workspace_id, contact_id, tag_id)`**, not `(contact_id, tag_id)` (assumption 2). Same uniqueness; it is also the FK index of the contact composite FK.
2. **`contacts (workspace_id, id)` is a unique index, not a unique constraint** (assumption 3), so 03 stays re-runnable.
3. **`contact_tag_history` index for the rate limit has `kind` in its key** (assumption 9). The SAD's §6 flag named `(workspace_id, actor_account_id, created_at)`.
4. **`contact_tag_history` gets a kind ↔ source `CHECK`.** The SAD says member routes accept only `inbox` / `profile` and the server writes `settings` on owner paths; the database now refuses any other combination.
5. **The `all of` predicate must be a grouped semi-join** (assumption 10). The SAD §4 wording "number of matching `contact_tags` rows = `cardinality($ids)`" is the same rule; the correlated form measured 466 ms, close to the 500 ms target, while the grouped form measured 4 ms.

## Code-level findings for `tasks` (no schema change)

- **The capture upsert's `WHERE` gate.** `contacts/infra/contact-repo.ts` updates the profile only `WHERE contacts.profile_seen_at < excluded.profile_seen_at`. A message whose send time is older than the stored profile time (an out-of-order delivery) would then skip the update and never lower `first_wrote_at`. The upsert must widen first and last wrote unconditionally (`LEAST` / `GREATEST`) and keep the newer-profile gate only for the profile fields (for example `CASE WHEN contacts.profile_seen_at < excluded.profile_seen_at THEN excluded.first_name ELSE contacts.first_name END`), with the `WHERE` relaxed to "profile newer, or the range widens". An integration test should deliver an older message after a newer one.
- **`last_wrote_at` equals `profile_seen_at` today** for every contact upserted by capture, because capture passes the send time as `seenAt`. ADR-0005 keeps a separate column, so a later profile source (for example a bot `getChat`) can move `profile_seen_at` without moving "last wrote". No change proposed.
- **Keyset with a NULL tail.** The cursor predicate has two shapes (dated part, NULL tail), documented in `data-model.md` and in the 03 comment. Both use the same index.

## New integrity queries for the run book (SAD §7)

- History entries whose `contact_id` belongs to another workspace than their `workspace_id`: impossible by the composite FK, kept only as a smoke check.
- Contacts with a message but `last_wrote_at IS NULL`: catches a capture path that forgot the upsert (reads `conversations` / `messages`, run book only, like the backfill).

## Drift

None. The tables and columns are new, and their writers do not exist yet. The existing `contacts/infra/contact-repo.ts` and the `insertContact` fixture map exactly to the generated `Contacts` interface (`db.types.gen.ts`). The added columns are nullable, so they cause no insert drift. The `WHERE` gate above is a behaviour change for `tasks`, not a field-to-column drift. No `_drift/` files.

## Breaking-change decompositions

- `contacts.first_wrote_at` / `last_wrote_at`: `01` expand → `02` backfill. No contract: the columns stay nullable by design.

## Open items (`<!-- TBD -->`)

- None in `data-model.md`.
- Spec §8 OQ-1 (exclusion segments) needs no schema: one more predicate on `contact_tags_workspace_id_tag_id_contact_id_idx`.
- Spec §8 OQ-2 (contact deletion) will need an explicit delete order (history, links, then the contact) or `ON DELETE CASCADE` on the two composite FKs to `contacts`; decided with that feature.
- Security review: tags and tag history are new personal data about end customers (SAD §2); no extra columns were added beyond the SAD's.

## Self-check

| Check | Result |
|---|---|
| Naming matches the repo convention | pass |
| Down reversibility | pass. Every ADD COLUMN, ADD CONSTRAINT, CREATE TABLE and CREATE INDEX has its drop. The backfill's down is a no-op, because its values go with the columns. Verified by running downs `06` → `01` (empty schema diff) and re-applying |
| FK indexes | pass. `tags`: workspace via `tags_workspace_id_name_key_key`, creator via `tags_workspace_id_created_by_account_id_idx`. `contact_tags`: workspace and contact via the PK, tag via `…_tag_id_contact_id_idx`, adder via `…_added_by_account_id_idx`. `contact_tag_history`: workspace and contact via `…_contact_id_created_at_idx`, actor via `…_actor_kind_created_at_idx` |
| Convention adherence | pass. Deviations from the SAD's indicative names are listed above. There are no deviations from repo conventions (UUIDv7 from the app, non-null `workspace_id`, `text` + `CHECK`, no `DEFAULT`, no triggers, composite FKs to `memberships`) |
| Mermaid `erDiagram` | pass (`mmdc` render) |
| PII in seeds and fixtures | pass. There are no seeds. Fixtures and the verification seed use `Test User`, `@example.test` and synthetic ids |

## Next stage

`/sdd:api contacts`. The feature adds the contacts and tags routes, an inbox read and two live frames, so the contract changes and `api` cannot be skipped.
