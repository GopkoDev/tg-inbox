---
id: T34
title: "Add the missing API end-to-end suites: outage over 15 minutes and in-window catch-up, schedule \u2192 published on time, delete through the API, a due post failing on the daily limit, and posts-load (capture under group traffic, post 429 vs send pause, on-time)"
layer: "tests"
deps: ["T33"]
blocks: []
acs: ["AC-09", "AC-12", "AC-15", "AC-16", "AC-17"]
files_hint: ["apps/api/src/e2e/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T34 — Add the missing API end-to-end suites: outage over 15 minutes and in-window catch-up, schedule → published on time, delete through the API, a due post failing on the daily limit, and posts-load (capture under group traffic, post 429 vs send pause, on-time)

## Place in the sequence

- Second-round follow-up from the re-review (`_review/review-2026-11-04.md` §Re-review after T25–T32). **Blocked by:** T33. **Lane:** own lane.

## Why (user story)

Closes the re-review items below so the ACs listed are met end to end (user stories: see each AC's US tag in [spec.md](../spec.md) §4).

## Inlined context

> F13 — extend `posts-flows.int.test.ts` (real Postgres + pg-boss + fake Bot API + injectable clock): outage longer than 15 minutes → missed with the reason; posts inside the window after an outage go out in order, ≥ 3 s apart per chat; schedule for a future moment → published at it; delete through the API within 48 h → deleted and the fake Telegram saw deleteMessage; a due post when 30 were sent in 24 h → failed `daily_limit`.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T25–T32, abridged`

> F13 — new `posts-load.int.test.ts`: a destination group sends 10 updates/s for 60 s (or a shorter scaled run) while private messages arrive; private capture p95 within ±1 s of a baseline run; a post answered 429 leaves `bots.send_paused_until` untouched (real DB); first post per chat accepted ≤ 60 s after its time.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T25–T32, abridged`

> `postIntegrity.*` all zero after the suites.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T25–T32, abridged`

**Fallback:** read the cited code, [sad.md](../sad.md), [openapi.yaml](../contracts/openapi.yaml), [screens.md](../screens.md), [test-plan.md](../test-plan.md). Do not guess.

## Data delta

No DB changes (except staging the already-live migration 025 as a design record in T33).

## API contract

As in [openapi.yaml](../contracts/openapi.yaml).

## Acceptance criteria

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

### AC-15 — happy path

> **Given** a post the bot published to "Acme Flowers News" less than 48 hours ago
> **When** a business owner deletes it from Telegram and confirms
> **Then** the message disappears from the channel, the post is marked deleted with the owner and time, and its text stays readable in the panel; after 48 hours, or if Telegram refuses, the panel says it can no longer be deleted by the bot
>
> — `spec.md §5, AC-15, verbatim`

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

- [ ] item 1 of Inlined context
- [ ] item 2 of Inlined context
- [ ] item 3 of Inlined context

## Edge cases

| Case | Behaviour |
|---|---|
| the cited scenario | the fixed behaviour, asserted by a test that failed before the fix |

## Definition of Done

- [ ] a RED test reproduces each item before the fix, then passes
- [ ] gate clean (tests of the touched modules + `pnpm lint`)
