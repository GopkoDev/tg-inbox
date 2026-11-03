---
id: T29
title: "Fix the post address: one page instance across new / :id / publish / schedule with the post in a store, live switch editor \u2194 post page, NotFoundCard on 404, owner-only Change time wired to ScheduleDialog"
layer: "ui"
deps: ["T27"]
blocks: []
acs: ["AC-03", "AC-04", "AC-05", "AC-06", "AC-08", "AC-09", "AC-11"]
files_hint: ["apps/web/src/pages/PostDetailPage.tsx", "apps/web/src/app/routes.tsx", "apps/web/src/features/posts/post-store.ts", "apps/web/src/features/posts/page/PostPage.tsx", "apps/web/src/features/posts/editor/PostEditor.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T29 — Fix the post address: one page instance across new / :id / publish / schedule with the post in a store, live switch editor ↔ post page, NotFoundCard on 404, owner-only Change time wired to ScheduleDialog

## Place in the sequence

- Follow-up task from the review of 2026-11-04 (`_review/review-2026-11-04.md`, gate CHANGES REQUESTED). **Blocked by:** T27.
- **Lane:** own lane.

## Why (user story)

Fixes review findings F14, F15, F16, F17 so the ACs below are genuinely met. User stories: see each AC's US tag in [spec.md](../spec.md) §4.

## Inlined context

The review findings this task resolves (verbatim rows):


| F14 | 1/2 | "Change time" never wired (`PostDetailPage` passes no `onChangeTime`, ScheduleDialog only in the draft branch, `not_a_draft` blocker fatal) and offered to operators — `pages/PostDetailPage.tsx:41,57`, `features/posts/page/PostPage.tsx:241-249`, `api posts/app/publish.ts:161` | AC-09, AC-03 | Fix → T29 |
| F15 | 1/2 | Post address never switches editor ↔ post page after the first read (back to draft, `POST_NOT_A_DRAFT`, live change) — `PostDetailPage.tsx:22-31` | AC-08, AC-11 | Fix → T29 |
| F16 | 2 | Editor remounts across `/new` → `/:id` → `/:id/publish|schedule` (separate lazy components, local state): lost focus, false stale-save, toggle dropped on unmount — `app/routes.tsx:111-129`, `PostEditor.tsx:74-113` | AC-05, AC-06 | Fix → T29 |
| F17 | 2 | Unknown / foreign post address shows a retryable error instead of NotFoundCard — `PostDetailPage.tsx:27`, `PostPage.tsx:165-169` | AC-04 | Fix → T29 |

— `_review/review-2026-11-04.md §Findings, verbatim` · full text: [review](../_review/review-2026-11-04.md)

**Fallback:** read the cited code and [sad.md](../sad.md) / [openapi.yaml](../contracts/openapi.yaml) / [screens.md](../screens.md) / [adr/](../adr/). Do not guess.

## Data delta

No DB changes (unless a finding requires a new enum value — then note it).

## API contract

As in [openapi.yaml](../contracts/openapi.yaml); keep responses in line with it.

## Acceptance criteria

### AC-03 — authorization

> **Given** an operator of "Acme Flowers"
> **When** they look at destinations, a draft or a published post
> **Then** they see the destinations and the post but are offered no way to connect or remove a destination, publish, schedule or delete a published post, and an attempt made anyway is refused and says only a business owner can do it; a saved link to an owner-only step opens the post instead
>
> — `spec.md §5, AC-03, verbatim`

### AC-04 — authorization

> **Given** members of "Acme Flowers" and of "Bolt Bikes"
> **When** a member of "Bolt Bikes" opens, edits or publishes a post or a destination of "Acme Flowers" by its address
> **Then** the system refuses as if it did not exist and reveals nothing about it; each workspace sees and posts only to its own destinations, through its own bot
>
> — `spec.md §5, AC-04, verbatim`

### AC-05 — happy path

> **Given** an operator of "Acme Flowers" with the destination "Acme Flowers News"
> **When** they create a post, pick that destination, type the text and tick "send without sound"
> **Then** the draft is saved as they type, shows how the text will look in the chat and how many characters remain, and appears on the Posts page for every member with its destination and who last changed it
>
> — `spec.md §5, AC-05, verbatim`

### AC-06 — error

> **Given** an operator editing a draft
> **When** the text is empty after trimming spaces and line breaks, is longer than Telegram allows for one message, or no destination is picked, or a teammate saved a newer version of the draft meanwhile
> **Then** the draft cannot be published or scheduled, the editor says plainly what is missing or too long, and a stale save is refused with the teammate's current version shown, never overwriting it
>
> — `spec.md §5, AC-06, verbatim`

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

## Checklist

- [ ] one lazy page for `/posts/new`, `/posts/:postId`, `/:postId/publish`, `/:postId/schedule` (or `:postId/*`); hold the post in a zustand store (as broadcasts' draft store); flush pending saves on unmount
- [ ] derive editor vs post page from the stored post state; re-read on `post.changed` for this id, after back-to-draft and after `POST_NOT_A_DRAFT`
- [ ] 404 → NotFoundCard (as BroadcastDetailPage)
- [ ] Change time: owners only (operators get the owners-only note); opens ScheduleDialog over PostPage prefilled with `instantToLocal(scheduled_for, zone)` in change-time mode; `/schedule` on a scheduled post opens it
- [ ] component tests for each transition and the 404

## Edge cases

| Case | Behaviour |
|---|---|
| the cited scenario | the fixed behaviour, asserted by a test that failed before the fix |

## Definition of Done

- [ ] a RED test reproduces each finding before the fix, then passes
- [ ] the gate (tests of the touched modules + `pnpm lint`) is clean
