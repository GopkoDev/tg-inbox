---
id: T36
title: "Build SCR-30, the DuplicateBroadcastDialog from the list, the draft and the broadcast page: the audience choice with per-option counts, \"did not reach\" disabled until the broadcast ends, and the not-confirmed warning"
layer: "ui"
deps: ["T31", "T35"]
blocks: ["T39", "T40"]
acs: ["AC-13"]
files_hint: ["apps/web/src/features/broadcasts/DuplicateBroadcastDialog.tsx", "apps/web/src/features/broadcasts/DuplicateBroadcastDialog.test.tsx", "apps/web/src/features/broadcasts/BroadcastsTable.tsx", "apps/web/src/features/broadcasts/BroadcastEditor.tsx", "apps/web/src/features/broadcasts/BroadcastPage.tsx"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
step: ""
---

# T36 — Build SCR-30, the DuplicateBroadcastDialog from the list, the draft and the broadcast page: the audience choice with per-option counts, "did not reach" disabled until the broadcast ends, and the not-confirmed warning

## Place in the sequence

- **Blocked by:** T31 — Build SCR-25, the draft editor's Message card and frame: name and text saved as you go with the remaining length by the shared rule, the status line and the stale-save merge, AudienceBreakdown, the role-aware title actions with the launch pre-check refusals in place, and SCR-31 DeleteDraftDialog, T35 — Build SCR-28, the read-only broadcast page with BroadcastReport (live totals, outcome filter, 50-recipient pages with plain reasons) and SCR-29 StopBroadcastDialog for business owners · **Blocks:** T39 — Add browser end-to-end broadcasts flows against the real API: draft a tag audience, build a group, launch and follow the live report, stop, duplicate "did not reach", the broadcast item in the thread, the blocked marker, and the operator's missing launch, T40 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the broadcasts module, its routes, tables, queues and signals, the new edges, contact_bot_reach and broadcast_items, and the new components · **Wave:** 6 — after T31, T35.
- **Lane:** shares `apps/web/src/features/broadcasts/BroadcastsTable.tsx` with T30; shares `apps/web/src/features/broadcasts/BroadcastEditor.tsx` with T31; shares `apps/web/src/features/broadcasts/BroadcastEditor.tsx` with T32; shares `apps/web/src/features/broadcasts/BroadcastEditor.tsx` with T33; shares `apps/web/src/features/broadcasts/BroadcastPage.tsx` with T35 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to duplicate any broadcast into a new draft with the same text and audience
> **So that** a follow-up goes to the same customers without picking them again
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It builds the dialog through which any member turns a broadcast into a new draft with a chosen copy of its audience, so a follow-up reaches the same customers — or only the ones it missed — without picking them again.

## Inlined context

> | default | a `RadioGroup` «Who should the copy go to?»: **The same tags** («Any of VIP · leaving out Staff — counted again when you launch»; shown only for a tag audience, preselected then), **All recipients** («36 contacts — those who blocked the bot stay in the group, counted as unreachable»; preselected for a group), **Only recipients it didn't reach** («2 contacts whose send failed for a reason a new attempt can fix»); **Cancel** / **Create draft** |
> | not reached: disabled | the broadcast is still sending — the third option is disabled with «Available once the broadcast has ended» |
> | not reached: not confirmed | the third option chosen and `totals.not_confirmed` > 0 — a `Checkbox` under it «Also include 3 recipients whose send was not confirmed» with the warning «They may already have received it.»; unchecked by default; checked sends `include_not_confirmed: true` |
> | creating | **Create draft** — spinner, buttons disabled |
> | created | `201` — the dialog closes and the copy's editor opens (SCR-25), named «Copy of Spring prices»; the original unchanged |
> | refused: not ended | `409 BROADCAST_NOT_ENDED` (the page was stale) — the third option turns disabled with its reason and a notice «It is still sending — choose another option or wait until it ends.» |
> | error | network / `500`, or `400` — destructive `Alert` «Couldn't create the copy» |
> | empty | N/A: the counts come from the page; a «did not reach» copy with 0 contacts still creates an empty group draft (contract) and the option reads «0 contacts» |
>
> — `screens.md §SCR-30, states (Source-ref column dropped), abridged` · full text: [screens.md](../screens.md)

> New, `Dialog` for a launched broadcast, from SCR-28 or a launched row of SCR-24. Title «Duplicate “Spring prices”». `duplicateBroadcast`.
>
> — `screens.md §SCR-30, intro, verbatim` · full text: [screens.md](../screens.md)

> - **Duplicates** are one transaction in `broadcasts`: a new draft row (author = the member, name "Copy of …" cut to 80 characters by the shared name rule, same text) plus a copy of the source's audience: the tag rows; the group rows; for a launched broadcast "all recipients" (every recipient row) or "only recipients it did not reach" (outcomes `failed` with reason `bot_stopped`, `text_refused` or `telegram_error`, plus `stopped`, plus `not_confirmed` only when the request carries `include_not_confirmed`), offered only when the broadcast has ended.
>
> — `sad.md §4, Supporting choices, Duplicates, verbatim` · full text: [sad.md](../sad.md)

> | DuplicateBroadcastDialog | SCR-30: the audience choice with per-option counts, the disabled-until-ended option and the not-confirmed checkbox warning; composes Dialog, RadioGroup, Checkbox, Label, Alert, Button | pending |
>
> — `screens.md §New components, DuplicateBroadcastDialog, verbatim` · full text: [screens.md](../screens.md)

**Assumptions (this task):** a **draft** is duplicated at once with `audience: same` (no dialog) from SCR-25 and a draft row of SCR-24 — SCR-30 is «for a launched broadcast» and `same` is the contract's draft default. The «All recipients» count is `launch_breakdown.recipient_count`. The «Only recipients it didn't reach» count is `not_reached_count` of `getBroadcast` (added to `LaunchedBroadcast` at `tasks`, api flag F-5; T17), and the not-confirmed checkbox count is `totals.not_confirmed`.

**Reuse:** `Dialog`, `RadioGroup`, `Checkbox`, `Label`, `Alert`, `Button` from `apps/web/src/shared/ui`; the draft store's duplicate action (T29); the openers on `BroadcastsTable` (T30), `BroadcastEditor` (T31) and `BroadcastPage` (T35). NEW: `DuplicateBroadcastDialog` only.

> | `401 UNAUTHENTICATED` on any broadcasts route | an open dialog (SCR-26, SCR-27, SCR-29…SCR-32) closes; an unsent edit in the editor is kept in the draft store for the same address; as the inherited 401 row → SCR-09, then back to the same address |
> | `403 ACCESS_REMOVED` on the same routes (including the launch and the stop), or the socket closes `4403` | an open dialog closes; as the inherited 403 row → SCR-07; nothing is launched or stopped; nothing of the workspace stays on screen |
> | guard `404 NOT_FOUND`, or `BroadcastNotFound` (unknown, deleted or foreign broadcast) | the frame shows `NotFoundCard` (inherited); no hint the workspace or the broadcast exists |
>
> — `screens.md §Screens, Shared states, abridged` · full text: [screens.md](../screens.md)

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `POST …/broadcasts/{broadcastId}/duplicate` body `BroadcastDuplicate { audience: same | same_tags | all_recipients | not_reached, include_not_confirmed? }` → `201 BroadcastDraft` (the copy, `version: 1`, name «Copy of …», author = caller).
- Errors: `400 VALIDATION_ERROR` (`details.field: audience` — a choice that does not fit the source), `404 BroadcastNotFound`, `409 BROADCAST_NOT_ENDED` (`not_reached` while the source still sends), guard `401` / `403 ACCESS_REMOVED`. Any member, either role.

— `contracts/openapi.yaml, operationId duplicateBroadcast, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-13 — happy path

> **Given** "Acme Flowers" with a draft "Wholesale catch-up" (a group of 14 contacts) and the sent broadcast "Spring prices" (tag audience; 33 delivered, 1 blocked the bot, 2 failed because the bot stopped working)
> **When** an operator duplicates the draft, and duplicates "Spring prices" choosing first "all recipients" and then "only recipients it did not reach"
> **Then** each duplicate is a new draft named "Copy of …" (shortened to fit 80 characters) with the same text, listed for every member, its author being the member who duplicated it, and the original is unchanged; the copy of the draft has the same group of 14 contacts; the copy of "Spring prices" with "all recipients" has a broadcast group of its 36 recipients, the one who blocked the bot counted as unreachable; "only recipients it did not reach" is offered once a broadcast has ended, and gives a group of the 2 who failed: it copies recipients who failed for a reason a new attempt can fix (the bot stopped working, Telegram refused the text, a Telegram error, stopped before their turn) and those marked "not confirmed" only after a warning that they may have received it, while recipients who were delivered, who blocked the bot or whose account no longer exists are not copied; a tag audience can also be duplicated as the same tags, evaluated again at the copy's launch; the copy is then edited and launched like any draft
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `DuplicateBroadcastDialog` (`Dialog`): the three options with per-option text and counts, `same_tags` only for a tag audience (preselected then; `all_recipients` preselected for a group), `not_reached` disabled while `status: sending` with its reason — `apps/web/src/features/broadcasts/DuplicateBroadcastDialog.tsx`
- [ ] The not-confirmed `Checkbox` + warning when `totals.not_confirmed` > 0 and `not_reached` is chosen; checked → `include_not_confirmed: true` — same file
- [ ] Creating state; `201` → close and navigate to the copy's editor; `409 BROADCAST_NOT_ENDED` → disable the option with the notice; `400` / `500` → «Couldn't create the copy» — same file
- [ ] Openers: Duplicate on SCR-28 and on launched rows of SCR-24 open the dialog; Duplicate on a draft (SCR-25, draft rows of SCR-24) posts `audience: same` at once and opens the copy — `BroadcastPage.tsx`, `BroadcastsTable.tsx`, `BroadcastEditor.tsx`
- [ ] Testing Library tests for every SCR-30 state above — `apps/web/src/features/broadcasts/DuplicateBroadcastDialog.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| the broadcast ended while the dialog was open from a stale page | the option was disabled; a `not_reached` post is not possible; reopening after the `status` re-read enables it |
| the page was stale (still shown ended, server says sending) | `409 BROADCAST_NOT_ENDED`: option disabled with «It is still sending — choose another option or wait until it ends.» (AC-13) |
| a stopped broadcast | `not_reached` enabled; its stopped recipients are included by the server (AC-18) |
| an operator | can duplicate any broadcast (AC-07) |
| «did not reach» with 0 contacts | still creates an empty group draft (contract); the copy's editor shows size 0 |
| a long name | the server cuts «Copy of …» to 80 graphemes; the editor shows the returned name (AC-13) |

## Definition of Done

- [ ] Testing Library tests cover every SCR-30 state in screens.md: a draft duplicated at once, a launched broadcast offering same tags (tag audiences only), all recipients and did not reach with their counts, did not reach disabled while sending, the not-confirmed checkbox and its warning sent as include_not_confirmed, BROADCAST_NOT_ENDED shown in place, and the new draft opened after 201.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
