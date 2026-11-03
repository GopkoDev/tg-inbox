---
id: T28
title: "Write the missing API end-to-end posts suites (reopened T16): flows, tenancy and secrecy, limits, outage / restart, deactivation, timing \u2014 integrity queries zero after them"
layer: "tests"
deps: ["T25", "T26", "T27"]
blocks: []
acs: ["AC-01", "AC-04", "AC-07", "AC-08", "AC-09", "AC-11", "AC-12", "AC-16", "AC-17"]
files_hint: ["apps/api/src/e2e/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T28 — Write the missing API end-to-end posts suites (reopened T16): flows, tenancy and secrecy, limits, outage / restart, deactivation, timing — integrity queries zero after them

## Place in the sequence

- Follow-up task from the review of 2026-11-04 (`_review/review-2026-11-04.md`, gate CHANGES REQUESTED). **Blocked by:** T25, T26, T27.
- **Lane:** own lane.

## Why (user story)

Fixes review findings F13 so the ACs below are genuinely met. User stories: see each AC's US tag in [spec.md](../spec.md) §4.

## Inlined context

The review findings this task resolves (verbatim rows):


| F13 | 1 | T16 marked done but the API e2e stories, tenancy / secrecy suite, limits and timing checks do not exist (commit `cff4fac` says so) | AC-04, AC-08, AC-11, AC-12, AC-16, AC-17 | Fix → T28 (T16 reopened as T28) |

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

### AC-04 — authorization

> **Given** members of "Acme Flowers" and of "Bolt Bikes"
> **When** a member of "Bolt Bikes" opens, edits or publishes a post or a destination of "Acme Flowers" by its address
> **Then** the system refuses as if it did not exist and reveals nothing about it; each workspace sees and posts only to its own destinations, through its own bot
>
> — `spec.md §5, AC-04, verbatim`

### AC-07 — happy path

> **Given** a business owner with a draft for "Acme Flowers News" and a working bot
> **When** the owner opens Publish, sees the destination's Telegram name and kind and the exact text, and confirms
> **Then** the post appears in the channel from the bot within seconds (if the bot is paused by Telegram it waits, at most 15 minutes, then is marked missed), once, and is marked published with the time, the owner who published it and a way to open it in Telegram; its text and destination never change afterwards, and it can be duplicated into a new draft
>
> — `spec.md §5, AC-07, verbatim`

### AC-08 — domain invariant

> **Given** a draft that a business owner is publishing or scheduling
> **When** the owner double-clicks, two owners confirm at the same time, the draft was changed after the confirmation opened, or the service restarts while the post is being sent
> **Then** the post goes out at most once; a confirmation for a changed draft publishes nothing and shows the current version to confirm again; a send that got no answer from Telegram is marked "not confirmed — Telegram did not answer, not sent again" and is never repeated automatically
>
> — `spec.md §5, AC-08, verbatim`

### AC-09 — happy path

> **Given** a business owner of a workspace whose time zone is Europe/Kyiv, with a draft
> **When** the owner schedules it for tomorrow 09:00 and confirms the destination and text
> **Then** the post is marked scheduled for "09:00 (Europe/Kyiv)", shown in that zone to every member, appears in the chat within 1 minute after that time with no one online (posts due together in one chat follow each other a few seconds apart), and until then any member can move it back to a draft and an owner can change its time, which confirms it again
>
> — `spec.md §5, AC-09, verbatim`

### AC-11 — domain invariant

> **Given** a scheduled post
> **When** any member changes its text, destination or sound option, or its scheduling owner is deactivated before its time
> **Then** the post first goes back to a draft (after a confirmation for the member, with a notice when it was the deactivation), so it only goes out after a business owner schedules or publishes it again; what goes out is always exactly what an owner confirmed
>
> — `spec.md §5, AC-11, verbatim`

### AC-12 — cross-context

> **Given** a post scheduled for 09:00
> **When** it cannot go out by 09:15 because the service was down, the bot was paused by Telegram or Telegram limited posting to that chat
> **Then** it is marked missed with the reason, is never published later, and counts as needing attention; after an outage, posts still inside their window go out in scheduled-time order, paced, and the rest are missed
>
> — `spec.md §5, AC-12, verbatim`

### AC-16 — domain invariant

> **Given** a workspace that sent 30 posts to Telegram in the last 24 hours, or holds 100 scheduled posts waiting
> **When** a business owner publishes another post now, or schedules one more while 100 are waiting
> **Then** the system refuses and says the daily posting limit (and when posting is possible again) or the scheduled-post limit was reached; a scheduled post whose time comes while the daily limit is reached fails with that reason
>
> — `spec.md §5, AC-16, verbatim`

### AC-17 — cross-context

> **Given** a destination group where customers chat busily and a broadcast and replies are being sent
> **When** posts go out and people write in the group
> **Then** nothing written in a destination is captured — no contact, conversation, unread or ping is created; customer messages to the bot and replies keep their usual speed; a limit Telegram applies to one chat delays only posts to that chat, while posts still wait for the bot's send pause
>
> — `spec.md §5, AC-17, verbatim`

## Checklist

- [ ] posts-flows.int.test.ts: connect channel by code → draft → schedule → published → delete; publish now; concurrent publish / two owners; restart mid-send (fake Telegram hang) → not confirmed; outage > 15 min → missed; deactivation through Team returns scheduled posts
- [ ] posts-tenancy.int.test.ts: cross-workspace save / publish / schedule / remove / code by address → 404; no post text / title / username / code / chat id in captured logs, live frames or job payloads
- [ ] posts-limits: 31st post in 24 h and 101st scheduled refused; a due post over the daily limit fails with that reason
- [ ] posts-load.int.test.ts: group flood 10/s vs private capture p95 within ±1 s; a post 429 leaves send_paused_until untouched end to end; on-time with a fake clock
- [ ] `postIntegrity.*` queries all return 0 rows after the suites

## Edge cases

| Case | Behaviour |
|---|---|
| the cited scenario | the fixed behaviour, asserted by a test that failed before the fix |

## Definition of Done

- [ ] a RED test reproduces each finding before the fix, then passes
- [ ] the gate (tests of the touched modules + `pnpm lint`) is clean
