---
id: T14
title: "Add deleteTag against the confirmed count: TAG_COUNT_CHANGED with the current count, deleted entries on every contact that lost the tag, tags.changed"
layer: "app"
deps: ["T11", "T13"]
blocks: ["T16"]
acs: ["AC-09", "AC-14", "AC-15"]
files_hint: ["apps/api/src/modules/contacts/app/tag-admin.ts", "apps/api/src/modules/contacts/app/tag-admin.test.ts", "apps/api/src/modules/contacts/app/tag-admin.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T14 — Add deleteTag against the confirmed count: TAG_COUNT_CHANGED with the current count, deleted entries on every contact that lost the tag, tags.changed

## Place in the sequence

- **Blocked by:** T11 — Add addContactTag: by id or by name with find-or-create under the workspace tag lock, the contact lock, the no-op, the 20 and 100 limits, the member rate limit, the tag row key-share, the link, one added entry and the signals, T13 — Add the owner tag use cases listTags and renameTag: rename, case-only rename, same-text no-op, TAG_NAME_TAKEN with the holder's count, and the confirmed merge with TAG_MERGE_TARGET_CHANGED, tags.changed and the tag.merged log event · **Blocks:** T16 — Register the contacts routes (registerContacts): the eight operations with their zod schemas, the ownerOnly guard on rename and delete, and the wiring in buildDeps and buildApp · **Wave:** 6 — after T11, T13.
- **Lane:** Shares `apps/api/src/modules/contacts/app/tag-admin.ts`, `apps/api/src/modules/contacts/app/tag-admin.test.ts`, `apps/api/src/modules/contacts/app/tag-admin.int.test.ts` with T13 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to rename, merge and delete the workspace's tags
> **So that** one kind of customer has one tag and the list stays usable
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It makes a delete remove exactly the number of contacts the owner confirmed, or nothing.

## Inlined context

> - Delete sends the count the owner saw; the server deletes the links with `RETURNING`, and if the returned number differs, rolls back and answers `TAG_COUNT_CHANGED` with the current count (precedent: assignment-statuses close snapshot).
>
> — `sad.md §4, strategic choice 4, delete, verbatim` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. The count the owner confirmed is exactly what the spec protects, and comparing the rows actually deleted is exact even with concurrent removals. Find-or-create under `tags:<ws>` plus the unique key gives one tag under a race and an exact 100 limit; the contact row lock gives an exact 20 limit; the explicit `FOR KEY SHARE` on the tag row (taken before the link insert, so before any unique-index entry exists that a merge's re-point could wait on) makes a racing add either land first (then removed or re-pointed with history) or fail as "no longer exists". Relying on the implicit FK check alone would deadlock a merge with an add of the target tag on the same contact.
>
> — `adr/0004-serialise-tag-writes-under-a-per-workspace-tag-lock-and-recheck-a-delete-against-the-confirmed-count.md §Decision outcome, ADR-0004, verbatim` · full text: [ADR-0004](../adr/0004-serialise-tag-writes-under-a-per-workspace-tag-lock-and-recheck-a-delete-against-the-confirmed-count.md)

> (d) an owner deletes a tag whose count changed after the dialog opened → (d) nothing is deleted and the current count is returned; (c) a member adds "Old promo" while an owner deletes or merges it → the add is refused as "no longer exists" or lands before and is then removed with a history entry.
>
> — `sad.md §10, QG-1 (c)(d), abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `POST …/tags/{tagId}/delete` body `{ expected_count }` → `200 TagDeleted { workspace_id, tag_id, removed_from_count }` · `404 TAG_NOT_FOUND` · `409 TAG_COUNT_CHANGED { tag: TagWithCount }`. Owner-only (route, T16); not counted toward the member limit.

— `contracts/openapi.yaml, operationId deleteTag, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-09 — happy path

> **Given** a business owner of "Acme Flowers" in Settings → Tags, where "VIP" is on 12 contacts, "vip-clients" on 3 (one contact carries both) and "Old promo" on 40
> **When** they rename "vip-clients" to "Loyal", then rename "Loyal" to "vip", and delete "Old promo"
> **Then** after the first rename every contact that carried "vip-clients" carries "Loyal"; renaming into the name of an existing tag first says that "VIP" already exists and offers to merge, and on confirmation the 3 contacts carry "VIP" (the contact that had both carries it once), "VIP" now shows 14 contacts and "Loyal" is gone; a contact that carried only "Loyal" keeps who added it and when, the contact that carried both keeps the earlier of its two additions, the tag history of each of the 3 contacts records "Loyal" merged into "VIP" by the owner, and the contacts that carried only "VIP" get no entry; deleting first says that "Old promo" will be removed from 40 contacts and cannot be undone, and only on confirmation the tag disappears from the workspace and from every contact, and each of the 40 contacts' tag history records it removed by the owner's delete; if by then the tag is on a different number of contacts than the confirmation said, nothing is deleted and the owner is asked again with the current number; every change shows for members who have an affected profile or conversation header open without reloading; renaming a tag to a name that differs only in letter case or spacing ("vip" to "VIP") changes only how it is shown, renaming it to exactly the same text changes nothing, and a rename follows the name rules of AC-07
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — domain invariant

> **Given** an operator whose tag control on a contact of "Acme Flowers" still offers the tag "Old promo"
> **When** a business owner deletes "Old promo" (or merges it into another tag) before the operator picks it
> **Then** the tag is not added, the operator is told that this tag no longer exists, and the control shows the current tags; when the owner only renamed the tag, picking it adds the renamed tag under its new name and no tag with the old name is created; a contact never carries a tag that is not in the workspace's tag list
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — error

> **Given** an operator of "Acme Flowers" who has added or removed 60 tags on contacts or created tags within the last 60 seconds
> **When** they try another tag change
> **Then** nothing changes, and the tag control says that tag changes are limited to 60 per minute per member and when they can continue; only recorded changes count: each addition and each removal counts as one, creating a new tag together with putting it on the contact counts as one, and adding a tag the contact already carries counts as none; a business owner's rename, merge and delete are not counted and not limited; the limit is per workspace, so changes in another workspace of the same account are not affected
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `deleteTag(ws, owner, tagId, expectedCount)`: `tags:<ws>`; lock T `FOR UPDATE`; gone → `TAG_NOT_FOUND`; T8's `deleteLinksReturning`; count ≠ expected → roll back and `TagCountChangedError` with the current count; else `deleted` entries + delete T + `tags.changed` — `apps/api/src/modules/contacts/app/tag-admin.ts`
- [ ] Unit tests per branch; integration tests: 40 confirmed and 40 carried → all 40 entries; a member add committed after the dialog → `TAG_COUNT_CHANGED` with 41 and nothing deleted; a member add racing the delete → refused as `TAG_NOT_FOUND` or counted (then `409`) — `tag-admin.test.ts`, `tag-admin.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| a repeated delete | `404 TAG_NOT_FOUND` (idempotent by state) |
| `expected_count` 40, now 41 | `409 TAG_COUNT_CHANGED` with 41; nothing deleted, nothing published (AC-09) |
| a tag on 0 contacts, `expected_count` 0 | deleted, no entries |

## Definition of Done

- [ ] Unit and integration tests prove a delete against the matching count removes the tag from the workspace and every contact with one deleted entry each and one tags.changed, that a changed count rolls back with TAG_COUNT_CHANGED and the current count, and that a racing member add ends either refused as TAG_NOT_FOUND or inside the count the owner is asked to confirm again.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
