---
id: T30
title: "Complete the editor and post page states: save line and save-error Alert with Retry, SCR-40 declared content, destination problem text in publish / schedule, workspace-zone times everywhere, Field / FieldError and kind Badges"
layer: "ui"
deps: ["T29"]
blocks: []
acs: ["AC-05", "AC-06", "AC-07", "AC-09", "AC-10", "AC-12", "AC-13", "AC-14", "AC-15"]
files_hint: ["apps/web/src/features/posts/editor/", "apps/web/src/features/posts/page/", "apps/web/src/features/posts/publish/", "apps/web/src/features/posts/time.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T30 — Complete the editor and post page states: save line and save-error Alert with Retry, SCR-40 declared content, destination problem text in publish / schedule, workspace-zone times everywhere, Field / FieldError and kind Badges

## Place in the sequence

- Follow-up task from the review of 2026-11-04 (`_review/review-2026-11-04.md`, gate CHANGES REQUESTED). **Blocked by:** T29.
- **Lane:** own lane.

## Why (user story)

Fixes review findings F18, F19, F20, F21, F22 so the ACs below are genuinely met. User stories: see each AC's US tag in [spec.md](../spec.md) §4.

## Inlined context

The review findings this task resolves (verbatim rows):


| F18 | 2 | Over-limit draft keeps "Saved"; save failure has no Alert + Retry — `PostEditor.tsx:156,286-293` | AC-05, AC-06 | Fix → T30 |
| F19 | 1/2 | SCR-40 misses declared content (missed destructive + "could not go out by", failed → SCR-33 link, "scheduled by", kind / @username / sound line, sending spinner, past-48 h line) — `PostPage.tsx:194-271` | AC-07, AC-12, AC-13, AC-15 | Fix → T30 |
| F20 | 1 | Publish / schedule refusals ignore `destination.problem` — `publish/shared.tsx:13`, `PublishDialog.tsx:160`, `ScheduleDialog.tsx:260` | AC-10, AC-14 | Fix → T30 |
| F21 | 2 | Times shown in the browser zone or without the zone name (post page before the zone loads, daily-limit time, code expiry) — `PostPage.tsx:70`, `PublishDialog.tsx:37-38,167`, `ConnectCodeDialog.tsx:35-36` | AC-09 | Fix → T30 |
| F22 | 2 | Canon primitives not reused (bare `<p>` instead of Field/FieldError, hand-rolled tablist, kind as text) — `PostEditor.tsx:308-365`, `PostsTable.tsx:95-97,189-205` | AC-06 | Fix → T30 / T31 |

— `_review/review-2026-11-04.md §Findings, verbatim` · full text: [review](../_review/review-2026-11-04.md)

**Fallback:** read the cited code and [sad.md](../sad.md) / [openapi.yaml](../contracts/openapi.yaml) / [screens.md](../screens.md) / [adr/](../adr/). Do not guess.

## Data delta

No DB changes (unless a finding requires a new enum value — then note it).

## API contract

As in [openapi.yaml](../contracts/openapi.yaml); keep responses in line with it.

## Acceptance criteria

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

### AC-07 — happy path

> **Given** a business owner with a draft for "Acme Flowers News" and a working bot
> **When** the owner opens Publish, sees the destination's Telegram name and kind and the exact text, and confirms
> **Then** the post appears in the channel from the bot within seconds (if the bot is paused by Telegram it waits, at most 15 minutes, then is marked missed), once, and is marked published with the time, the owner who published it and a way to open it in Telegram; its text and destination never change afterwards, and it can be duplicated into a new draft
>
> — `spec.md §5, AC-07, verbatim`

### AC-09 — happy path

> **Given** a business owner of a workspace whose time zone is Europe/Kyiv, with a draft
> **When** the owner schedules it for tomorrow 09:00 and confirms the destination and text
> **Then** the post is marked scheduled for "09:00 (Europe/Kyiv)", shown in that zone to every member, appears in the chat within 1 minute after that time with no one online (posts due together in one chat follow each other a few seconds apart), and until then any member can move it back to a draft and an owner can change its time, which confirms it again
>
> — `spec.md §5, AC-09, verbatim`

### AC-10 — error

> **Given** a business owner scheduling a post or changing a scheduled post's time
> **When** at the moment they confirm, the chosen time is less than 2 minutes ahead, more than 90 days ahead, the destination is unavailable, or a local time the daylight-saving change skips in the workspace's time zone
> **Then** the post is not scheduled and the owner is told the allowed range, that this time does not exist on that day, or what right the bot is missing in that chat
>
> — `spec.md §5, AC-10, verbatim`

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

### AC-14 — cross-context

> **Given** a workspace with destinations and scheduled posts
> **When** its bot stops working or is disconnected, or a different Telegram bot is connected
> **Then** while the bot is not working, publishing and scheduling are refused with a way to the bot settings and posts whose time comes fail with "the bot was not working"; with a different working bot, only the old bot's destinations are unavailable until connected again with a code, and posts due to them fail with "this chat is not connected to the current bot"; while reconnecting the same bot keeps them; a group that Telegram upgraded keeps working as the same destination
>
> — `spec.md §5, AC-14, verbatim`

### AC-15 — happy path

> **Given** a post the bot published to "Acme Flowers News" less than 48 hours ago
> **When** a business owner deletes it from Telegram and confirms
> **Then** the message disappears from the channel, the post is marked deleted with the owner and time, and its text stays readable in the panel; after 48 hours, or if Telegram refuses, the panel says it can no longer be deleted by the bot
>
> — `spec.md §5, AC-15, verbatim`

## Checklist

- [ ] editor: «Not saved — too long» for over-limit; destructive Alert + Retry (flush) on save error; Field/FieldError with aria-invalid; kind Badge in destination options
- [ ] SCR-40: missed destructive + «It could not go out by <time>»; failed → link to Channels & groups when the destination is the cause; «scheduled by <name>»; kind Badge, @username, sound line; sending spinner; past 48 h «The bot can no longer delete this post»
- [ ] publish / schedule: map `destination.problem` and `DESTINATION_UNAVAILABLE.details.problem` to the SCR-33 plain texts
- [ ] times: never render before the workspace zone is known; re-read zone on `destinations.changed`; daily-limit time and code expiry via `formatPostTime` with the zone
- [ ] component tests per added state

## Edge cases

| Case | Behaviour |
|---|---|
| the cited scenario | the fixed behaviour, asserted by a test that failed before the fix |

## Definition of Done

- [ ] a RED test reproduces each finding before the fix, then passes
- [ ] the gate (tests of the touched modules + `pnpm lint`) is clean
