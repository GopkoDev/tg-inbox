---
id: T3
title: "Promote migrations 03–08 (the conversations (workspace_id, id) key, broadcasts, broadcast_audience_tags, broadcast_group_contacts, broadcast_recipients, broadcast_items), regenerate DB types and add the broadcast fixtures"
layer: "migration"
deps: ["T2"]
blocks: ["T13", "T14", "T15"]
acs: ["AC-05", "AC-08", "AC-09"]
files_hint: ["docs/features/broadcasts/migrations/03_add_conversations_workspace_id_id_key.up.sql", "docs/features/broadcasts/migrations/04_create_broadcasts.up.sql", "docs/features/broadcasts/migrations/08_create_broadcast_items.up.sql", "apps/api/migrations/", "apps/api/src/platform/db.types.gen.ts", "apps/api/src/test/migrations.int.test.ts", "apps/api/src/test/fixtures/broadcasts.ts", "apps/api/src/test/fixtures/conversations.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T3 — Promote migrations 03–08 (the conversations (workspace_id, id) key, broadcasts, broadcast_audience_tags, broadcast_group_contacts, broadcast_recipients, broadcast_items), regenerate DB types and add the broadcast fixtures

## Place in the sequence

- **Blocked by:** T2 — Promote migrations 01–02 (contact_bot_reach and its backfill for the workspace's current Telegram bot), regenerate DB types and add the reach fixtures · **Blocks:** T13 — Add broadcast items to conversations: recordBroadcastItem in the outcome transaction without touching any conversation column, the thread kind broadcast in the keyset order, one-item reads and conversation.changed with item type broadcast, T14 — Build the broadcasts draft-side repositories: the broadcast row (insert, lock FOR NO KEY UPDATE, versioned field save, list order, launch-cap count and 10th newest launch, sending broadcasts, delete), the audience tag rows and the group rows (add, remove, membership, count, page), with isolation tests, T15 — Build the broadcasts recipient repository: the launch insert by unnest with positions, the conditional claim, outcome writes, back to waiting, stale in-flight resolution, settling waiting recipients, totals, the report page, the next waiting recipient and the duplicate sets, with isolation tests · **Wave:** 2 — after T2.
- **Lane:** shares `apps/api/migrations/`, `apps/api/src/platform/db.types.gen.ts`, `apps/api/src/test/migrations.int.test.ts` with T2; `layer: migration` is serialized with the other migration task — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to see the final number of recipients and the text one last time, then launch the broadcast
> **So that** the message goes out once, to the customers I confirmed, from the workspace's bot
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It creates the tables a launch freezes into — the broadcast with its frozen text, bot and breakdown, its audience and group rows, the recipient list and the thread items — with composite keys that keep every row inside its workspace.

## Inlined context

> | 03 | `03_add_conversations_workspace_id_id_key.{up,down}.sql` | conversations | 1 unique index on an existing table, the target of the items FK |
> | 04 | `04_create_broadcasts.{up,down}.sql` | broadcasts | new table: unique `(workspace_id, id)`, 4 composite FKs to `memberships`, 10 `CHECK`s, 7 indexes |
> | 05 | `05_create_broadcast_audience_tags.{up,down}.sql` | broadcasts | new table: natural PK, composite FK to `broadcasts`, no FK to `tags`, 2 `CHECK`s |
> | 06 | `06_create_broadcast_group_contacts.{up,down}.sql` | broadcasts | new table: natural PK, composite FKs to `broadcasts`, `contacts`, `memberships`, 3 indexes |
> | 07 | `07_create_broadcast_recipients.{up,down}.sql` | broadcasts | new table: 2 uniques, composite FKs to `broadcasts`, `contacts`, 7 `CHECK`s, 2 indexes |
> | 08 | `08_create_broadcast_items.{up,down}.sql` | conversations | new table: unique per broadcast and conversation, composite FKs to `conversations`, `broadcasts`, 2 `CHECK`s, 1 index |
>
> — `_audit/data-model-2026-10-23.md §Staged migrations, rows 03–08, verbatim` · full text: [audit](../_audit/data-model-2026-10-23.md)

> - The Kysely Migrator wraps every migration in a transaction, so 03 uses a plain `CREATE UNIQUE INDEX` (no `CONCURRENTLY`). Pre-pilot table sizes.
> - `03` and `08` go with `conversations.recordBroadcastItem` and the thread kind `broadcast`.
> - `04`–`07` go with the `broadcasts` module. `08` needs `04` (FK to `broadcasts`).
> - All eight can promote in one release (no production deployment yet, architecture map).
>
> After promotion: run `pnpm db:migrate` → `pnpm db:codegen` and commit `db.types.gen.ts`. … Add a `broadcasts migrations` block to `apps/api/src/test/migrations.int.test.ts`, like the contacts one: the backfill shapes, a constraint smoke test, and a revert and re-apply.
>
> — `_audit/data-model-2026-10-23.md §Staged migrations, promote-time hint + after promotion, abridged` · full text: [audit](../_audit/data-model-2026-10-23.md)

> 3. **A draft's text may be empty.** The draft exists from its first valid name (ux-flows), before any text is typed. `CHECK (status = 'draft' OR text <> '')` and the launch refuses an empty text with `BROADCAST_TEXT_INVALID` (for `api`).
> 5. **The launch freezes the confirmed breakdown on the row** (`audience_size`, `blocked_count`, `never_wrote_count`, `recipient_count`, sequences flag). A `CHECK` makes the four add up, keeps the audience ≤ 10 000 and needs at least one recipient.
> 6. **Recipients have a `position`** (1…n, unique per broadcast) in the fingerprint's order (by contact id).
> 7. **`claimed_at` is the current attempt's claim time.** A rate limit puts a recipient back to `waiting` with `claimed_at` NULL. A not confirmed recipient keeps it, and its item sits there (AC-16).
>
> — `data-model.md §Assumptions, 3, 5, 6, 7, abridged` · full text: [data-model.md](../data-model.md)

> - **Delete strategy:** a draft is hard-deleted with its tag and group rows by the delete use case (flow 9). Launched broadcasts, recipients, items and reach rows are never deleted by the application. … No `ON DELETE CASCADE` anywhere.
> - **Cross-module FKs** (`broadcast_items → broadcasts`, every member column → `memberships`, `contact_bot_reach`/`broadcast_*` → `contacts`) are constraints only. Each module reads the others through their app layers.
>
> — `data-model.md §Conventions applied, Delete strategy + Cross-module FKs, abridged` · full text: [data-model.md](../data-model.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Staged pairs (promote in order, one TS file each): `docs/features/broadcasts/migrations/03_add_conversations_workspace_id_id_key`, `04_create_broadcasts`, `05_create_broadcast_audience_tags`, `06_create_broadcast_group_contacts`, `07_create_broadcast_recipients`, `08_create_broadcast_items` — each `.up.sql` / `.down.sql`.

| Table / object | Key constraints this task must see enforced | Change |
|---|---|---|
| `conversations` | unique `conversations_workspace_id_id_key (workspace_id, id)` | index added |
| `broadcasts` | `broadcasts_workspace_id_id_key`; FKs `broadcasts_{author,last_changed_by,launched_by,stopped_by}_membership_fkey`; checks `status`, `version >= 1`, `name`, `text` (non-empty unless draft, `<= 4096`), `audience_kind`, `tag_mode` ⇔ tags, `launch` (launched_* ⇔ not draft), `breakdown` (sum, ≤ 10 000, ≥ 1 recipient), `stop`, `end` | added |
| `broadcast_audience_tags` | PK `(workspace_id, broadcast_id, tag_id)`, no FK to `tags`, `kind IN (include, exclude)`, `tag_name <> ''` | added |
| `broadcast_group_contacts` | PK `(workspace_id, broadcast_id, contact_id)`, composite FKs to `broadcasts`, `contacts`, `memberships` | added |
| `broadcast_recipients` | uniques `(workspace_id, broadcast_id, contact_id)`, `(…, position)`; `state` / `failure_reason` checks; reason ⇔ failed; `claimed_at`, `outcome_at`, `telegram_message_id` ⇔ state | added |
| `broadcast_items` | unique `broadcast_items_broadcast_conversation_key`; composite FKs to `conversations`, `broadcasts`; `state IN (delivered, not_confirmed)`; message id ⇔ delivered | added |

— `data-model.md §Entities + §Indexes, abridged`; constraint names from the staged `*.up.sql` · full text: [data-model.md](../data-model.md)

Fixtures (`apps/api/src/test/fixtures/broadcasts.ts`, new): `insertBroadcast`, `launchBroadcastFixture` (draft → `sending`, frozen breakdown, recipients with positions 1…n in contact-id order), `endBroadcastFixture`, `insertAudienceTag`, `insertGroupContact`, `twoWorkspacesWithBroadcasts` (from `twoWorkspacesWithTags`, each workspace with a bot, a tag-audience draft and a launched broadcast with two recipients). `fixtures/conversations.ts`: `insertBroadcastItem`. Synthetic ids, `Test User`, `@example.test`, Telegram ids like `5001n`.

— `data-model.md §Test fixtures, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-05 — domain invariant

> **Given** a draft of "Acme Flowers" whose group holds 9 990 contacts
> **When** an operator adds a contact who is already in the group, or chooses "add all matching" for a filter matching 50 contacts not in the group, or a tag audience would match more than 10 000 contacts
> **Then** a contact already in the group is not added twice and the group says it is already there; the bulk add is refused as a whole and the editor says that a broadcast's audience can hold at most 10 000 contacts (reachable or not) and how many can still be added; a tag audience matching more than 10 000 contacts, reachable or not, can be saved as a draft but not launched, and says so; a group only ever holds contacts of its own workspace
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, open, create, edit, duplicate, delete or launch a broadcast of "Acme Flowers", see its delivery report, or add a contact of "Acme Flowers" to a group of another workspace (or a contact of another workspace to a group of "Acme Flowers")
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the broadcast or the contact exists; a deactivated member gets the access-removed notice and a member deactivated while on the confirmation launches nothing; someone not signed in is asked to sign in first; a broadcast's audience, recipients and report only ever hold contacts of its own workspace, and the bot of one workspace never sends another workspace's broadcast
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — domain invariant

> **Given** "Acme Flowers" with the broadcast "Spring prices" launched to 36 recipients, a draft whose audience reaches nobody, and 10 broadcasts launched in the last 24 hours
> **When** a member tries to change the text, name or audience of "Spring prices", add or remove a recipient, or delete it; or teammates retag contacts, new customers write in, or a recipient unblocks the bot after the launch; or an owner tries to launch the empty draft or an 11th broadcast within 24 hours
> **Then** a launched broadcast cannot be changed or deleted — the page says it is read-only and offers to duplicate it — and its recipient list stays the 36 contacts fixed at launch whatever happens to tags and contacts afterwards; a draft that would reach nobody cannot be launched and says that its audience has no reachable contact; the 11th launch is refused and the owner is told that a workspace can launch at most 10 broadcasts in 24 hours and when the next launch is possible; every confirmed launch counts toward the 10, including one that was stopped or ended early, and a refused launch does not; drafts can still be created and edited
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Red: `broadcasts migrations — tables` block: a group row, recipient and item naming the other workspace's contact / broadcast / conversation (from `twoWorkspacesWithBroadcasts`) each fail on their composite FK; a breakdown that does not add up, `audience_size = 10001` and `recipient_count = 0` fail on `broadcasts_breakdown_check`; a `failed` recipient without a reason fails; a second item for one broadcast and conversation fails on `broadcast_items_broadcast_conversation_key`; a non-draft with empty text fails — `apps/api/src/test/migrations.int.test.ts`
- [ ] Promote `03`–`08` in order as `<timestamp>_<name>.ts` with the header comment — `apps/api/migrations/`
- [ ] `pnpm db:migrate` → `pnpm db:codegen`; commit the five new interfaces — `apps/api/src/platform/db.types.gen.ts`
- [ ] Fixtures with defaults that satisfy every `CHECK` — `apps/api/src/test/fixtures/broadcasts.ts`, `apps/api/src/test/fixtures/conversations.ts`
- [ ] Revert `08`…`03` and re-apply in the test

## Edge cases

| Case | Behaviour |
|---|---|
| recipient row inserted for a contact of another workspace | refused by `broadcast_recipients_contact_fkey` (AC-08) |
| a draft with an empty text | allowed (draft exists from its first valid name); a `sending` one with empty text is refused |
| a launched row missing `launched_at` / `launch_telegram_bot_id` | refused by `broadcasts_launch_check` |
| `broadcast_audience_tags.tag_id` of a deleted tag | allowed (no FK by design, ADR-0004) |
| fixture recipients given out of contact-id order | `launchBroadcastFixture` assigns positions by contact id so `position` stays unique 1…n |

## Definition of Done

- [ ] Migrations 03–08 are promoted in order, apply and revert cleanly, db.types.gen.ts gains Broadcasts, BroadcastAudienceTags, BroadcastGroupContacts, BroadcastRecipients and BroadcastItems, the migrations integration test refuses on its named constraint a group row, recipient or item naming another workspace's contact, broadcast or conversation, a frozen breakdown that does not add up or exceeds 10 000, a failed recipient without a reason and a second item for one broadcast and conversation, and insertBroadcast, launchBroadcastFixture, endBroadcastFixture, insertAudienceTag, insertGroupContact, insertBroadcastItem and twoWorkspacesWithBroadcasts exist.
- [ ] `twoWorkspacesWithBroadcasts` is used by at least one passing test in this task (it is the base of every later isolation test).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
