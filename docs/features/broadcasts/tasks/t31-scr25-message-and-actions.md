---
id: T31
title: "Build SCR-25, the draft editor's Message card and frame: name and text saved as you go with the remaining length by the shared rule, the status line and the stale-save merge, AudienceBreakdown, the role-aware title actions with the launch pre-check refusals in place, and SCR-31 DeleteDraftDialog"
layer: "ui"
deps: ["T30"]
blocks: ["T32", "T34", "T36"]
acs: ["AC-02", "AC-03", "AC-07", "AC-10"]
files_hint: ["apps/web/src/features/broadcasts/BroadcastEditor.tsx", "apps/web/src/features/broadcasts/BroadcastEditor.test.tsx", "apps/web/src/features/broadcasts/AudienceBreakdown.tsx", "apps/web/src/features/broadcasts/AudienceBreakdown.test.tsx", "apps/web/src/features/broadcasts/DeleteDraftDialog.tsx", "apps/web/src/features/broadcasts/DeleteDraftDialog.test.tsx", "apps/web/src/pages/BroadcastDetailPage.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T31 — Build SCR-25, the draft editor's Message card and frame: name and text saved as you go with the remaining length by the shared rule, the status line and the stale-save merge, AudienceBreakdown, the role-aware title actions with the launch pre-check refusals in place, and SCR-31 DeleteDraftDialog

## Place in the sequence

- **Blocked by:** T30 — Build SCR-24, the Broadcasts list: BroadcastsTable with statuses, audience sizes and last change, the empty state with New broadcast, the Broadcasts navigation item, the broadcast routes and BroadcastCrumb · **Blocks:** T32 — Build the tag audience on SCR-25: TagFilter's controlled mode for Send to, the Leave out popover, the chosen and left-out badges, the dropped-tag notice and the over-10 000 warning, and SCR-32 SwitchAudienceDialog, T34 — Build SCR-27, the LaunchConfirmDialog on the /launch address: the exact text, the count, who is left out and why, the risk warning, launch with the version and fingerprint, the re-ask on a changed draft or audience, and the operator redirect, T36 — Build SCR-30, the DuplicateBroadcastDialog from the list, the draft and the broadcast page: the audience choice with per-option counts, "did not reach" disabled until the broadcast ends, and the not-confirmed warning · **Wave:** 5 — after T30.
- **Lane:** shares `apps/web/src/pages/BroadcastDetailPage.tsx` with T30; shares `apps/web/src/features/broadcasts/BroadcastEditor.tsx` with T32; shares `apps/web/src/features/broadcasts/BroadcastEditor.tsx` with T33; shares `apps/web/src/pages/BroadcastDetailPage.tsx` with T34; shares `apps/web/src/pages/BroadcastDetailPage.tsx` with T35; shares `apps/web/src/features/broadcasts/BroadcastEditor.tsx` with T36 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to write a broadcast's text and choose its audience by contact tags, seeing how many contacts it would reach
> **So that** the team can prepare a message for a group of customers before anyone sends it
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

It is the draft editor every member writes in, saving the name and text against the version shown and showing — for owners only — the way to launch.

## Inlined context

> 4. **The editor is two cards** side by side at `lg` and stacked below it: **Message** (Name `Input`, Text `Textarea` with the remaining-length line) and **Audience** (the kind `RadioGroup` «Contacts with tags» / «Hand-picked group», the kind's controls, then the count breakdown). Actions sit in the page title row: **Launch** (owner, primary), **Duplicate** (outline), and **Delete** in a «More» `DropdownMenu` (author or owner).
> 5. **The remaining length** reads «4 096 characters left» from the shared rule (`broadcastTextLength`, ADR-0012) and turns into the field error «The text must be 1 to 4096 characters as Telegram counts them — 5 over» when exceeded; nothing is saved while invalid. An emoji counts as Telegram counts it (2 for most), so the counter can drop by 2.
> 7. **The count breakdown** (CONTEXT *Count breakdown*) is one component, NEW: AudienceBreakdown, used on SCR-25 (live draft numbers), SCR-27 (confirmation) and SCR-28 (frozen at launch): four lines — «Audience 38 contacts», «Left out — blocked the bot 2», «Left out — never wrote to the current bot 0», and the emphasised «Would reach 36» (SCR-28: «Sent to 36»). With `reach: null` only the first line and «Reach is known once a bot is connected.»
>
> — `screens.md §Decisions taken at this stage, 4, 5, 7, verbatim` · full text: [screens.md](../screens.md)

> **Chosen:** Option 1. It counts what Telegram counts, and it is the cheapest measure (no segmenter). …
>
> — `adr/0012-count-broadcast-text-in-utf-16-code-units-after-trimming-with-one-shared-rule.md §Decision outcome, ADR-0012, abridged` · full text: [ADR-0012](../adr/0012-count-broadcast-text-in-utf-16-code-units-after-trimming-with-one-shared-rule.md)

> | loading | the two cards as `Skeleton`s · | new, empty | `/new` — empty Name and Text, the Audience card disabled with «Name the broadcast to start», no actions; nothing is created until the first valid name |
> | created | `createBroadcast` `201`; the address becomes the draft's (`replace`), the status line «Saved», the Audience card enables |
> | no bot | `breakdown.reach: null` — only «Audience 38 contacts» and «Reach is known once a bot is connected.» (owner: + link **Open bot settings** → SCR-08) |
> | saving | the status line «Saving…»; inputs stay editable |
> | validation: name / text | `FieldError` «A name must be 1 to 80 characters» / «The text must be 1 to 4096 characters as Telegram counts them» (+ «— N over»), `aria-invalid`, nothing sent; also on `400 BROADCAST_NAME_INVALID` / `BROADCAST_TEXT_INVALID` |
> | stale save | `409 BROADCAST_DRAFT_CHANGED` — `Alert` «A teammate changed this draft. Their version is shown; your edit is kept below to apply again.»; the touched field shows the teammate's value with the member's own text in a muted box under it and **Use mine** / **Keep theirs** |
> | launched meanwhile | `409 BROADCAST_NOT_A_DRAFT` on any save, or `broadcast.changed { status }` — the view switches to SCR-28 with `Alert` «This broadcast was launched and can no longer be changed.» |
> | actions: owner / operator | owner: **Launch**, **Duplicate**, «More» → **Delete**; operator: no **Launch**, a muted line «Only a business owner launches broadcasts.», **Delete** only on their own draft, otherwise the disabled item «A draft is deleted by its author or a business owner» |
> | launch: checking / refused | `getLaunchConfirmation` in flight (spinner); `409 BROADCAST_NEEDS_WORKING_BOT` (`not_connected` / `needs_token` / `taken_over`, each + **Open bot settings**), `BROADCAST_AUDIENCE_TOO_LARGE`, `BROADCAST_NO_REACHABLE_CONTACT` (with the breakdown), `429 BROADCAST_LAUNCH_LIMIT_REACHED` («… The next launch is possible at 14:20 tomorrow.»), `400 BROADCAST_TEXT_INVALID` («Write the text before launching», focus), `403 OWNER_ONLY` (note replaces Launch); `200` → SCR-27 at `/launch` |
> | duplicate | `duplicateBroadcast { audience: same }` → the copy's editor · | error | «Couldn't load this broadcast» + **Retry**; a failed save → «Couldn't save — Retry», the edit kept |
> | phone | below `lg` the Message card stacks above the Audience card; below `sm` the title row wraps (**Launch** full width first) |
>
> — `screens.md §SCR-25, states (message, breakdown, actions, launch pre-check), abridged` · full text: [screens.md](../screens.md)

> | default | «This draft and its audience of 14 contacts will be deleted. This can't be undone. Nothing is sent to anyone.»; **Cancel** (focused) / **Delete draft** (destructive) |
> | deleting | spinner, both disabled, Esc ignored · | deleted | `200` — back to SCR-24 (from the editor) or the row disappears (from the list) |
> | refused: not author | `403 FORBIDDEN` — destructive `Alert` «A draft is deleted by its author or a business owner.»; only **Close** |
> | refused: launched | `409 BROADCAST_NOT_A_DRAFT` — the dialog closes; SCR-28 · | gone | `404` — the dialog closes; the list re-reads · | error | «Couldn't delete the draft» |
>
> — `screens.md §SCR-31, states, abridged` · full text: [screens.md](../screens.md)

> - On SCR-25 a `broadcast.changed` with `change: status` for the open draft (a teammate launched it) switches the address's view to SCR-28 with a one-line `Alert` «A teammate launched this broadcast.»; `deleted` shows `NotFoundCard` with «This draft was deleted.»
>
> — `screens.md §Assumptions, SCR-25 live, abridged` · full text: [screens.md](../screens.md)

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

- `GET …/broadcasts/{id}` → `BroadcastDraft { version, name, text, author, audience, breakdown: { audience_size, reach: { blocked_count, never_wrote_count, reachable_count } | null } }`; `POST …/broadcasts` → `201`; `POST …/save { expected_version, name?, text? }` → `200 BroadcastDraft`; `400 BROADCAST_NAME_INVALID` / `BROADCAST_TEXT_INVALID`, `409 BROADCAST_DRAFT_CHANGED` (`details.draft`), `409 BROADCAST_NOT_A_DRAFT`.
- `GET …/launch-confirmation` → `200 LaunchConfirmation` (opens SCR-27, T34) or `400 BROADCAST_TEXT_INVALID`, `403 OWNER_ONLY`, `409 BROADCAST_NEEDS_WORKING_BOT` (`details.bot_state`) / `BROADCAST_AUDIENCE_TOO_LARGE` / `BROADCAST_NO_REACHABLE_CONTACT`, `429 BROADCAST_LAUNCH_LIMIT_REACHED` (`details.next_launch_at`).
- `POST …/delete` → `200 BroadcastDeleted`; `403 FORBIDDEN`, `404`, `409 BROADCAST_NOT_A_DRAFT`. `POST …/duplicate { audience: same }` → `201`.

— `contracts/openapi.yaml, operationIds getBroadcast, createBroadcast, saveBroadcastFields, getLaunchConfirmation, deleteBroadcast, duplicateBroadcast, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-02 — error

> **Given** an operator editing a draft broadcast of "Acme Flowers"
> **When** they leave the name empty or make it longer than 80 characters, leave the text empty or only spaces, or make it longer than Telegram allows for one message
> **Then** the draft keeps its last valid content, nothing is sent, and the editor says next to the field that a name must be 1 to 80 characters, or that the text must be 1 to 4096 characters as Telegram counts them; the remaining length is shown while typing, counted the way Telegram counts it, so an emoji-heavy text is never accepted by the editor and then refused by Telegram for its length
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-03 — error

> **Given** two members of "Acme Flowers" with the same draft open
> **When** one changes the text or the audience and saves, and then the other saves a change made on the older version; or both add and remove contacts in the draft's group at the same moment
> **Then** the second text or audience change is not saved over the first: that member is told that a teammate changed the draft and is shown the current version to apply their change again; group additions and removals by both members are each kept (a contact added by one and not removed by the other stays in the group), so no one's additions silently disappear, and adding or removing group contacts never makes a teammate's text or name save count as stale
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-07 — authorization

> **Given** an operator (not a business owner) of "Acme Flowers"
> **When** they open a draft they could launch if they were an owner, or try to launch it in any other way (for example from a saved link to the confirmation), or try to delete a draft that a teammate created
> **Then** the draft shows no launch action and says that only a business owner launches broadcasts; the attempt sends nothing and changes nothing; the delete is refused with the explanation that a draft is deleted by its author or a business owner; the operator can still edit, duplicate and delete their own drafts
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — cross-context

> **Given** a business owner of "Acme Flowers" about to launch a draft
> **When** the workspace has no bot connected, or its bot is not working (the token was revoked), or the workspace connected a different bot since some of the audience last wrote
> **Then** with no bot or a bot that is not working, launch is refused, the draft stays a draft, and the owner is told why and offered the way to the bot settings; contacts who have never written to the bot connected now cannot be reached by it, so they are left out at launch and counted apart in the draft and the confirmation ("never wrote to the current bot"), and blocked marks learned with the old bot do not apply to the new one; reconnecting the same Telegram bot is not a change of bot, so its blocked marks and who wrote to it stay; drafts can be created, edited and duplicated while the bot is missing or not working
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `AudienceBreakdown` (four lines, the «Would reach» / «Sent to» emphasis, the no-bot variant with the owner's **Open bot settings** link) composing `Separator` and `Button` (link) — `apps/web/src/features/broadcasts/AudienceBreakdown.tsx`
- [ ] `BroadcastEditor`: the two `Card`s; the Message card with `Field`, `Label`, `Input`, `Textarea`, `FieldError`, the remaining length from the shared `broadcastTextLength` / name rule (T1); create at the first valid name with `replace`; save as you go through the draft store (T29); the status line; the stale-save view with **Use mine** / **Keep theirs**; the Audience card slot (filled by T32 / T33) with `RadioGroup` and the breakdown — `apps/web/src/features/broadcasts/BroadcastEditor.tsx`
- [ ] Title actions: **Launch** (owner) with the pre-check refusals as `Alert`s in place, **Duplicate**, «More» `DropdownMenu` with Delete by role and author; launched / deleted live switches — same file
- [ ] `DeleteDraftDialog` on `AlertDialog`, after `DeleteTagDialog`'s pattern — `apps/web/src/features/broadcasts/DeleteDraftDialog.tsx`
- [ ] Mount the editor for a draft on the detail page and `/new` — `apps/web/src/pages/BroadcastDetailPage.tsx`
- [ ] Testing Library tests per state above (incl. a 2-unit emoji dropping the counter by 2 and a 4101-unit text «— 5 over» with nothing sent) — `BroadcastEditor.test.tsx`, `AudienceBreakdown.test.tsx`, `DeleteDraftDialog.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| the text is only spaces after having had a value | field error, nothing saved, the last valid text stays saved |
| a name typed on `/new` that tidies to empty | nothing is created; no request |
| `403 OWNER_ONLY` on Launch (role changed meanwhile) | the operator's note replaces **Launch**; the role is re-read |
| the bot is missing (`reach: null`) | the editor works; only a launch is refused |
| a draft deleted by its author while open | `NotFoundCard` «This draft was deleted.» |
| the text contains `<b>` or a URL | shown as typed, plain text |

## Definition of Done

- [ ] Testing Library tests cover every SCR-25 Message-card, breakdown, title-action and live state in screens.md and every SCR-31 state: the remaining length counted in UTF-16 units with the field error past 4096, nothing saved while invalid, Saving… / Saved / Couldn't save — Retry, the stale-save view keeping the member's edit, no Launch for an operator with the owners-only note, Delete only for the author or an owner, each launch refusal with its message and the way to the bot settings, and the switch to the read-only page when a teammate launches.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
