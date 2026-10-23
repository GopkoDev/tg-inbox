---
id: T23
title: "Build Settings — Tags (SCR-21) with the counts as links and the DeleteTagDialog (SCR-23), the owner-only Tags section in SettingsLayout and its route"
layer: "ui"
deps: ["T18"]
blocks: ["T24"]
acs: ["AC-09", "AC-10", "AC-11"]
files_hint: ["apps/web/src/features/tags/TagsSettings.tsx", "apps/web/src/features/tags/TagsSettings.test.tsx", "apps/web/src/features/tags/DeleteTagDialog.tsx", "apps/web/src/features/tags/DeleteTagDialog.test.tsx", "apps/web/src/pages/TagSettingsPage.tsx", "apps/web/src/features/settings/SettingsLayout.tsx", "apps/web/src/features/settings/SettingsLayout.test.tsx", "apps/web/src/app/routes.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T23 — Build Settings — Tags (SCR-21) with the counts as links and the DeleteTagDialog (SCR-23), the owner-only Tags section in SettingsLayout and its route

## Place in the sequence

- **Blocked by:** T18 — Add the web contacts and tags API sources and stores, with the live subscriptions to contact.changed, tags.changed, conversation.changed (never mark read) and resync · **Blocks:** T24 — Build SCR-22, the RenameTagDialog with its merge step: name rules in place, TAG_NAME_TAKEN turned into the merge offer, TAG_MERGE_TARGET_CHANGED re-ask · **Wave:** 4 — after T18.
- **Lane:** Shares `apps/web/src/app/routes.tsx` with T19; shares `apps/web/src/app/routes.tsx` with T20; shares `apps/web/src/features/tags/TagsSettings.tsx` with T24 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to see how many contacts carry each tag and how many match a filter
> **So that** I know how many customers a future broadcast would reach
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It gives the business owner the tag list with each segment's size and a delete that states its cost first.

## Inlined context

> 7. **Settings — Tags is the third owner section**: the section menu reads Bot / Team / Tags / Notifications for an owner, and the owner's description becomes «Manage your workspace's bot, team and tags, and your notifications». An operator's menu is unchanged (Notifications only); on the Tags address an operator gets the in-place card «Only a business owner manages the workspace's tags» + **Back to inbox**, as Bot and Team do (AC-11).
> 8. **Owner actions are on each row** of SCR-21: **Rename** and **Delete** as ghost buttons on desktop, collapsed into a row-actions `DropdownMenu` («⋯») below `md`. The count is a link to `/w/<id>/contacts?tag=<id>` (AC-10).
>
> — `screens.md §Decisions, 7, verbatim` · full text: [screens.md](../screens.md)

> | State | Trigger / condition | Components (from the inventory) | Source-ref |
> | --- | --- | --- | --- |
> | loading | the section opens — a `Card` with 5 `Skeleton` rows (flow 12) | NEW: TagsSettings (Card, Table, Skeleton) | — |
> | default | `200` — Card title «Tags», description «Every tag of the workspace with the number of contacts carrying it. Tags are created on a contact, in the inbox or on the profile.»; a `Table` **Tag** · **Contacts** · actions, every tag in tag-list order, zero-count tags included; the count is a link «30 contacts» → SCR-18 `?tag=<id>` (Decision 8; «0 contacts» is plain text); **Rename** and **Delete** on each row; no way to create a tag here (AC-10; flow 12; `listTags` example) | NEW: TagsSettings (Card, Table, Button) | wireframe «settings tags» |
> | count chosen | the count link → SCR-18 filtered by that tag, showing the same number in «N of M contacts match» (AC-10; flow 12) | — | — |
> | success notice | after a merge or a delete — a one-line `Alert` above the table (««Loyal» merged into «VIP».» / ««Old promo» deleted.») until the next action or navigation; after a rename the row moves to its new place (assumption) | Alert | — |
> | refused: tag gone | an action answers `404 TAG_NOT_FOUND` — the dialog closes, the list re-reads, `Alert` «This tag no longer exists.» (AC-14; flow 13) | Alert | — |
> | empty | no tags — «No tags yet. Tags are created on a contact, in the inbox or on the profile.» in the card; no table (AC-10) | Card | — |
> | error | `listTags` fails (network / `500`) — destructive `Alert` «Couldn't load the tags» + **Retry** (flow 12) | Alert, Button | — |
> | owners only | an operator on the Tags address (a saved link) — the in-place card «Only a business owner manages the workspace's tags» + **Back to inbox**, as on Bot and Team; the operator's section menu shows no Tags (AC-11; flow 12) | Card, Button | — |
> | owners only: lost meanwhile | an action answers `403 OWNER_ONLY` (the role changed since the page opened) — the dialog closes and the section shows the owners-only card (AC-11; flow 13) | Card, Button | — |
> | phone (< md) | the section menu stacks above (inherited `SettingsLayout`); **Rename** / **Delete** collapse into a row-actions `DropdownMenu` «⋯» (Decision 8) | DropdownMenu | wireframe «settings tags» |
> | validation | N/A: no input on the list itself (rename has SCR-22) | — | — |
> | guard states | → §Shared states | — | §Shared states |
>
> — `screens.md §SCR-21, state table, verbatim` · full text: [screens.md](../screens.md)

> | State | Trigger / condition | Components (from the inventory) | Source-ref |
> | --- | --- | --- | --- |
> | default | opened — title «Delete «Old promo»?»; «It will be removed from 40 contacts. Each of them keeps a note in its tag history. This cannot be undone.» (`contact_count` from the list; with 0: «No contact carries it. This cannot be undone.»); **Cancel** / **Delete tag** (`destructive`) (AC-09; S2) | NEW: DeleteTagDialog (AlertDialog, Button) | wireframe «delete» |
> | pending | **Delete tag** pressed — spinner, both buttons disabled, Esc ignored (S2) | NEW: DeleteTagDialog | — |
> | success | `200` — the dialog closes; the row goes; the success notice of SCR-21 (AC-09; S2) | NEW: DeleteTagDialog | — |
> | asks again | `409 TAG_COUNT_CHANGED` — nothing was deleted; the text updates to `details.tag.contact_count` («It will be removed from 41 contacts…») with the notice above the buttons «The number of contacts changed since you opened this.»; **Delete tag** now sends the new number (AC-09; S2) | NEW: DeleteTagDialog, Alert | wireframe «delete» (asks again) |
> | refused: tag gone | `404 TAG_NOT_FOUND` — the dialog closes; SCR-21 `refused: tag gone` (AC-14; S2) | — | — |
> | refused: owners only | `403 OWNER_ONLY` — the dialog closes; SCR-21 `owners only: lost meanwhile` (AC-11; S2) | — | — |
> | error | network / `500` — destructive `Alert` «Couldn't delete the tag — try again.» in the dialog (S2) | Alert (destructive) | — |
> | loading / empty / validation | N/A: a confirmation over data on screen, no input | — | — |
> | guard states | → §Shared states | — | §Shared states |
>
> — `screens.md §SCR-23, state table, verbatim` · full text: [screens.md](../screens.md)

> - **Settings → Tags offers rename and delete only.** Merging happens by renaming a tag into an existing name. Tags are created only on a contact, through the picker (AC-09, AC-10).
>
> — `spec.md §1, Clarifications, Settings → Tags, verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `listTags` → `TagList`; `deleteTag` `{ expected_count }` → `TagDeleted` · `409 TAG_COUNT_CHANGED { tag }` (ask again with `tag.contact_count`) · `404 TAG_NOT_FOUND` · `403 OWNER_ONLY`.

— `contracts/openapi.yaml, operationIds listTags, deleteTag, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

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

### AC-11 — authorization

> **Given** an operator (not a business owner) of "Acme Flowers"
> **When** they look for the Tags section of Settings, or try to rename, merge or delete a tag (for example through a saved link to the section)
> **Then** Settings shows them no Tags section, the attempt changes nothing, and the panel says that only a business owner manages the workspace's tags; the operator can still add and remove tags on contacts and create new tags while doing so
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `SettingsLayout`: Tags section `ownerOnly`, the owner's description «Manage your workspace's bot, team and tags, and your notifications» — `apps/web/src/features/settings/SettingsLayout.tsx` (+ test)
- [ ] `TagsSettings` (Card, Table, Button, DropdownMenu, Alert, Skeleton) with every SCR-21 state; the count links to `/w/<id>/contacts?tag=<id>`; the Rename button opens T24's dialog (stub until then) — `apps/web/src/features/tags/TagsSettings.tsx` (+ test)
- [ ] `DeleteTagDialog` (AlertDialog, Alert, Button) after `CloseConfirmDialog`'s pattern — `apps/web/src/features/tags/DeleteTagDialog.tsx` (+ test)
- [ ] Page and route `settings/tags`; an operator on the address gets the owners-only card — `apps/web/src/pages/TagSettingsPage.tsx`, `apps/web/src/app/routes.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| an operator opens Settings | no Tags section (AC-11) |
| an operator opens `/w/<id>/settings/tags` | «Only a business owner manages the workspace's tags» + Back to inbox (AC-11) |
| `409 TAG_COUNT_CHANGED` 41 | the dialog says 41 and the next confirm sends 41 (AC-09) |
| a tag on 0 contacts | «0 contacts» as plain text; delete says no contact carries it |

## Definition of Done

- [ ] Testing Library tests cover every SCR-21 and SCR-23 state in screens.md (loading, default in tag-list order with counts as links and zero counts, success notice, tag gone, empty, error, owners only and lost meanwhile, phone row menu; delete default, pending, success, asks again with the new number, refusals, error) and prove an operator's Settings menu shows no Tags section.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
