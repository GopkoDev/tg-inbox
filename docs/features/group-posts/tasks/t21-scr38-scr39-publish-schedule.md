---
id: T21
title: "Build SCR-38 publish-now and SCR-39 schedule dialogs on their owner-only addresses, with the first-time time-zone step"
layer: "ui"
deps: ["T20"]
blocks: ["T23", "T24"]
acs: ["AC-03", "AC-07", "AC-08", "AC-09", "AC-10", "AC-14", "AC-16"]
files_hint: ["apps/web/src/features/posts/publish/", "apps/web/src/pages/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T21 — Build SCR-38 publish-now and SCR-39 schedule dialogs on their owner-only addresses, with the first-time time-zone step

## Place in the sequence

- **Blocked by:** T20 — Build SCR-37 the post editor with autosave, destination pick · **Blocks:** T23 — Add browser end-to-end posts flows against the real API: con, T24 — Update CLAUDE.md, the architecture map and the design-system · **Wave:** 4 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to check the destination and the exact text one last time and publish the post right away
> **So that** the announcement appears in the business's channel or group from its bot, once
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to choose when a post goes out, in the business's time zone, and change or cancel that until it goes out
> **So that** posts appear at the right moment without anyone being online then
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

This task delivers: build SCR-38 publish-now and SCR-39 schedule dialogs on their owner-only addresses, with the first-time time-zone step.

## Inlined context

> SCR-38 states: loading · default · blocked · pending · changed · refused (destination / bot + Open bot settings / daily limit with time) · done · owner-only redirect
>
> — `screens.md SCR-38, abridged` · full text: [screens.md](../screens.md)

> SCR-39 states: time zone first · default (native date + time inputs, zone named) · change time · validation · zone changed · refused · pending · done
>
> — `screens.md SCR-39, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

getPublishConfirmation, publishPost, schedulePost, setPostingTimeZone.

— `contracts/openapi.yaml, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-03 — authorization

> **Given** an operator of "Acme Flowers"
> **When** they look at destinations, a draft or a published post
> **Then** they see the destinations and the post but are offered no way to connect or remove a destination, publish, schedule or delete a published post, and an attempt made anyway is refused and says only a business owner can do it; a saved link to an owner-only step opens the post instead
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-07 — happy path

> **Given** a business owner with a draft for "Acme Flowers News" and a working bot
> **When** the owner opens Publish, sees the destination's Telegram name and kind and the exact text, and confirms
> **Then** the post appears in the channel from the bot within seconds (if the bot is paused by Telegram it waits, at most 15 minutes, then is marked missed), once, and is marked published with the time, the owner who published it and a way to open it in Telegram; its text and destination never change afterwards, and it can be duplicated into a new draft
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — domain invariant

> **Given** a draft that a business owner is publishing or scheduling
> **When** the owner double-clicks, two owners confirm at the same time, the draft was changed after the confirmation opened, or the service restarts while the post is being sent
> **Then** the post goes out at most once; a confirmation for a changed draft publishes nothing and shows the current version to confirm again; a send that got no answer from Telegram is marked "not confirmed — Telegram did not answer, not sent again" and is never repeated automatically
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — happy path

> **Given** a business owner of a workspace whose time zone is Europe/Kyiv, with a draft
> **When** the owner schedules it for tomorrow 09:00 and confirms the destination and text
> **Then** the post is marked scheduled for "09:00 (Europe/Kyiv)", shown in that zone to every member, appears in the chat within 1 minute after that time with no one online (posts due together in one chat follow each other a few seconds apart), and until then any member can move it back to a draft and an owner can change its time, which confirms it again
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — error

> **Given** a business owner scheduling a post or changing a scheduled post's time
> **When** at the moment they confirm, the chosen time is less than 2 minutes ahead, more than 90 days ahead, the destination is unavailable, or a local time the daylight-saving change skips in the workspace's time zone
> **Then** the post is not scheduled and the owner is told the allowed range, that this time does not exist on that day, or what right the bot is missing in that chat
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — cross-context

> **Given** a workspace with destinations and scheduled posts
> **When** its bot stops working or is disconnected, or a different Telegram bot is connected
> **Then** while the bot is not working, publishing and scheduling are refused with a way to the bot settings and posts whose time comes fail with "the bot was not working"; with a different working bot, only the old bot's destinations are unavailable until connected again with a code, and posts due to them fail with "this chat is not connected to the current bot"; while reconnecting the same bot keeps them; a group that Telegram upgraded keeps working as the same destination
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — domain invariant

> **Given** a workspace that sent 30 posts to Telegram in the last 24 hours, or holds 100 scheduled posts waiting
> **When** a business owner publishes another post now, or schedules one more while 100 are waiting
> **Then** the system refuses and says the daily posting limit (and when posting is possible again) or the scheduled-post limit was reached; a scheduled post whose time comes while the daily limit is reached fails with that reason
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] PublishDialog, ScheduleDialog
- [ ] operator on /publish or /schedule → replace to the post
- [ ] tests per state

## Edge cases

| Case | Behaviour |
|---|---|
| operator opens /publish | redirect to post with note |
| skipped hour | inline error |

## Definition of Done

- [ ] component tests per state pass
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
