---
id: T13
title: "Add the owner tag use cases listTags and renameTag: rename, case-only rename, same-text no-op, TAG_NAME_TAKEN with the holder's count, and the confirmed merge with TAG_MERGE_TARGET_CHANGED, tags.changed and the tag.merged log event"
layer: "app"
deps: ["T4", "T5", "T6", "T8"]
blocks: ["T14"]
acs: ["AC-07", "AC-09", "AC-10", "AC-14", "AC-15"]
files_hint: ["apps/api/src/modules/contacts/app/tag-admin.ts", "apps/api/src/modules/contacts/app/tag-admin.test.ts", "apps/api/src/modules/contacts/app/tag-admin.int.test.ts", "apps/api/src/modules/contacts/app/ports.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T13 — Add the owner tag use cases listTags and renameTag: rename, case-only rename, same-text no-op, TAG_NAME_TAKEN with the holder's count, and the confirmed merge with TAG_MERGE_TARGET_CHANGED, tags.changed and the tag.merged log event

## Place in the sequence

- **Blocked by:** T4 — Add the contacts zod contracts, the eight tag error codes, and the contact.changed / tags.changed frames and signals with their hub mapping, T5 — Add the tags domain: the limits (100 per workspace, 20 per contact, 60 per 60 s, 50 per page), the history kinds and sources, the merge link rule and the rate-limit retry time, T6 — Build the tag repository: the workspace tag lock, find by name key, insert, the workspace count, the tag list with counts in tag-list order, id resolution, the row locks and the rename, with cross-workspace isolation tests, T8 — Add the owner set-based statements: merge (merged entries, keep the earlier link, re-point the rest) and delete (links with RETURNING, deleted entries) · **Blocks:** T14 — Add deleteTag against the confirmed count: TAG_COUNT_CHANGED with the current count, deleted entries on every contact that lost the tag, tags.changed · **Wave:** 5 — after T4, T5, T6, T8.
- **Lane:** Shares `apps/api/src/modules/contacts/app/ports.ts` with T2; shares `apps/api/src/modules/contacts/app/ports.ts` with T6; shares `apps/api/src/modules/contacts/app/ports.ts` with T7; shares `apps/api/src/modules/contacts/app/ports.ts` with T8; shares `apps/api/src/modules/contacts/app/ports.ts` with T9; shares `apps/api/src/modules/contacts/app/ports.ts` with T10; shares `apps/api/src/modules/contacts/app/ports.ts` with T11; shares `apps/api/src/modules/contacts/app/tag-admin.ts`, `apps/api/src/modules/contacts/app/tag-admin.test.ts`, `apps/api/src/modules/contacts/app/tag-admin.int.test.ts` with T14 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to rename, merge and delete the workspace's tags
> **So that** one kind of customer has one tag and the list stays usable
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It lets a business owner rename a tag, or merge it into the tag that already has the new name, without splitting or silently shrinking a segment.

## Inlined context

> - **Rename and merge (AC-09).** A rename with the same tidied text is a no-op success. A new name whose key equals the tag's own key changes only how it is shown. A key held by another tag is refused with `TAG_NAME_TAKEN` (details: that tag's id, name and count); the dialog offers the merge, and confirming resends with `mergeInto: <that id>`. The merge runs set-based in one transaction (§6 flow 2).
>
> — `sad.md §4, Supporting choices, Rename and merge, verbatim` · full text: [sad.md](../sad.md)

> • Owner rename / merge / delete: (1) `tags:<ws>`; (2) the tag rows `FOR UPDATE` in id order; (3) set-based `contact_tags` updates/deletes; (4) history inserts (FK `FOR KEY SHARE` on contacts, which does not conflict with a member's `FOR NO KEY UPDATE`); (5) publish.
>
> — `sad.md §8, Concurrency, owner paths, abridged` · full text: [sad.md](../sad.md)

> 4. **Owner operations publish exactly one `tags.changed`** per rename, merge or delete, however many contacts the tag was on, and no `contact.changed` (ADR-0007). A rename to the same text publishes nothing. A refused request publishes nothing, because signals exist only if their transaction commits.
> 5. **`tag.merged` is a structured log event, not a bus event.** It feeds the spec §7 look-alike KPI (sad.md §7 *Alerts*) and has no subscriber. It is listed below so the KPI's source is in the contract.
>
> — `contracts/events.md §Assumptions, 4, verbatim` · full text: [events.md](../contracts/events.md)

> 10. **Owner refusals name the tag with its count** (`TagWithCount`): `TAG_NAME_TAKEN.details.tag` (the merge offer, "VIP" with 12), `TAG_COUNT_CHANGED.details.tag` (the current count to ask again with), `TAG_MERGE_TARGET_CHANGED.details.name_holder`.
>
> — `contracts/api-sync-report.md §Assumptions, 10, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> - **A tag is the same tag across renames.** A picker, a filter or a saved link that chose a tag before it was renamed still means that tag under its new name. A tag created later with the name of a deleted tag is a new tag (AC-02, AC-14).
>
> — `spec.md §1, Clarifications, same tag across renames, verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (updates `tags.name` / `name_key`; merge through T8).

## API contract

- `GET …/tags` → `200 TagList { workspace_id, items: TagWithCount[] }` in tag-list order, zero counts included (member read).
- `POST …/tags/{tagId}/rename` body `{ name, merge_into_tag_id? }` → `200 TagRenameResult { outcome: renamed | merged | unchanged, tag, merged_tag_id }`.
- Errors: `400 TAG_NAME_INVALID`, `400 VALIDATION_ERROR` (merge into itself), `404 TAG_NOT_FOUND`, `409 TAG_NAME_TAKEN { tag }`, `409 TAG_MERGE_TARGET_CHANGED { name_holder }`. The `403 OWNER_ONLY` guard is the route's (T16).

— `contracts/openapi.yaml, operationIds listTags, renameTag, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-07 — error

> **Given** an operator creating a tag in "Acme Flowers"
> **When** the name is empty or only spaces, or longer than 32 characters once its ends are trimmed and inner spaces collapsed (an emoji counts as one character)
> **Then** no tag is created and nothing changes on the contact, and the tag control says that a tag name must be 1 to 32 characters
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — happy path

> **Given** a business owner of "Acme Flowers" in Settings → Tags, where "VIP" is on 12 contacts, "vip-clients" on 3 (one contact carries both) and "Old promo" on 40
> **When** they rename "vip-clients" to "Loyal", then rename "Loyal" to "vip", and delete "Old promo"
> **Then** after the first rename every contact that carried "vip-clients" carries "Loyal"; renaming into the name of an existing tag first says that "VIP" already exists and offers to merge, and on confirmation the 3 contacts carry "VIP" (the contact that had both carries it once), "VIP" now shows 14 contacts and "Loyal" is gone; a contact that carried only "Loyal" keeps who added it and when, the contact that carried both keeps the earlier of its two additions, the tag history of each of the 3 contacts records "Loyal" merged into "VIP" by the owner, and the contacts that carried only "VIP" get no entry; deleting first says that "Old promo" will be removed from 40 contacts and cannot be undone, and only on confirmation the tag disappears from the workspace and from every contact, and each of the 40 contacts' tag history records it removed by the owner's delete; if by then the tag is on a different number of contacts than the confirmation said, nothing is deleted and the owner is asked again with the current number; every change shows for members who have an affected profile or conversation header open without reloading; renaming a tag to a name that differs only in letter case or spacing ("vip" to "VIP") changes only how it is shown, renaming it to exactly the same text changes nothing, and a rename follows the name rules of AC-07
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — happy path

> **Given** a business owner of "Acme Flowers" whose workspace has the tags "VIP" (14 contacts), "Kyiv" (30) and "Wholesale" (0)
> **When** they open Settings → Tags and choose the count next to "Kyiv"
> **Then** the section lists every tag of the workspace with the number of contacts carrying it, in dictionary order ignoring letter case, including tags no contact carries, with rename and delete on each tag and no way to create one there; choosing a count opens the Contacts list filtered by that tag, which shows the same number of matching contacts
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

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

- [ ] `listTags(ws)` — `apps/api/src/modules/contacts/app/tag-admin.ts`
- [ ] `renameTag(ws, owner, tagId, name)`: name rules; `tags:<ws>`; lock T `FOR UPDATE`; gone → `TAG_NOT_FOUND`; same text → `unchanged`; own key or free → update `name` / `name_key`, no history, `tags.changed`; held by V → `TagNameTakenError` with V's count — same file
- [ ] `renameTag(…, mergeInto: V)`: lock T and V in id order; V gone or not holding the key → `TagMergeTargetChangedError` with the current holder or null; else T8's `mergeInto` + delete T + `tags.changed` + `tag.merged` log (ids only) after commit — same file
- [ ] No call into the member rate limit on any owner path — same file
- [ ] Unit tests per branch; integration tests on the AC-09 seed incl. a member add of "Loyal" racing the merge (lands first then re-pointed with history, or `TAG_NOT_FOUND`; never a deadlock) — `tag-admin.test.ts`, `tag-admin.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| rename "vip" → "VIP" | `renamed`: only the shown name changes, same id (AC-09) |
| rename to exactly the same text | `unchanged`, nothing published (AC-09) |
| rename "Loyal" → "vip" while "VIP" exists | `409 TAG_NAME_TAKEN` with "VIP" and 12 (AC-09) |
| merge confirmed but "VIP" was renamed meanwhile | `409 TAG_MERGE_TARGET_CHANGED` with the holder or null |
| a merge of a tag no contact carries | no entry; `tag.merged` still logged |
| an owner who just merged 10 000 contacts then tags a contact | not limited by their merged entries (AC-15) |

## Definition of Done

- [ ] Unit and integration tests prove listTags in tag-list order with zero counts, rename keeping the id and writing no history, the case-only rename, the same-text no-op, TAG_NAME_TAKEN with the holder and its count, the confirmed merge on the AC-09 seed (14 on VIP, adders kept, one merged entry per carrier of the merged tag) with TAG_MERGE_TARGET_CHANGED when the target moved, no deadlock against a racing member add, one tags.changed per change and the tag.merged log line with ids only.
- [ ] Tests also prove a rename follows the AC-07 name rules (TAG_NAME_INVALID, nothing changed), a history entry written before a rename still reads under the old name (AC-04), and an owner's merged entries never count toward the member limit while rename never answers TAG_CHANGE_LIMIT_REACHED (AC-15) (test plan).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
