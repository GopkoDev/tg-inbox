---
id: T8
title: "Add the owner set-based statements: merge (merged entries, keep the earlier link, re-point the rest) and delete (links with RETURNING, deleted entries)"
layer: "infra"
deps: ["T6", "T7"]
blocks: ["T13"]
acs: ["AC-09", "AC-12"]
files_hint: ["apps/api/src/modules/contacts/infra/contact-tag-repo.ts", "apps/api/src/modules/contacts/infra/contact-tag-repo.int.test.ts", "apps/api/src/modules/contacts/infra/tag-history-repo.ts", "apps/api/src/modules/contacts/app/ports.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T8 — Add the owner set-based statements: merge (merged entries, keep the earlier link, re-point the rest) and delete (links with RETURNING, deleted entries)

## Place in the sequence

- **Blocked by:** T6 — Build the tag repository: the workspace tag lock, find by name key, insert, the workspace count, the tag list with counts in tag-list order, id resolution, the row locks and the rename, with cross-workspace isolation tests, T7 — Build the contact-tag and tag-history repositories for member changes: the contact row lock, a contact's tags in tag-list order, link insert and delete, history entries, the history keyset page and the member-kind rate count, with isolation tests · **Blocks:** T13 — Add the owner tag use cases listTags and renameTag: rename, case-only rename, same-text no-op, TAG_NAME_TAKEN with the holder's count, and the confirmed merge with TAG_MERGE_TARGET_CHANGED, tags.changed and the tag.merged log event · **Wave:** 4 — after T6, T7.
- **Lane:** Shares `apps/api/src/modules/contacts/app/ports.ts` with T2; shares `apps/api/src/modules/contacts/app/ports.ts` with T6; shares `apps/api/src/modules/contacts/infra/contact-tag-repo.ts`, `apps/api/src/modules/contacts/infra/contact-tag-repo.int.test.ts`, `apps/api/src/modules/contacts/infra/tag-history-repo.ts`, `apps/api/src/modules/contacts/app/ports.ts` with T7; shares `apps/api/src/modules/contacts/app/ports.ts` with T9; shares `apps/api/src/modules/contacts/app/ports.ts` with T10; shares `apps/api/src/modules/contacts/app/ports.ts` with T11; shares `apps/api/src/modules/contacts/app/ports.ts` with T13 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to rename, merge and delete the workspace's tags
> **So that** one kind of customer has one tag and the list stays usable
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It makes an owner's merge and delete one set-based pass over up to 10 000 contacts that keeps every adder and leaves a history entry on every affected contact.

## Inlined context

> - Merge keeps the original adder and time on a contact that carried only the merged tag (the `contact_tags` row is re-pointed), and the earlier of the two additions on a contact that carried both. One `merged` entry is written on every contact that carried the merged tag; contacts that carried only the target get none.
>
> — `sad.md §4, strategic choice 3, merge, verbatim` · full text: [sad.md](../sad.md)

> - Delete sends the count the owner saw; the server deletes the links with `RETURNING`, and if the returned number differs, rolls back and answers `TAG_COUNT_CHANGED` with the current count (precedent: assignment-statuses close snapshot).
>
> — `sad.md §4, strategic choice 4, delete, verbatim` · full text: [sad.md](../sad.md)

> - **Accepted as intended (10 cases):** the same name key in another workspace; history entries for `added`, for `merged` and for `deleted` whose tag no longer exists (no FK on `tag_id`); the capture `LEAST` / `GREATEST` update; a rename that keeps the id; the owner delete `DELETE … RETURNING contact_id` then the tag; a full set-based merge in one transaction (merged entries for 301 contacts, keep-earlier update, delete of duplicate links, re-point of the rest, delete of the merged tag, all under `FOR UPDATE` of both tag rows in id order).
>
> — `_audit/data-model-2026-10-19.md §Verification, accepted cases, verbatim` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

> - An owner's merge or delete writes one history row per affected contact in one set-based statement. Fine to 10 000 contacts within the 2 s target; above ~100 000, batch it.
>
> — `sad.md §7, Scaling thresholds, verbatim` · full text: [sad.md](../sad.md)

> - **Tag history entries keep the name the tag had at that moment.** Older entries of a renamed or deleted tag still read under the old name, and a rename writes no entry. A merge writes one entry, "«Loyal» merged into «VIP»", with the owner and the time, on every contact that carried the merged tag, whether or not it also carried the target. Contacts that carried only the target get no entry. A delete writes "removed by the owner's delete" on every contact that carried the tag. Each entry also records whether a member made the change from the inbox or from the profile (AC-04, AC-09, §7).
>
> — `spec.md §1, Clarifications, tag history entries, verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `merged_into_tag_id` | uuid | NULL, **no FK**; non-null ⇔ `kind = 'merged'` | The merge target. Matched by the §7 integrity query for re-pointed links |
| `merged_into_name` | text | NULL, `<> ''`; non-null ⇔ `merged_into_tag_id` non-null | "«Loyal» merged into «VIP»" |

— `data-model.md §Entities, contact_tag_history, verbatim` · full text: [data-model.md](../data-model.md)

| Index | Columns | Query it serves |
|---|---|---|
| `contact_tags_workspace_id_tag_id_contact_id_idx` | `contact_tags (workspace_id, tag_id, contact_id)` | Count per tag (flow 12, AC-10). `any of` / `all of` with the matching count (flow 5, AC-02). Owner merge and delete (flow 13, seeded flow 2). FK index for the tag composite FK |

— `data-model.md §Indexes, verbatim` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface. Backs `renameTag` `outcome: merged` and `deleteTag` (`removed_from_count`).

## Acceptance criteria

### AC-09 — happy path

> **Given** a business owner of "Acme Flowers" in Settings → Tags, where "VIP" is on 12 contacts, "vip-clients" on 3 (one contact carries both) and "Old promo" on 40
> **When** they rename "vip-clients" to "Loyal", then rename "Loyal" to "vip", and delete "Old promo"
> **Then** after the first rename every contact that carried "vip-clients" carries "Loyal"; renaming into the name of an existing tag first says that "VIP" already exists and offers to merge, and on confirmation the 3 contacts carry "VIP" (the contact that had both carries it once), "VIP" now shows 14 contacts and "Loyal" is gone; a contact that carried only "Loyal" keeps who added it and when, the contact that carried both keeps the earlier of its two additions, the tag history of each of the 3 contacts records "Loyal" merged into "VIP" by the owner, and the contacts that carried only "VIP" get no entry; deleting first says that "Old promo" will be removed from 40 contacts and cannot be undone, and only on confirmation the tag disappears from the workspace and from every contact, and each of the 40 contacts' tag history records it removed by the owner's delete; if by then the tag is on a different number of contacts than the confirmation said, nothing is deleted and the owner is asked again with the current number; every change shows for members who have an affected profile or conversation header open without reloading; renaming a tag to a name that differs only in letter case or spacing ("vip" to "VIP") changes only how it is shown, renaming it to exactly the same text changes nothing, and a rename follows the name rules of AC-07
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, search or open contacts of "Acme Flowers", see its tags or their counts, or add, remove, rename or delete a tag — including by naming a contact or tag of "Acme Flowers" from another workspace, or a tag of another workspace on a contact of "Acme Flowers"
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the contact or the tag exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first; a contact only ever carries tags of its own workspace, and no list, filter or count of one workspace ever includes a contact or tag of another
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `mergeInto(ws, fromTag, toTag, actor, now, tx)`: one `INSERT … SELECT` of `merged` entries (both names, `source: settings`) for every contact carrying `fromTag`; update the target link to the earlier `(added_at, added_by)` where a contact carries both; delete those duplicate `fromTag` links; re-point the rest to `toTag` — `apps/api/src/modules/contacts/infra/contact-tag-repo.ts`, `tag-history-repo.ts`
- [ ] `deleteLinksReturning(ws, tagId, tx)` → contact ids; `appendDeleted(ws, contactIds, tag, actor, now, tx)` set-based — same files
- [ ] Port additions — `apps/api/src/modules/contacts/app/ports.ts`
- [ ] Integration tests on the AC-09 seed ("VIP" on 12, "vip-clients" on 3 with one overlap, "Old promo" on 40) and an isolation case — `apps/api/src/modules/contacts/infra/contact-tag-repo.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| a contact carrying only the merged tag | re-pointed with its adder and time kept; one `merged` entry |
| a contact carrying both, merged link older | the target link takes the earlier adder and time; one `merged` entry |
| a contact carrying only the target | untouched, no entry |
| a merge of a tag no contact carries | no entry, no link change |
| another workspace's links of a tag with the same name | untouched (AC-12) |

## Definition of Done

- [ ] Integration tests on the AC-09 seed prove the merge leaves 14 contacts on "VIP", keeps each contact's original or earlier adder and time, writes exactly one merged entry on each of the 3 contacts that carried the merged tag and none on target-only contacts, and that delete-with-RETURNING plus the deleted entries cover exactly the 40 carriers, with nothing touched in another workspace.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
