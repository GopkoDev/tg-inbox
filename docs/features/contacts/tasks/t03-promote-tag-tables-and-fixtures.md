---
id: T3
title: "Promote migrations 04–06 (tags, contact_tags, contact_tag_history), regenerate DB types and add the tag fixtures"
layer: "migration"
deps: ["T1", "T2"]
blocks: ["T6", "T7", "T9"]
acs: ["AC-08", "AC-12"]
files_hint: ["docs/features/contacts/migrations/04_create_tags.up.sql", "docs/features/contacts/migrations/05_create_contact_tags.up.sql", "docs/features/contacts/migrations/06_create_contact_tag_history.up.sql", "apps/api/migrations/", "apps/api/src/platform/db.types.gen.ts", "apps/api/src/test/migrations.int.test.ts", "apps/api/src/test/fixtures/tags.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T3 — Promote migrations 04–06 (tags, contact_tags, contact_tag_history), regenerate DB types and add the tag fixtures

## Place in the sequence

- **Blocked by:** T1 — Add the shared tag-name rules: tidy, name key, 1–32 grapheme length and tag-list order, T2 — Promote migrations 01–03 (first and last wrote, their backfill, the list indexes) and make capture widen first and last wrote unconditionally · **Blocks:** T6 — Build the tag repository: the workspace tag lock, find by name key, insert, the workspace count, the tag list with counts in tag-list order, id resolution, the row locks and the rename, with cross-workspace isolation tests, T7 — Build the contact-tag and tag-history repositories for member changes: the contact row lock, a contact's tags in tag-list order, link insert and delete, history entries, the history keyset page and the member-kind rate count, with isolation tests, T9 — Build the contacts list query (search, any / all / none with the all-of grouped semi-join, keyset with the NULL tail, tags per row, matching and total counts) and the profile read · **Wave:** 2 — after T1, T2.
- **Lane:** `layer: migration` — serialized with the other migration task. Shares `apps/api/migrations/`, `apps/api/src/platform/db.types.gen.ts`, `apps/api/src/test/migrations.int.test.ts` with T2; shares `apps/api/src/test/fixtures/tags.ts` with T17 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to add and remove tags on a contact from the conversation I am answering or from the profile, reusing the team's existing tags
> **So that** the team builds a grouped customer base as a side effect of support
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It creates the three tag tables whose composite foreign keys make a cross-workspace link impossible and whose unique key makes two look-alike tags impossible.

## Inlined context

> - **Tenancy:** every new table has a non-null `workspace_id → workspaces(id)`. Every cross-entity reference is a **composite** FK that includes `workspace_id`, so the database refuses a link between a contact and a tag, or an entry and a contact, of different workspaces (spec §6 tenant isolation, AC-12). No new controlled tenancy exception.
>
> — `data-model.md §Conventions applied, Tenancy, verbatim` · full text: [data-model.md](../data-model.md)

> - **Delete strategy:** `contact_tags` rows are hard-deleted by a member's removal and by an owner's merge or delete, always together with a history entry. Tags are hard-deleted by an owner's merge or delete. History entries are never updated or deleted. No `ON DELETE CASCADE` anywhere: the owner's delete removes the links itself with `RETURNING` to compare the confirmed count (ADR-0004), and contact deletion is out of scope (spec OQ-2).
>
> — `data-model.md §Conventions applied, Delete strategy, verbatim` · full text: [data-model.md](../data-model.md)

> - `04`–`06` go with the tag use cases and routes.
>
> — `_audit/data-model-2026-10-19.md §Ordering with code, 04–06, verbatim` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

> - `tags`: a duplicate name key in the same workspace (`tags_workspace_id_name_key_key`); an untidy name ` VIP ` and an empty name (`tags_name_check`); a creator from another workspace (`tags_created_by_membership_fkey`).
> - `contact_tags`: the same link twice (`contact_tags_pkey`); another workspace's tag on a contact (`contact_tags_tag_fkey`); another workspace's contact with this workspace's tag (`contact_tags_contact_fkey`); a row that claims the other workspace with this workspace's tag (`contact_tags_tag_fkey`); an adder from another workspace (`contact_tags_added_by_membership_fkey`); deleting a tag that still has links (`contact_tags_tag_fkey`).
> - `contact_tag_history`: an unknown kind `renamed`; a member kind from `settings` and an owner kind from `inbox` (`…_kind_source_check`); a merge without a target, an `added` with a target, a target id without its name (`…_merged_into_check`); a contact and an actor of another workspace (composite FKs).
> - `contacts`: first after last (`contacts_wrote_order_check`); only one of the two times (`contacts_wrote_pair_check`).
>
> — `_audit/data-model-2026-10-19.md §Verification, Rejected as intended, verbatim` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

> - **Accepted as intended (10 cases):** the same name key in another workspace; history entries for `added`, for `merged` and for `deleted` whose tag no longer exists (no FK on `tag_id`); the capture `LEAST` / `GREATEST` update; a rename that keeps the id; the owner delete `DELETE … RETURNING contact_id` then the tag; a full set-based merge in one transaction (merged entries for 301 contacts, keep-earlier update, delete of duplicate links, re-point of the rest, delete of the merged tag, all under `FOR UPDATE` of both tag rows in id order).
>
> — `_audit/data-model-2026-10-19.md §Verification, Accepted as intended, verbatim` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

> - `insertTag(db, { workspaceId, createdByAccountId, name?, createdAt? })`: tidies `name` (default `Test tag N`) and computes `name_key` with the same shared function the domain uses, so tests never hand-write a key.
> - `insertContactTag(db, { workspaceId, contactId, tagId, addedByAccountId, addedAt?, history?: boolean })`: inserts the link and, by default, its `added` history entry (source `profile`), so the §7 integrity query holds in every test.
> - `insertTagHistory(db, { workspaceId, contactId, tagId, tagName, kind, actorAccountId, source?, mergedInto?, createdAt? })`: for the rate-limit and keyset tests; `source` defaults per kind (`profile` for member kinds, `settings` for owner kinds).
> - `twoWorkspacesWithTags(db)`: two workspaces (from `twoWorkspacesWithInbox`), each with an owner and an operator, two contacts, a tag named `VIP` in both (same key, different ids), and one link with its entry. It is the base for the cross-workspace isolation test of every new repository method (`CLAUDE.md`), and for AC-12: a link naming the other workspace's tag or contact is refused by the composite FKs, and no count or filter crosses over.
>
> — `data-model.md §Test fixtures, verbatim` · full text: [data-model.md](../data-model.md)

> **Hard rule:** **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation. Six reads are the controlled exceptions because they produce the workspace id: three in `workspaces` (memberships of an account, invitation by token hash, membership for the guard — account id + workspace id from the URL) and two in `bots` (_bot by webhook id_, scoped by possession of the webhook secret's hash; _bots due for a health check_, used only by the scheduled job — bot-connection ADR-0007) and one in `notifications` (_workspaces with a live Telegram link_, workspace ids only, used only by the `schedule-pings` backstop — operator-notifications ADR-0005); a new exception needs a change to the SAD (shared-inbox added none).
>
> — `CLAUDE.md §Rules, Tenancy, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Staged pairs promoted by this task, after T2's `01`–`03`:

- `docs/features/contacts/migrations/04_create_tags.{up,down}.sql`
- `…/05_create_contact_tags.{up,down}.sql`
- `…/06_create_contact_tag_history.{up,down}.sql`

| Index | Columns | Query it serves |
|---|---|---|
| `tags_workspace_id_name_key_key` (unique) | `tags (workspace_id, name_key)` | One tag per normalised name per workspace (AC-08). Find-or-create and the "name taken" check (flows 9, 13). The tag list and the 100 count (flow 12, flow 9). FK index for `workspace_id` |
| `tags_workspace_id_id_key` (unique) | `tags (workspace_id, id)` | Target of the composite FK from `contact_tags`. Resolve filter ids, `FOR KEY SHARE` and `FOR UPDATE` by workspace and id (flows 5, 8, 13) |
| `contact_tags_pkey` | `contact_tags (workspace_id, contact_id, tag_id)` | One link per contact and tag (AC-06, AC-09). The contact's tags, the carried / count check, the `any` / `none` existence checks (flows 4, 5, 6, 8, 10). FK index for `workspace_id` and the contact composite FK |
| `contact_tags_workspace_id_tag_id_contact_id_idx` | `contact_tags (workspace_id, tag_id, contact_id)` | Count per tag (flow 12, AC-10). `any of` / `all of` with the matching count (flow 5, AC-02). Owner merge and delete (flow 13, seeded flow 2). FK index for the tag composite FK |
| `contact_tag_history_workspace_id_contact_id_created_at_idx` | `contact_tag_history (workspace_id, contact_id, created_at DESC, id DESC)` | The profile's tag history keyset (flow 6, AC-04). The §7 integrity query. FK index for `workspace_id` and the contact composite FK |
| `contact_tag_history_workspace_id_actor_kind_created_at_idx` | `contact_tag_history (workspace_id, actor_account_id, kind, created_at)` | The member rate limit and its retry time (flows 8, 9, 10, AC-15; assumption 9). FK index for the actor composite FK |

— `data-model.md §Indexes, verbatim` · full text: [data-model.md](../data-model.md)

The full column lists are in `data-model.md` §Entities (`tags`, `contact_tags`, `contact_tag_history`); the migrations are the source of the DDL.

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-08 — domain invariant

> **Given** "Acme Flowers" has the tag "VIP" and 100 tags in total, and a contact that carries 20 tags
> **When** an operator types "vip", " VIP " or "VIP  " (other letter case, or spaces around the name) for a contact, or two members create "Kyiv" for different contacts at the same moment, or someone tries to create a 101st tag or add a 21st tag to that contact
> **Then** a name that differs from an existing tag only in letter case or spacing is the existing tag ("vip" applies "VIP"), and two members creating the same new name at the same moment end up with one tag applied to both contacts — a workspace never holds two tags with the same name; the 101st tag is not created and the tag control says a workspace can have at most 100 tags and a business owner can merge or delete some in Settings; the 21st tag is not added (and a new name typed for it is not created either) and the control says a contact can carry at most 20 tags; both limits hold when members act at the same moment
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, search or open contacts of "Acme Flowers", see its tags or their counts, or add, remove, rename or delete a tag — including by naming a contact or tag of "Acme Flowers" from another workspace, or a tag of another workspace on a contact of "Acme Flowers"
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the contact or the tag exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first; a contact only ever carries tags of its own workspace, and no list, filter or count of one workspace ever includes a contact or tag of another
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Promote `04`, `05`, `06` as three TS migrations after T2's, SQL inline with the header comment; `pnpm db:migrate` then `pnpm db:codegen` (`Tags`, `ContactTags`, `ContactTagHistory`) — `apps/api/migrations/`, `apps/api/src/platform/db.types.gen.ts`
- [ ] Add a `contacts migrations (04–06)` block: each of the audit's refused cases fails on the named constraint, each accepted case succeeds, downs `06` → `04` then ups again — `apps/api/src/test/migrations.int.test.ts`
- [ ] Fixtures `insertTag` (tidy + key through the shared T1 functions), `insertContactTag` (with its `added` entry by default), `insertTagHistory`, `twoWorkspacesWithTags` — `apps/api/src/test/fixtures/tags.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| another workspace's tag on a contact | refused by `contact_tags_tag_fkey` (AC-12) |
| the same name key twice in one workspace | refused by `tags_workspace_id_name_key_key` (AC-08) |
| the same name key in another workspace | accepted |
| deleting a tag that still has links | refused by `contact_tags_tag_fkey` — the owner path deletes the links first |
| a member kind with source `settings` | refused by `…_kind_source_check` |

## Definition of Done

- [ ] Migrations 04–06 are promoted and apply and revert cleanly, db.types.gen.ts is regenerated, the migrations integration test rejects every refused case of the audit for tags, contact_tags and contact_tag_history on its named constraint and accepts the accepted ones, and insertTag / insertContactTag / insertTagHistory / twoWorkspacesWithTags exist with insertTag computing name_key through the shared function.
- [ ] staged migrations 04–06 are promoted to live `apps/api/migrations/`, then apply and revert cleanly
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
