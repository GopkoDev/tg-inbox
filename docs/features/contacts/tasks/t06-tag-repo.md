---
id: T6
title: "Build the tag repository: the workspace tag lock, find by name key, insert, the workspace count, the tag list with counts in tag-list order, id resolution, the row locks and the rename, with cross-workspace isolation tests"
layer: "infra"
deps: ["T3"]
blocks: ["T8", "T11", "T13"]
acs: ["AC-08", "AC-10", "AC-12", "AC-14"]
files_hint: ["apps/api/src/modules/contacts/infra/tag-repo.ts", "apps/api/src/modules/contacts/infra/tag-repo.int.test.ts", "apps/api/src/modules/contacts/app/ports.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T6 — Build the tag repository: the workspace tag lock, find by name key, insert, the workspace count, the tag list with counts in tag-list order, id resolution, the row locks and the rename, with cross-workspace isolation tests

## Place in the sequence

- **Blocked by:** T3 — Promote migrations 04–06 (tags, contact_tags, contact_tag_history), regenerate DB types and add the tag fixtures · **Blocks:** T8 — Add the owner set-based statements: merge (merged entries, keep the earlier link, re-point the rest) and delete (links with RETURNING, deleted entries), T11 — Add addContactTag: by id or by name with find-or-create under the workspace tag lock, the contact lock, the no-op, the 20 and 100 limits, the member rate limit, the tag row key-share, the link, one added entry and the signals, T13 — Add the owner tag use cases listTags and renameTag: rename, case-only rename, same-text no-op, TAG_NAME_TAKEN with the holder's count, and the confirmed merge with TAG_MERGE_TARGET_CHANGED, tags.changed and the tag.merged log event · **Wave:** 3 — after T3.
- **Lane:** Shares `apps/api/src/modules/contacts/app/ports.ts` with T2; shares `apps/api/src/modules/contacts/app/ports.ts` with T7; shares `apps/api/src/modules/contacts/app/ports.ts` with T8; shares `apps/api/src/modules/contacts/app/ports.ts` with T9; shares `apps/api/src/modules/contacts/app/ports.ts` with T10; shares `apps/api/src/modules/contacts/app/ports.ts` with T11; shares `apps/api/src/modules/contacts/app/ports.ts` with T13 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to see how many contacts carry each tag and how many match a filter
> **So that** I know how many customers a future broadcast would reach
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It gives the use cases every read and lock on `tags` they need, scoped to one workspace.

## Inlined context

> - Find-or-create by name key under the `tags:<ws>` advisory lock (flow 9), the "name taken by V" check on rename (flow 13) → `tags_workspace_id_name_key_key`.
> - The 100-per-workspace count under the same lock (flow 9), the tag list in tag-list order with counts (flow 12, the picker, the filter) → the workspace prefix of `tags_workspace_id_name_key_key`; at most 100 rows, sorted in the query by `name COLLATE "und-x-icu", name_key`.
> - Resolve filter ids within the workspace (flow 5), the member add's `FOR KEY SHARE` and the owner paths' `FOR UPDATE` in id order (flows 8, 13, seeded flow 2) → `tags_workspace_id_id_key`.
>
> — `data-model.md §Entities, tags, access patterns, verbatim` · full text: [data-model.md](../data-model.md)

> - Creating a tag, renaming, merging and deleting take `tags:<ws>` (advisory) first: creation counts the tags (≤ 100) and inserts or reuses by `name_key` under it, so two members creating "Kyiv" at once end with one tag.
>
> — `sad.md §4, strategic choice 4, workspace tag lock, verbatim` · full text: [sad.md](../sad.md)

> - **Tag-list order.** Dictionary order ignoring case, per alphabet: `ORDER BY name COLLATE "und-x-icu"` with `name_key` as tiebreak, the same order in the picker, on contacts and in Settings. The web sorts with `Intl.Collator(undefined, { sensitivity: 'base' })` for lists it holds.
>
> — `sad.md §4, Supporting choices, Tag-list order, verbatim` · full text: [sad.md](../sad.md)

> On the 100-row `tags` table the planner chose sequential scans, so those plans were re-checked with `enable_seqscan = off`: find by name key uses `tags_workspace_id_name_key_key`, the member add's `FOR KEY SHARE` uses `tags_workspace_id_id_key`, and the contact `FOR NO KEY UPDATE` by `(workspace, id)` uses `contacts_workspace_id_id_key`.
>
> — `_audit/data-model-2026-10-19.md §Verification, EXPLAIN note, verbatim` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

> **Chosen:** Option 1. The count the owner confirmed is exactly what the spec protects, and comparing the rows actually deleted is exact even with concurrent removals. Find-or-create under `tags:<ws>` plus the unique key gives one tag under a race and an exact 100 limit; the contact row lock gives an exact 20 limit; the explicit `FOR KEY SHARE` on the tag row (taken before the link insert, so before any unique-index entry exists that a merge's re-point could wait on) makes a racing add either land first (then removed or re-pointed with history) or fail as "no longer exists". Relying on the implicit FK check alone would deadlock a merge with an add of the target tag on the same contact.
>
> — `adr/0004-serialise-tag-writes-under-a-per-workspace-tag-lock-and-recheck-a-delete-against-the-confirmed-count.md §Decision outcome, ADR-0004, verbatim` · full text: [ADR-0004](../adr/0004-serialise-tag-writes-under-a-per-workspace-tag-lock-and-recheck-a-delete-against-the-confirmed-count.md)

> **Hard rule:** **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation. Six reads are the controlled exceptions because they produce the workspace id: three in `workspaces` (memberships of an account, invitation by token hash, membership for the guard — account id + workspace id from the URL) and two in `bots` (_bot by webhook id_, scoped by possession of the webhook secret's hash; _bots due for a health check_, used only by the scheduled job — bot-connection ADR-0007) and one in `notifications` (_workspaces with a live Telegram link_, workspace ids only, used only by the `schedule-pings` backstop — operator-notifications ADR-0005); a new exception needs a change to the SAD (shared-inbox added none).
>
> — `CLAUDE.md §Rules, Tenancy, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK; UNIQUE `(workspace_id, id)` | UUIDv7. The tag's identity: filters in addresses, contact tags and history refer to it, so a rename moves nothing (ADR-0002) |
| `workspace_id` | uuid | NOT NULL, FK → `workspaces(id)` | |
| `name` | text | NOT NULL, `<> ''`, `= btrim(name)` | The tidied name, case as typed, shown everywhere and sorted in ICU dictionary order (`COLLATE "und-x-icu"`). 1–32 graphemes, enforced in the domain (AC-07) |
| `name_key` | text | NOT NULL, `<> ''`; UNIQUE `(workspace_id, name_key)` | The tidied name case-folded. "vip", " VIP " and "VIP  " are one tag; two members creating "Kyiv" at once end with one tag (AC-08). A rename into another tag's key is refused as `TAG_NAME_TAKEN` and offered as a merge (AC-09) |
| `created_by_account_id` | uuid | NOT NULL, FK `(workspace_id, created_by_account_id) → memberships` | Who created it (assumption 6) |
| `created_at` | timestamptz | NOT NULL | |

— `data-model.md §Entities, tags, verbatim` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface. Backs `listTags` (`TagWithCount { id, name, contact_count }`, tag-list order) and the tag steps of `addContactTag`, `renameTag`, `deleteTag`.

## Acceptance criteria

### AC-08 — domain invariant

> **Given** "Acme Flowers" has the tag "VIP" and 100 tags in total, and a contact that carries 20 tags
> **When** an operator types "vip", " VIP " or "VIP  " (other letter case, or spaces around the name) for a contact, or two members create "Kyiv" for different contacts at the same moment, or someone tries to create a 101st tag or add a 21st tag to that contact
> **Then** a name that differs from an existing tag only in letter case or spacing is the existing tag ("vip" applies "VIP"), and two members creating the same new name at the same moment end up with one tag applied to both contacts — a workspace never holds two tags with the same name; the 101st tag is not created and the tag control says a workspace can have at most 100 tags and a business owner can merge or delete some in Settings; the 21st tag is not added (and a new name typed for it is not created either) and the control says a contact can carry at most 20 tags; both limits hold when members act at the same moment
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — happy path

> **Given** a business owner of "Acme Flowers" whose workspace has the tags "VIP" (14 contacts), "Kyiv" (30) and "Wholesale" (0)
> **When** they open Settings → Tags and choose the count next to "Kyiv"
> **Then** the section lists every tag of the workspace with the number of contacts carrying it, in dictionary order ignoring letter case, including tags no contact carries, with rename and delete on each tag and no way to create one there; choosing a count opens the Contacts list filtered by that tag, which shows the same number of matching contacts
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, search or open contacts of "Acme Flowers", see its tags or their counts, or add, remove, rename or delete a tag — including by naming a contact or tag of "Acme Flowers" from another workspace, or a tag of another workspace on a contact of "Acme Flowers"
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the contact or the tag exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first; a contact only ever carries tags of its own workspace, and no list, filter or count of one workspace ever includes a contact or tag of another
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — domain invariant

> **Given** an operator whose tag control on a contact of "Acme Flowers" still offers the tag "Old promo"
> **When** a business owner deletes "Old promo" (or merges it into another tag) before the operator picks it
> **Then** the tag is not added, the operator is told that this tag no longer exists, and the control shows the current tags; when the owner only renamed the tag, picking it adds the renamed tag under its new name and no tag with the old name is created; a contact never carries a tag that is not in the workspace's tag list
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `lockWorkspaceTags(ws, tx)` = `pg_advisory_xact_lock(hashtextextended('tags:' || ws, 0))` — `apps/api/src/modules/contacts/infra/tag-repo.ts`
- [ ] `findByKey(ws, key)`, `count(ws)`, `insert(ws, { id: newId(), name, key, createdBy, createdAt })` — same file
- [ ] `listWithCounts(ws)` ordered `name COLLATE "und-x-icu", name_key`, zero counts included; `countFor(ws, tagId)` — same file
- [ ] `resolveIds(ws, ids)` → the ids that are tags of `ws`; `lockForKeyShare(ws, tagId)` → row or null; `lockForUpdate(ws, ids)` in id order → rows; `rename(ws, id, name, key)`; `delete(ws, id)` — same file
- [ ] The `TagRepo` port — `apps/api/src/modules/contacts/app/ports.ts`
- [ ] Integration tests incl. a cross-workspace isolation test per method over `twoWorkspacesWithTags` — `apps/api/src/modules/contacts/infra/tag-repo.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `findByKey` / `resolveIds` / `lockForKeyShare` with another workspace's tag id | not found / dropped / null (AC-12) |
| `lockForKeyShare` of a tag deleted in a committed transaction | null → the caller answers `TAG_NOT_FOUND` (AC-14) |
| list order of `ábaco`, `Apple`, `apple pie`, `Zebra`, `Ёлка`, `Яблуко` | that order (audit ICU sample) |
| a tag no contact carries | listed with `contact_count` 0 (AC-10) |

## Definition of Done

- [ ] Integration tests prove find by key, insert, count, the tag list with counts in ICU tag-list order (zero counts included), id resolution, both row locks and the rename, each with a cross-workspace isolation case over twoWorkspacesWithTags.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
