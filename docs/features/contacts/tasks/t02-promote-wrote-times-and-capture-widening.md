---
id: T2
title: "Promote migrations 01–03 (first and last wrote, their backfill, the list indexes) and make capture widen first and last wrote unconditionally"
layer: "migration"
deps: []
blocks: ["T3", "T9"]
acs: ["AC-01", "AC-13"]
files_hint: ["docs/features/contacts/migrations/01_add_contacts_wrote_times.up.sql", "docs/features/contacts/migrations/02_backfill_contacts_wrote_times.up.sql", "docs/features/contacts/migrations/03_add_contacts_list_indexes.up.sql", "apps/api/migrations/", "apps/api/src/platform/db.types.gen.ts", "apps/api/src/test/migrations.int.test.ts", "apps/api/src/test/fixtures/contacts.ts", "apps/api/src/modules/contacts/infra/contact-repo.ts", "apps/api/src/modules/contacts/infra/contact-repo.int.test.ts", "apps/api/src/modules/contacts/app/ports.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T2 — Promote migrations 01–03 (first and last wrote, their backfill, the list indexes) and make capture widen first and last wrote unconditionally

## Place in the sequence

- **Blocked by:** — · **Blocks:** T3 — Promote migrations 04–06 (tags, contact_tags, contact_tag_history), regenerate DB types and add the tag fixtures, T9 — Build the contacts list query (search, any / all / none with the all-of grouped semi-join, keyset with the NULL tail, tags per row, matching and total counts) and the profile read · **Wave:** 1 — no upstream; starts at once.
- **Lane:** `layer: migration` — serialized with the other migration task. Shares `apps/api/migrations/`, `apps/api/src/platform/db.types.gen.ts`, `apps/api/src/test/migrations.int.test.ts` with T3; shares `apps/api/src/modules/contacts/app/ports.ts` with T6; shares `apps/api/src/modules/contacts/infra/contact-repo.ts`, `apps/api/src/modules/contacts/app/ports.ts` with T7; shares `apps/api/src/modules/contacts/app/ports.ts` with T8; shares `apps/api/src/modules/contacts/infra/contact-repo.ts`, `apps/api/src/modules/contacts/app/ports.ts` with T9; shares `apps/api/src/modules/contacts/app/ports.ts` with T10; shares `apps/api/src/modules/contacts/app/ports.ts` with T11; shares `apps/api/src/modules/contacts/app/ports.ts` with T13 — serialized.

## Why (user story)

> **As an** Operator
> **I want** the Contacts list to show the workspace's real contacts, with search and a tag filter
> **So that** I find a customer, or a group of customers, without scrolling the inbox
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

It puts the contact's own first and last send times on the contact, so the list can order, page and count by them without reading another module's tables.

## Inlined context

> **Chosen:** Option 1. The value is already delivered to `contacts` in the right transaction; storing it makes ordering, paging, filtering and counting one indexed query on `(workspace_id, last_wrote_at DESC, id DESC)`.
>
> — `adr/0005-keep-first-and-last-customer-send-times-on-the-contact-written-by-capture.md §Decision outcome, ADR-0005, verbatim` · full text: [ADR-0005](../adr/0005-keep-first-and-last-customer-send-times-on-the-contact-written-by-capture.md)

> - New columns `contacts.first_wrote_at` / `last_wrote_at`. `upsertFromProfile` already runs once per captured customer message inside the capture transaction and already receives the message's send time; it now also sets `LEAST`/`GREATEST` of the two. Edits never call it, so an edited message never moves them; a redelivered duplicate carries the same send time, so the update is idempotent.
>
> — `sad.md §4, strategic choice 5, new columns, verbatim` · full text: [sad.md](../sad.md)

> - **The capture upsert's `WHERE` gate.** `contacts/infra/contact-repo.ts` updates the profile only `WHERE contacts.profile_seen_at < excluded.profile_seen_at`. A message whose send time is older than the stored profile time (an out-of-order delivery) would then skip the update and never lower `first_wrote_at`. The upsert must widen first and last wrote unconditionally (`LEAST` / `GREATEST`) and keep the newer-profile gate only for the profile fields (for example `CASE WHEN contacts.profile_seen_at < excluded.profile_seen_at THEN excluded.first_name ELSE contacts.first_name END`), with the `WHERE` relaxed to "profile newer, or the range widens". An integration test should deliver an older message after a newer one.
>
> — `_audit/data-model-2026-10-19.md §Code-level findings for tasks, WHERE gate, verbatim` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

> - Promote `01`–`03` with the capture change to `contacts.upsertFromProfile` that keeps first and last wrote (ADR-0005, flow 14). `02` is gap-safe, so it may run before or after that deploy, and a re-run after it fills any contact captured in the gap.
>
> — `_audit/data-model-2026-10-19.md §Ordering with code, 01–03, verbatim` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

> - The latest file is `1791681110005_add_conversations_waiting_index.ts`, so the next timestamp is ≈ `1791681110006`. `implement` assigns the real values at promotion, because another feature may promote first.
> - Put the SQL inline in `` sql`…`.execute(db) ``, with the header comment `// Promoted from docs/features/contacts/migrations/NN_….{up,down}.sql.` (precedent: `1791681110005_add_conversations_waiting_index.ts`).
>
> — `_audit/data-model-2026-10-19.md §Promote-time hint, timestamps, verbatim` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

> 7. **First and last wrote stay nullable for good.** The backfill fills every contact that has a message. A contact with none keeps NULL and sorts last (`NULLS LAST`). Capture always writes both on insert, so new contacts are never NULL.
> 8. **The backfill is gap-safe.** It takes `LEAST` / `GREATEST` with the stored value, so running it after the capture code is deployed never narrows a range that capture widened in the gap.
>
> — `data-model.md §Assumptions, 7, verbatim` · full text: [data-model.md](../data-model.md)

> - **"Last wrote" and "first wrote"** are the Telegram send times (position times) of the contact's newest and oldest customer messages. Team replies and activity entries never count, and an edited message does not move. The list is ordered by "last wrote", newest first. Contacts with the same time keep a fixed order among themselves (AC-01).
>
> — `spec.md §1, Clarifications, last / first wrote, verbatim` · full text: [spec.md](../spec.md)

> - Decision override: the backfill migration for `contacts.first_wrote_at` / `last_wrote_at` reads `conversations` and `messages`, which the `conversations` module owns. Rationale: it is a one-time data migration in SQL, not a repository read. Every runtime write goes through the capture call that already passes the message's send time to `contacts`, so no module code reads another module's tables. Tracked in §11. (Pipeline decision, 2026-10-19.)
>
> — `sad.md §1, Decision overrides, backfill, verbatim` · full text: [sad.md](../sad.md)

> **Hard rule:** **Migrations:** reversible — every migration exports a working `up` **and** `down`. After migrating, run `pnpm db:codegen` and commit the regenerated types. Destructive changes still go expand → migrate → contract.
>
> — `CLAUDE.md §Rules, Migrations, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Staged pairs promoted by this task, in ordinal order (`04`–`06` follow in T3):

- `docs/features/contacts/migrations/01_add_contacts_wrote_times.{up,down}.sql` — expand: 2 nullable columns, pair and order `CHECK`s
- `…/02_backfill_contacts_wrote_times.{up,down}.sql` — backfill from `messages.sent_at` through the conversation, gap-safe; the down is a no-op
- `…/03_add_contacts_list_indexes.{up,down}.sql` — the list keyset index and the unique `(workspace_id, id)`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `first_wrote_at` | timestamptz | NULL; NULL ⇔ `last_wrote_at` NULL; `<= last_wrote_at` | The Telegram send time of the contact's oldest own message (AC-01, AC-04). Set on insert and kept with `LEAST` by capture's `upsertFromProfile(…, sentAt, tx)` (flow 14). Edits and replies never touch it. Backfilled (02) |
| `last_wrote_at` | timestamptz | NULL, as above | The newest own message's send time: the list's sort key, newest first (AC-01). Kept with `GREATEST`. A redelivered duplicate has the same send time and changes nothing |

— `data-model.md §Entities, contacts, verbatim` · full text: [data-model.md](../data-model.md)

| Index | Columns | Query it serves |
|---|---|---|
| `contacts_workspace_id_last_wrote_at_id_idx` | `contacts (workspace_id, last_wrote_at DESC NULLS LAST, id DESC)` | The Contacts list's first and next pages, newest last wrote first, with search and filter, and its counts (flows 4, 5, AC-01, AC-02; SAD §10 QG-3 "the list uses the keyset index") |
| `contacts_workspace_id_id_key` (unique) | `contacts (workspace_id, id)` | Target of the composite FKs from `contact_tags` and `contact_tag_history` (AC-12). The profile read and the contact row lock by workspace and id (flows 6, 8, 10) |

— `data-model.md §Indexes, verbatim` · full text: [data-model.md](../data-model.md)

- `insertContact(db, { …, firstWroteAt?, lastWroteAt? })` in `fixtures/contacts.ts`: both default to `null`, or to `profileSeenAt` when either is given, so the pair check holds. Existing tests need no change.

— `data-model.md §Test fixtures, insertContact, verbatim` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface. bot-connection's `receiveTelegramUpdate` keeps its contract; the new write has no wire field until `listContacts` / `getContact` (T9, T10) read it.

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" whose bot has captured 120 contacts, some of them tagged
> **When** they open Contacts
> **Then** the list shows the contacts of "Acme Flowers" and nothing else, with no sample data and no "Sample data" label: each row shows the contact's name and username, their tags in tag-list order, language, when they first wrote and when they last wrote (by the send time of their own messages; the team's replies do not count), ordered by when they last wrote, newest first, 50 at a time with the next ones on request, continuing from the last contact shown so that none is shown twice or skipped, and the page says how many contacts there are in total; a contact with no username or no known language shows that it has none instead of an empty value; choosing a contact opens their profile; a business owner sees and does the same
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — cross-context

> **Given** a contact of "Acme Flowers" carrying the tags "VIP" and "Kyiv", added by an operator who has since been deactivated
> **When** the customer changes their Telegram name and writes again, or the bot of "Acme Flowers" stops working or is disconnected, or the same person writes to the bot of another workspace
> **Then** the contact shows the new name with the same tags; the tags and the tag history still show the deactivated member as the one who added them; tagging, the Contacts list and profiles work in every state of the bot, since nothing about tags goes to Telegram; the same person in another workspace is a separate contact with none of the tags of "Acme Flowers"
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Promote `01`, `02`, `03` as three TS migrations after `1791681110005` with the SQL inline and the `// Promoted from …` header; `pnpm db:migrate` then `pnpm db:codegen` — `apps/api/migrations/`, `apps/api/src/platform/db.types.gen.ts`
- [ ] Add a `contacts migrations (01–03)` block to the migrations test: the four backfill shapes (A1 send time not arrival or edit, A2 one photo, A3 no conversation → NULL / NULL, B1 other workspace), the pair and order `CHECK` refusals, revert and re-apply — `apps/api/src/test/migrations.int.test.ts`
- [ ] Capture upsert: insert sets `first_wrote_at = last_wrote_at = sentAt`; on conflict `first_wrote_at = LEAST(…)` and `last_wrote_at = GREATEST(…)` always, the profile fields only `CASE WHEN contacts.profile_seen_at < excluded.profile_seen_at`, and the `WHERE` relaxed to «profile newer, or the range widens» — `apps/api/src/modules/contacts/infra/contact-repo.ts`
- [ ] `ContactRecord` gains `firstWroteAt` / `lastWroteAt` (nullable) — `apps/api/src/modules/contacts/app/ports.ts`
- [ ] Integration tests: insert, newer message, an **older message delivered after a newer one** (lowers first wrote, leaves the profile), a redelivered duplicate (no change), the same Telegram user in another workspace untouched — `apps/api/src/modules/contacts/infra/contact-repo.int.test.ts`
- [ ] `insertContact` gains `firstWroteAt?` / `lastWroteAt?` per the data-model rule — `apps/api/src/test/fixtures/contacts.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| an older message arrives after a newer one | `first_wrote_at` lowers; `last_wrote_at` and the profile fields stay |
| a redelivered duplicate (same send time) | nothing changes |
| an edited message | capture does not call the upsert; both times stay (flow 14) |
| a team reply | never passes through the upsert; both times stay (AC-01) |
| a contact with no message (A3) | both NULL after the backfill; sorts last (`NULLS LAST`) |
| re-running `02` after the capture change | gap-safe: never narrows a widened range |

## Definition of Done

- [ ] Migrations 01–03 are promoted, apply, backfill the four audit shapes and revert cleanly, the regenerated db.types.gen.ts is committed, and contact-repo integration tests prove capture sets first and last wrote on insert and widens them with LEAST / GREATEST on every new message — including an older message delivered after a newer one — while the profile fields still change only for a newer profile.
- [ ] staged migrations 01–03 are promoted to live `apps/api/migrations/`, then apply and revert cleanly
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
