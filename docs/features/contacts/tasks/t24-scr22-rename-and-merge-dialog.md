---
id: T24
title: "Build SCR-22, the RenameTagDialog with its merge step: name rules in place, TAG_NAME_TAKEN turned into the merge offer, TAG_MERGE_TARGET_CHANGED re-ask"
layer: "ui"
deps: ["T23"]
blocks: ["T25", "T26"]
acs: ["AC-07", "AC-09", "AC-14"]
files_hint: ["apps/web/src/features/tags/RenameTagDialog.tsx", "apps/web/src/features/tags/RenameTagDialog.test.tsx", "apps/web/src/features/tags/TagsSettings.tsx"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T24 — Build SCR-22, the RenameTagDialog with its merge step: name rules in place, TAG_NAME_TAKEN turned into the merge offer, TAG_MERGE_TARGET_CHANGED re-ask

## Place in the sequence

- **Blocked by:** T23 — Build Settings — Tags (SCR-21) with the counts as links and the DeleteTagDialog (SCR-23), the owner-only Tags section in SettingsLayout and its route · **Blocks:** T25 — Add browser end-to-end contacts flows against the real API: list and filter, profile reading without marking read, tagging live between two members, owner rename / merge / delete, the operator refusal, T26 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the contacts routes and tables, the contacts → workspaces edge, the new signals and the new components · **Wave:** 5 — after T23.
- **Lane:** Shares `apps/web/src/features/tags/TagsSettings.tsx` with T23 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to rename, merge and delete the workspace's tags
> **So that** one kind of customer has one tag and the list stays usable
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It lets the owner fix a look-alike tag by renaming it into the existing one, with both tags and counts stated before anything changes.

## Inlined context

> 9. **The merge is step 2 of the rename `Dialog`** (SCR-22), not a separate dialog: on `409 TAG_NAME_TAKEN` the dialog's body and buttons change to the merge offer, and **Back** returns to the name field with the typed name kept. The delete (SCR-23) is an `AlertDialog`, because it cannot be undone; the merge is in a `Dialog` whose confirm button is `destructive`.
>
> — `screens.md §Decisions, 9, verbatim` · full text: [screens.md](../screens.md)

> | State | Trigger / condition | Components (from the inventory) | Source-ref |
> | --- | --- | --- | --- |
> | default | opened — title «Rename tag», `Field` «Name» prefilled with the current name and selected; **Cancel** / **Save** (AC-09; flow 13) | NEW: RenameTagDialog (Dialog, Field, Input, Label, Button) | wireframe «rename» |
> | validation | **Save** with a name that tidies to empty or to more than 32 characters — checked in the browser, nothing sent; `FieldError` «A tag name must be 1 to 32 characters»; the same for a server `400 TAG_NAME_INVALID` (AC-07; flow 13) | NEW: RenameTagDialog, Field (`FieldError`) | — |
> | pending | **Save** or **Merge tags** pressed — spinner on the button, both buttons disabled, Esc ignored (flow 13) | NEW: RenameTagDialog | — |
> | success: renamed | `200` `outcome: renamed` — the dialog closes; the row shows the new name in its new place; a case- or spacing-only change («vip» → «VIP») only changes how it is shown (AC-09, AC-14; flow 13) | NEW: RenameTagDialog | — |
> | success: unchanged | `200` `outcome: unchanged` (the same text) — the dialog closes, nothing changes (AC-09; flow 13) | NEW: RenameTagDialog | — |
> | merge offer | `409 TAG_NAME_TAKEN` — the dialog turns into step 2: title «Merge into «VIP»?»; «A tag named «VIP» already exists (12 contacts). Merging moves the 3 contacts of «Loyal» to «VIP» — a contact that has both keeps one — and «Loyal» is gone. Each of those contacts' tag history records the merge. This cannot be undone.»; **Back** (to step 1, the typed name kept) / **Merge tags** (`destructive`). The counts come from `details.tag.contact_count` and the row's own count (AC-09; flow 13; S2) | NEW: RenameTagDialog (Dialog, Button) | wireframe «merge step» |
> | success: merged | `200` `outcome: merged` — the dialog closes; «Loyal» leaves the list, «VIP» shows its new count (`tag.contact_count`, 14 in the AC example); the success notice of SCR-21 (AC-09; flow 13; S2) | NEW: RenameTagDialog | — |
> | refused: merge target changed | `409 TAG_MERGE_TARGET_CHANGED` — with `details.name_holder` set: step 2 again, now naming that tag and its count, with the notice «The tag to merge into changed — check again.»; with `name_holder: null`: back to step 1 with that notice, where **Save** now renames plainly (AC-09; flow 13) | NEW: RenameTagDialog, Alert | — |
> | refused: tag gone | `404 TAG_NOT_FOUND` (deleted or merged meanwhile) — the dialog closes; SCR-21 `refused: tag gone` (AC-14; flow 13) | — | — |
> | refused: owners only | `403 OWNER_ONLY` — the dialog closes; SCR-21 `owners only: lost meanwhile` (AC-11; flow 13) | — | — |
> | error | network / `500` — destructive `Alert` «Couldn't rename the tag — try again.» in the dialog; buttons enabled again (flow 13) | Alert (destructive) | — |
> | loading / empty | N/A: a form over data already on screen | — | — |
> | guard states | → §Shared states | — | §Shared states |
>
> — `screens.md §SCR-22, state table, verbatim` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `renameTag` `{ name }` → `TagRenameResult` (`renamed` / `unchanged`); `409 TAG_NAME_TAKEN { tag }` → step 2; confirm resends `{ name, merge_into_tag_id: details.tag.id }` → `merged`; `409 TAG_MERGE_TARGET_CHANGED { name_holder }` → re-ask; `400 TAG_NAME_INVALID`; `404 TAG_NOT_FOUND`; `403 OWNER_ONLY`.

— `contracts/openapi.yaml, operationId renameTag, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

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

### AC-14 — domain invariant

> **Given** an operator whose tag control on a contact of "Acme Flowers" still offers the tag "Old promo"
> **When** a business owner deletes "Old promo" (or merges it into another tag) before the operator picks it
> **Then** the tag is not added, the operator is told that this tag no longer exists, and the control shows the current tags; when the owner only renamed the tag, picking it adds the renamed tag under its new name and no tag with the old name is created; a contact never carries a tag that is not in the workspace's tag list
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `RenameTagDialog` (Dialog, Field, Input, Label, Button, Alert) with both steps and every SCR-22 state, the shared name check before sending — `apps/web/src/features/tags/RenameTagDialog.tsx` (+ test)
- [ ] Open it from SCR-21's Rename (replace the stub) and re-read `listTags` after `renamed` / `merged` — `apps/web/src/features/tags/TagsSettings.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| «Loyal» → «vip» while «VIP» (12) exists | step 2 «Merge into «VIP»?» naming 12 and 3 (AC-09) |
| Back on step 2 | step 1 with the typed name kept |
| `name_holder: null` | step 1 with the notice; Save renames plainly |
| an empty or 33-grapheme name | «A tag name must be 1 to 32 characters», nothing sent (AC-07) |

## Definition of Done

- [ ] Testing Library tests cover every SCR-22 state in screens.md (default, name rules in place, pending, renamed, unchanged, the merge offer with both counts, merged, merge target changed with and without a holder, tag gone, owners only, error) and that the merge confirm sends merge_into_tag_id from TAG_NAME_TAKEN.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
