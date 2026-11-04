---
id: T31
title: "Fix the list and settings: attention marker from needs_attention, connect dialog re-reads on destinations.changed, TimeZoneField as a Select reused by ScheduleDialog, Tabs / Badges in the list, PostCrumb built and registered"
layer: "ui"
deps: ["T29"]
blocks: []
acs: ["AC-01", "AC-09", "AC-12", "AC-13"]
files_hint: ["apps/web/src/features/posts/list/", "apps/web/src/features/posts/settings/", "apps/web/src/features/posts/publish/ScheduleDialog.tsx", "apps/web/src/features/posts/PostCrumb.tsx", "docs/design-system.md"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: "COMMIT"
---

# T31 — Fix the list and settings: attention marker from needs_attention, connect dialog re-reads on destinations.changed, TimeZoneField as a Select reused by ScheduleDialog, Tabs / Badges in the list, PostCrumb built and registered

## Place in the sequence

- Follow-up task from the review of 2026-11-04 (`_review/review-2026-11-04.md`, gate CHANGES REQUESTED). **Blocked by:** T29.
- **Lane:** own lane.

## Why (user story)

Fixes review findings F22, F23, F24, F25, F26 so the ACs below are genuinely met. User stories: see each AC's US tag in [spec.md](../spec.md) §4.

## Inlined context

The review findings this task resolves (verbatim rows):


| F22 | 2 | Canon primitives not reused (bare `<p>` instead of Field/FieldError, hand-rolled tablist, kind as text) — `PostEditor.tsx:308-365`, `PostsTable.tsx:95-97,189-205` | AC-06 | Fix → T30 / T31 |
| F23 | 2 | List attention marker driven by state, not `needs_attention` — `list/PostsTable.tsx:72,105-119` | AC-12, AC-13 | Fix → T31 |
| F24 | 2 | Connect dialog polls every 3 s instead of re-reading on `destinations.changed` — `settings/ConnectCodeDialog.tsx:21,130-138` | AC-01 | Fix → T31 |
| F25 | 2 | TimeZoneField is a free-text Input, not the declared Select; ScheduleDialog builds its own — `settings/TimeZoneField.tsx:84-89`, `ScheduleDialog.tsx:184-190` | AC-09 | Fix → T31 |
| F26 | 2 | PostCrumb declared, not built or registered — `routes.tsx:117-129`, `docs/design-system.md` | n/a | Fix → T31 |

— `_review/review-2026-11-04.md §Findings, verbatim` · full text: [review](../_review/review-2026-11-04.md)

**Fallback:** read the cited code and [sad.md](../sad.md) / [openapi.yaml](../contracts/openapi.yaml) / [screens.md](../screens.md) / [adr/](../adr/). Do not guess.

## Data delta

No DB changes (unless a finding requires a new enum value — then note it).

## API contract

As in [openapi.yaml](../contracts/openapi.yaml); keep responses in line with it.

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers" whose connected bot was added as an admin with the right to post to the channel "Acme Flowers News"
> **When** the owner creates a connect code in Settings and posts it in that channel within 10 minutes
> **Then** "Acme Flowers News" appears among the workspace's destinations, live, as a channel with its Telegram name, the code stops working, and the bot removes the code message from the channel when it is allowed to
>
> — `spec.md §5, AC-01, verbatim`

### AC-09 — happy path

> **Given** a business owner of a workspace whose time zone is Europe/Kyiv, with a draft
> **When** the owner schedules it for tomorrow 09:00 and confirms the destination and text
> **Then** the post is marked scheduled for "09:00 (Europe/Kyiv)", shown in that zone to every member, appears in the chat within 1 minute after that time with no one online (posts due together in one chat follow each other a few seconds apart), and until then any member can move it back to a draft and an owner can change its time, which confirms it again
>
> — `spec.md §5, AC-09, verbatim`

### AC-12 — cross-context

> **Given** a post scheduled for 09:00
> **When** it cannot go out by 09:15 because the service was down, the bot was paused by Telegram or Telegram limited posting to that chat
> **Then** it is marked missed with the reason, is never published later, and counts as needing attention; after an outage, posts still inside their window go out in scheduled-time order, paced, and the rest are missed
>
> — `spec.md §5, AC-12, verbatim`

### AC-13 — error

> **Given** a published-now or scheduled post
> **When** Telegram refuses it — the bot lost the right to post or was removed from the chat, the chat no longer exists, or the text was refused
> **Then** the post is marked failed with that reason in plain language, is not tried again, is counted next to Posts in the navigation for the whole team until any member opens it, and the destination is marked unavailable with what is wrong when the bot can no longer post there
>
> — `spec.md §5, AC-13, verbatim`

## Checklist

- [ ] PostsTable: marker from `needs_attention` (destructive badge stays for failed / missed); Tabs + DataTableToolbar; kind Badge
- [ ] ConnectCodeDialog: subscribeLive → re-read on `destinations.changed` / resync; keep only the expiry timer
- [ ] TimeZoneField: Select over `Intl.supportedValuesOf('timeZone')`, browser zone prefilled; ScheduleDialog's zone step reuses it
- [ ] PostCrumb («Post» / text start) like BroadcastCrumb; register it and any changed component rows in docs/design-system.md
- [ ] component tests incl. not_confirmed + needs_attention row

## Edge cases

| Case | Behaviour |
|---|---|
| the cited scenario | the fixed behaviour, asserted by a test that failed before the fix |

## Definition of Done

- [ ] a RED test reproduces each finding before the fix, then passes
- [ ] the gate (tests of the touched modules + `pnpm lint`) is clean
