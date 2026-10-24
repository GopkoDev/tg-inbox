---
id: T32
title: "Build the tag audience on SCR-25: TagFilter's controlled mode for Send to, the Leave out popover, the chosen and left-out badges, the dropped-tag notice and the over-10 000 warning, and SCR-32 SwitchAudienceDialog"
layer: "ui"
deps: ["T31"]
blocks: ["T33"]
acs: ["AC-01", "AC-03", "AC-05"]
files_hint: ["apps/web/src/features/contacts/TagFilter.tsx", "apps/web/src/features/contacts/TagFilter.test.tsx", "apps/web/src/features/broadcasts/TagAudience.tsx", "apps/web/src/features/broadcasts/TagAudience.test.tsx", "apps/web/src/features/broadcasts/SwitchAudienceDialog.tsx", "apps/web/src/features/broadcasts/SwitchAudienceDialog.test.tsx", "apps/web/src/features/broadcasts/BroadcastEditor.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T32 — Build the tag audience on SCR-25: TagFilter's controlled mode for Send to, the Leave out popover, the chosen and left-out badges, the dropped-tag notice and the over-10 000 warning, and SCR-32 SwitchAudienceDialog

## Place in the sequence

- **Blocked by:** T31 — Build SCR-25, the draft editor's Message card and frame: name and text saved as you go with the remaining length by the shared rule, the status line and the stale-save merge, AudienceBreakdown, the role-aware title actions with the launch pre-check refusals in place, and SCR-31 DeleteDraftDialog · **Blocks:** T33 — Build the broadcast group on SCR-25 and SCR-26: BroadcastGroupList with tags, blocked markers and Remove, and GroupPicker over the Contacts read with membership marks, Add, and the two-step Add all matching · **Wave:** 6 — after T31.
- **Lane:** shares `apps/web/src/features/broadcasts/BroadcastEditor.tsx` with T31; shares `apps/web/src/features/broadcasts/BroadcastEditor.tsx` with T33; shares `apps/web/src/features/broadcasts/BroadcastEditor.tsx` with T36 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to write a broadcast's text and choose its audience by contact tags, seeing how many contacts it would reach
> **So that** the team can prepare a message for a group of customers before anyone sends it
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

It lets a member choose who a draft is for by tags — with the Contacts filter's own rules plus tags to leave out — and switch away from a hand-picked group without losing it by accident.

## Inlined context

> - **Reuse:** the group picker (SCR-26) composes the Contacts list's search box, tag filter and row components from `features/contacts` and `features/tags`, against the same `GET …/contacts` read, so matching and counts are the Contacts list's by construction (AC-04). …
>
> — `sad.md §4, UI architecture, Reuse, abridged` · full text: [sad.md](../sad.md)

> 6. **The tag audience** reuses the Contacts tag filter in a controlled mode (extended: TagFilter — `value` / `onChange` instead of the page address): the **Send to** button opens the same mode `RadioGroup` + tag `Checkbox` list with counts. A second button, **Leave out**, opens a `Popover` with a `Checkbox` per tag (a chosen tag is disabled there and vice versa; «No tags» mode disables Leave out). Both buttons label themselves like TagFilter («Tags · 2», «Leave out · 1»). Below them the chosen and left-out tags show as `Badge`s («VIP», «− Staff» `outline`).
>
> — `screens.md §Decisions taken at this stage, 6, verbatim` · full text: [screens.md](../screens.md)

> | default: tag audience | **Send to** (extended: TagFilter controlled) and **Leave out**, the chosen / left-out `Badge`s, and the AudienceBreakdown «Audience 38 · blocked the bot 2 · never wrote to the current bot 0 · Would reach 36» |
> | notice: dropped tag | `dropped_tags` not empty — `Alert` in the Audience card «“Old promo” no longer exists, so it was left out of this audience.» (one line per tag); it goes at the next audience save |
> | notice: tag gone on save | `404 TAG_NOT_FOUND` on an audience save — the tag store re-reads `listTags`, the tag is unchecked, and the same notice shows; nothing saved |
> | notice: over 10 000 | `audience_size` > 10 000 — `Alert` (default) «This audience holds 10 420 contacts. A broadcast can reach at most 10 000 — narrow it down to launch.»; the draft is saved |
> | switch kind | «Hand-picked group» on a tag audience — `saveBroadcastAudience { kind: group }` at once; «Contacts with tags» on a non-empty group → SCR-32; on an empty group, at once |
> | saving | audience controls show a spinner on the used control · | phone | Send to / Leave out buttons go full width |
>
> — `screens.md §SCR-25, tag-audience states, abridged` · full text: [screens.md](../screens.md)

> | default | «The hand-picked group of 14 contacts will be removed from this draft.»; **Keep the group** (focused) / **Switch** |
> | switching | spinner, both disabled · | switched | `200` — the dialog closes; the Audience card shows the tag audience (any of, no tag = every contact) and its breakdown |
> | asks again | `409 BROADCAST_GROUP_CHANGED` — the dialog stays with the new size from `details.group_size` and «The group changed while you were deciding.»; the next confirm sends it |
> | stale / launched | `409 BROADCAST_DRAFT_CHANGED` / `BROADCAST_NOT_A_DRAFT` — the dialog closes; SCR-25's stale notice or SCR-28 · | cancelled | **Keep the group** — the kind stays · | error | «Couldn't switch the audience» |
>
> — `screens.md §SCR-32, states, abridged` · full text: [screens.md](../screens.md)

> | TagFilter | `apps/web/src/features/contacts/TagFilter.tsx:23` | button «Tags» / «Tags · N» / «All of N tags» / «No tags»; popover with mode RadioGroup (any of / all of / no tags) and one Checkbox per tag with its c… |
>
> — `docs/design-system.md §Inventory, TagFilter, abridged` · full text: [design-system.md](../../../design-system.md)

> **Hard rule:** **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `POST …/broadcasts/{id}/audience` — `TagAudience { expected_version, kind: tags, mode: any | all | none, tag_ids, exclude_tag_ids, expected_group_size? }` (`expected_group_size` required when switching from a non-empty group) or `{ expected_version, kind: group }` → `200 BroadcastDraft` with `audience: DraftTagAudience { mode, tags[{ tag_id, name, kind: include | exclude }], dropped_tags[] }` and the `breakdown`.
- Errors rendered: `400 VALIDATION_ERROR`, `404 TAG_NOT_FOUND`, `409 BROADCAST_DRAFT_CHANGED` (`details.draft`), `409 BROADCAST_GROUP_CHANGED` (`details.group_size`), `409 BROADCAST_NOT_A_DRAFT`.
- Tags for the popovers: the existing `listTags` through the tags store.

— `contracts/openapi.yaml, operationId saveBroadcastAudience, schemas BroadcastAudienceSave, DraftTagAudience, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers", whose bot is connected and working, where "VIP" is on 40 contacts, "Kyiv" on 120 and "Staff" on 3 (two of them also "VIP"), and 2 of the "VIP" contacts have blocked the bot
> **When** they open Broadcasts, create a broadcast named "Spring prices", type its text, choose a tag audience "any of" "VIP" with "Staff" left out, and leave the page
> **Then** a draft "Spring prices" is saved with its text and audience and is listed on Broadcasts for every member of "Acme Flowers" with its status "draft", its audience and who last changed it; while editing, the draft shows that its audience matches 38 contacts, of whom 2 cannot be reached because they blocked the bot and 0 because they never wrote to the current bot, so it would reach 36 (the same breakdown the launch confirmation shows); the count follows the same rules as the Contacts tag filter ("any of", "all of", "no tags"; no tag chosen means every contact), and a contact carrying any left-out tag is never counted; a tag renamed since still works under its new name, and a tag deleted or merged away is dropped from the audience with a notice saying so; reopening the draft later shows the same text and audience with the count as it is now; nothing is sent to any customer
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-03 — error

> **Given** two members of "Acme Flowers" with the same draft open
> **When** one changes the text or the audience and saves, and then the other saves a change made on the older version; or both add and remove contacts in the draft's group at the same moment
> **Then** the second text or audience change is not saved over the first: that member is told that a teammate changed the draft and is shown the current version to apply their change again; group additions and removals by both members are each kept (a contact added by one and not removed by the other stays in the group), so no one's additions silently disappear, and adding or removing group contacts never makes a teammate's text or name save count as stale
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — domain invariant

> **Given** a draft of "Acme Flowers" whose group holds 9 990 contacts
> **When** an operator adds a contact who is already in the group, or chooses "add all matching" for a filter matching 50 contacts not in the group, or a tag audience would match more than 10 000 contacts
> **Then** a contact already in the group is not added twice and the group says it is already there; the bulk add is refused as a whole and the editor says that a broadcast's audience can hold at most 10 000 contacts (reachable or not) and how many can still be added; a tag audience matching more than 10 000 contacts, reachable or not, can be saved as a draft but not launched, and says so; a group only ever holds contacts of its own workspace
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [x] Extend `TagFilter` with a controlled mode (`value` / `onChange`, no address read or write); the address-bound Contacts list stays unchanged — `apps/web/src/features/contacts/TagFilter.tsx`, `TagFilter.test.tsx`
- [x] `TagAudience`: **Send to** (controlled TagFilter), **Leave out** `Popover` + `Checkbox`es with the mutual disabling and «No tags» disabling Leave out, the `Badge`s, the dropped-tag and over-10 000 `Alert`s, a save per choice through the draft store — `apps/web/src/features/broadcasts/TagAudience.tsx`
- [x] Kind `RadioGroup` wiring in the Audience card: to group at once; to tags at once on an empty group, else SCR-32 — `apps/web/src/features/broadcasts/BroadcastEditor.tsx`
- [x] `SwitchAudienceDialog` on `AlertDialog`, sending the size it shows and re-asking on `BROADCAST_GROUP_CHANGED`, after `DeleteTagDialog`'s pattern — `apps/web/src/features/broadcasts/SwitchAudienceDialog.tsx`
- [x] Testing Library tests per state above — `TagAudience.test.tsx`, `SwitchAudienceDialog.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| no tag chosen with «any of» | every contact; breakdown shows the whole base |
| a tag chosen in Send to | disabled in Leave out, and the reverse |
| mode «No tags» | Leave out disabled |
| a tag renamed by an owner | shown under its new name (current name in `tags`) |
| a tag deleted before the save | `TAG_NOT_FOUND` → unchecked, notice, nothing saved |
| the group grew while the switch dialog was open | `BROADCAST_GROUP_CHANGED` → new size shown, the next confirm sends it |

## Definition of Done

- [x] Testing Library tests cover every tag-audience state of SCR-25 and every SCR-32 state in screens.md: TagFilter driven by value / onChange without touching the address (the Contacts list behaviour unchanged), a chosen tag disabled in Leave out and the reverse, No tags disabling Leave out, the dropped-tag notice by stored name, the over-10 000 warning, the switch confirmation naming the group size and re-asking on BROADCAST_GROUP_CHANGED.
- [x] The existing TagFilter and Contacts list tests still pass unchanged (the address-bound mode is untouched).
- [x] every Hard Rule inlined above still holds
- [x] lint + vet clean (`pnpm lint`)

## Implementation notes

- `implement` (T32): `TagFilter` was already driven only by `mode` / `tagIds` / `onChange` (the Contacts list binds them to its address in `ContactsTable`), so the "controlled mode" is three optional props: `label` (the trigger reads «Send to», «Send to · Any of 2», «Send to · All of 2», «Send to · No tags» — the wireframe's wording), `disabledTagIds` (tags left out elsewhere) and `adornment` / `triggerClassName` (the saving spinner, full width on phones). Without them it renders exactly as before; the existing TagFilter and Contacts list tests pass unchanged.
- `implement` (T32): `TagAudience({ workspaceId })` reads the draft from the draft store and the tags from the tags store (loads them once per workspace): **Send to** (TagFilter with `label`) and **Leave out** (`Popover` + `Checkbox`es, disabled under «No tags»; a chosen tag is disabled in the other control), `Badge`s («VIP» secondary, «− Staff» outline) under the current tag names, one notice per `dropped_tags` name and per tag gone on save, and the over-10 000 `Alert`. Each choice sends the whole tag audience through `saveAudience` (left-out tags cleared under «No tags», which the contract refuses otherwise); the choice shows at once and gives way to the draft's answer.
- `implement` (T32): **deviation** — `draft-store.ts` (outside files_hint) gained `tagGone` / `clearTagGone()`: a `TAG_NOT_FOUND` audience save is no longer kept for a retry (it would fail forever); the store marks the tag id, `TagAudience` names it from the tags it held, unchecks it (shows the draft's answer), re-reads the tags in the background and clears the mark.
- `implement` (T32): `SwitchAudienceDialog({ open, onClose })` on `AlertDialog`, after `DeleteDraftDialog` / `DeleteTagDialog`: sends `{ kind: tags, mode: any, tag_ids: [], exclude_tag_ids: [], expected_group_size }` through the draft store with the size it shows; `BROADCAST_GROUP_CHANGED` (the store's `groupChanged`) shows the new size with «The group changed while you were deciding.» and the next Switch sends it; switched, stale or launched closes it (the editor shows its own notice); any other failure «Couldn't switch the audience». The editor opens it for «Contacts with tags» on a non-empty group; the tag audience is rendered by the editor itself, `audienceControls` now carries only the group's controls (T33).
- `implement` (T32): new components `TagAudience` and `SwitchAudienceDialog` are not yet registered in `docs/design-system.md` — the canon update is T40's.
- `implement` (T32): RED — TagFilter `Unable to find an accessible element with the role "button" and name "Send to"`; `Failed to resolve import "./TagAudience"` / `"./SwitchAudienceDialog"`; editor `Unable to find role="heading" and name "Switch to contacts with tags?"` (GOOD red). One BAD red fixed in the test (`ErrorCode.INTERNAL` → `INTERNAL_ERROR`). GREEN found a double `onClose` (effect re-run on a new callback) — fixed with a ref.
- `implement` (T32): gate — `pnpm lint` clean; full `pnpm test`: only `e2e/contacts-load`, `inbox/http/changes` p95 and `migrations.int` (known set) failed; all green re-run alone.

