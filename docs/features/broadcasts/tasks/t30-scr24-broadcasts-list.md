---
id: T30
title: "Build SCR-24, the Broadcasts list: BroadcastsTable with statuses, audience sizes and last change, the empty state with New broadcast, the Broadcasts navigation item, the broadcast routes and BroadcastCrumb"
layer: "ui"
deps: ["T29"]
blocks: ["T31", "T35"]
acs: ["AC-01", "AC-08"]
files_hint: ["apps/web/src/features/broadcasts/BroadcastsTable.tsx", "apps/web/src/features/broadcasts/BroadcastsTable.test.tsx", "apps/web/src/features/broadcasts/BroadcastCrumb.tsx", "apps/web/src/pages/BroadcastsPage.tsx", "apps/web/src/pages/BroadcastDetailPage.tsx", "apps/web/src/app/routes.tsx", "apps/web/src/app/routes.test.tsx", "apps/web/src/shared/ui/app-shell.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T30 — Build SCR-24, the Broadcasts list: BroadcastsTable with statuses, audience sizes and last change, the empty state with New broadcast, the Broadcasts navigation item, the broadcast routes and BroadcastCrumb

## Place in the sequence

- **Blocked by:** T29 — Add the web broadcasts API source and stores: the list store, the draft store (save as you go, one save in flight against the shown version, the stale-save merge, group adds and removes one by one) and the report store (totals plus one 50-recipient page, one fetch at a time), with the broadcast.changed subscriptions · **Blocks:** T31 — Build SCR-25, the draft editor's Message card and frame: name and text saved as you go with the remaining length by the shared rule, the status line and the stale-save merge, AudienceBreakdown, the role-aware title actions with the launch pre-check refusals in place, and SCR-31 DeleteDraftDialog, T35 — Build SCR-28, the read-only broadcast page with BroadcastReport (live totals, outcome filter, 50-recipient pages with plain reasons) and SCR-29 StopBroadcastDialog for business owners · **Wave:** 4 — after T29.
- **Lane:** shares `apps/web/src/pages/BroadcastDetailPage.tsx` with T31; shares `apps/web/src/pages/BroadcastDetailPage.tsx` with T34; shares `apps/web/src/pages/BroadcastDetailPage.tsx` with T35; shares `apps/web/src/features/broadcasts/BroadcastsTable.tsx` with T36 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to write a broadcast's text and choose its audience by contact tags, seeing how many contacts it would reach
> **So that** the team can prepare a message for a group of customers before anyone sends it
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

It gives every member the Broadcasts page and the addresses all other broadcasts screens hang from, with the list as the place to start a draft and follow statuses live.

## Inlined context

> - **Routes:** `/w/:workspaceId/broadcasts` (SCR-24), `/w/:workspaceId/broadcasts/:broadcastId` (one address, two views: SCR-25 while the broadcast is a draft, SCR-28 once it is launched, chosen from the status the read returns), and `/w/:workspaceId/broadcasts/:broadcastId/launch` (SCR-27 opened over SCR-25 for a business owner; an operator is redirected to the draft with the owners-only note). The Broadcasts item joins the workspace frame's navigation (SCR-15) for every member.
>
> — `sad.md §4, UI architecture, Routes, verbatim` · full text: [sad.md](../sad.md)

> 1. **Addresses** (sad.md §4): … The editor of a not-yet-created draft is `/w/<id>/broadcasts/new`; after `createBroadcast` answers `201` the address is replaced with the new id.
> 2. **Navigation:** a **Broadcasts** item (lucide `Megaphone`) in the frame's primary nav between Contacts and Settings, for both roles. The breadcrumb reads «Acme Flowers › Broadcasts › <name>» (NEW: BroadcastCrumb, like `ContactCrumb`; «New broadcast» on `/new`, «Broadcast» while loading).
> 11. **Statuses** read «Draft» (`secondary`), «Sending» (`default` with a pulsing dot), «Sent» (`outline`), «Stopped» (`outline`, muted) …
>
> — `screens.md §Decisions taken at this stage, 1, 2, 11, abridged` · full text: [screens.md](../screens.md)

> | loading | `listBroadcasts` in flight; 6 `Skeleton` rows in the table |
> | default | columns **Name** (link to SCR-25 or SCR-28), **Status** (Decision 11), **Audience** («38 contacts»; a draft's tag audience over 10 000 shows «10 420 contacts» with a warning icon and the `title` «Over the 10 000 limit — cannot be launched»), **Last change** («Test User · 3 min ago», «launched by» / «stopped by» wording from the status; full date-time in `title`), and a row-actions `DropdownMenu` («⋯»): **Duplicate**, and **Delete** on a draft row when the member is its author or a business owner. Most recently changed first |
> | empty | «No broadcasts yet. A broadcast sends one message from your business bot to a group of your contacts, chosen by tags or picked by hand.» + **New broadcast**, for every member |
> | error | destructive `Alert` «Couldn't load broadcasts» + **Retry** in place of the table |
> | live | a `broadcast.changed` frame — the list re-reads; a status changes in place, a new or deleted draft appears or goes, a row moves to the top when changed |
> | duplicate a draft | `duplicateBroadcast { audience: same }`; the row's menu shows a spinner, then the copy's editor opens (SCR-25) · a launched row → SCR-30 · **Delete** → SCR-31 · a failed duplicate → `Alert` «Couldn't duplicate the broadcast» |
> | phone (< md) | rows stack: name + status on the first line, audience and last change muted below, the «⋯» menu on the right; **New broadcast** goes full width under the title |
>
> — `screens.md §SCR-24, states, abridged` · full text: [screens.md](../screens.md)

> | default | inherited verbatim; **Broadcasts** (lucide `Megaphone`) joins the primary nav between Contacts and Settings for both roles (Decision 2) |
> | breadcrumb: broadcast | the last crumb is the broadcast's name from the open draft or page, «New broadcast» on `/new`, «Broadcast» while loading or not found (Decision 2) |
>
> — `screens.md §SCR-15, states, abridged` · full text: [screens.md](../screens.md)

> | `401 UNAUTHENTICATED` on any broadcasts route | an open dialog … closes; an unsent edit in the editor is kept in the draft store for the same address; … → SCR-09, then back to the same address |
> | `403 ACCESS_REMOVED` on the same routes …, or the socket closes `4403` | an open dialog closes; … → SCR-07; nothing is launched or stopped |
> | guard `404 NOT_FOUND`, or `BroadcastNotFound` | the frame shows `NotFoundCard` (inherited); no hint the workspace or the broadcast exists |
>
> — `screens.md §Screens, Shared states, abridged` · full text: [screens.md](../screens.md)

> **Copy:** … Broadcast names, the broadcast text, tag names, contact names and member names render as plain text everywhere (spec §6.1); the text keeps its line breaks (`whitespace-pre-wrap`) and nothing in it becomes a link or formatting. Times use the existing helpers (`relativeTime` from `features/inbox/relative-time.ts`; `formatBotDay`, `formatBotTime` from `features/bot/settings/format.ts`). Counts use `Intl.NumberFormat` («10 000» in the user's locale).
>
> — `screens.md §Source, Copy, verbatim` · full text: [screens.md](../screens.md)

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

- `GET /api/workspaces/{workspaceId}/broadcasts` (`listBroadcasts`) → `200 BroadcastList { workspace_id, items: BroadcastListItem[] }`; each item `id, name, status (draft | sending | sent | stopped), audience_kind, audience_size, author, last_changed_by, last_changed_at, launched_at, ended_at`, `last_changed_at` desc then `id` desc, not paged. Errors: `401`, `403 ACCESS_REMOVED`, `404` (guard).
- Row actions call `duplicateBroadcast { audience: same }` (→ `201`, open the copy) for a draft; the dialogs (SCR-30, SCR-31) are T36 / T31.

— `contracts/openapi.yaml, operationIds listBroadcasts, duplicateBroadcast, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers", whose bot is connected and working, where "VIP" is on 40 contacts, "Kyiv" on 120 and "Staff" on 3 (two of them also "VIP"), and 2 of the "VIP" contacts have blocked the bot
> **When** they open Broadcasts, create a broadcast named "Spring prices", type its text, choose a tag audience "any of" "VIP" with "Staff" left out, and leave the page
> **Then** a draft "Spring prices" is saved with its text and audience and is listed on Broadcasts for every member of "Acme Flowers" with its status "draft", its audience and who last changed it; while editing, the draft shows that its audience matches 38 contacts, of whom 2 cannot be reached because they blocked the bot and 0 because they never wrote to the current bot, so it would reach 36 (the same breakdown the launch confirmation shows); the count follows the same rules as the Contacts tag filter ("any of", "all of", "no tags"; no tag chosen means every contact), and a contact carrying any left-out tag is never counted; a tag renamed since still works under its new name, and a tag deleted or merged away is dropped from the audience with a notice saying so; reopening the draft later shows the same text and audience with the count as it is now; nothing is sent to any customer
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, open, create, edit, duplicate, delete or launch a broadcast of "Acme Flowers", see its delivery report, or add a contact of "Acme Flowers" to a group of another workspace (or a contact of another workspace to a group of "Acme Flowers")
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the broadcast or the contact exists; a deactivated member gets the access-removed notice and a member deactivated while on the confirmation launches nothing; someone not signed in is asked to sign in first; a broadcast's audience, recipients and report only ever hold contacts of its own workspace, and the bot of one workspace never sends another workspace's broadcast
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Routes `/w/:workspaceId/broadcasts`, `/broadcasts/new`, `/broadcasts/:broadcastId`, `/broadcasts/:broadcastId/launch` with crumb handles; the detail page picks SCR-25 or SCR-28 from `getBroadcast`'s status (editor and page mounted by T31 / T35) — `apps/web/src/app/routes.tsx`, `apps/web/src/pages/BroadcastDetailPage.tsx`, `apps/web/src/app/routes.test.tsx`
- [ ] Broadcasts nav item (lucide `Megaphone`) between Contacts and Settings for both roles — `apps/web/src/shared/ui/app-shell.tsx`
- [ ] `BroadcastCrumb` from the draft / report store, like `ContactCrumb` — `apps/web/src/features/broadcasts/BroadcastCrumb.tsx`
- [ ] `BroadcastsTable` composing `Card`, `Table`, `Badge`, `DropdownMenu`, `Button`, `Tooltip`, `Skeleton`, `Alert`: status badges (Decision 11), audience with the over-limit warning, last-change wording by status with `relativeTime`, role-aware row actions, phone stacking — `apps/web/src/features/broadcasts/BroadcastsTable.tsx`
- [ ] `BroadcastsPage` with title, **New broadcast** → `/broadcasts/new`, the table on the list store (T29) — `apps/web/src/pages/BroadcastsPage.tsx`
- [ ] Testing Library tests per SCR-24 state (loading, default, empty, error + Retry, live, duplicate draft / launched, delete opener, action failed, phone) and the nav item for both roles — `apps/web/src/features/broadcasts/BroadcastsTable.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| an operator's row of a teammate's draft | «⋯» offers Duplicate only, no Delete |
| a draft tag audience over 10 000 | «10 420 contacts» with the warning icon and its `title` |
| a stopped broadcast | «Stopped» muted, last change «stopped by …» |
| a broadcast id of another workspace in the address | `NotFoundCard`, no hint (§Shared states) |
| names with markup | rendered as plain text |

## Definition of Done

- [ ] Testing Library tests cover every SCR-24 state in screens.md (loading, empty, rows by last change with status badges and audience sizes, sending live, row actions by role, error, phone rows), the Broadcasts item in the frame for both roles, the routes /broadcasts, /broadcasts/new, /broadcasts/:id and /broadcasts/:id/launch, and the breadcrumb labels.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
