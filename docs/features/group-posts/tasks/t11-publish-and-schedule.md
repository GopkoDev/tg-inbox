---
id: T11
title: "Add the publish confirmation, publish now and schedule / change time against the shown version, queuing one posts.send job in the transaction"
layer: "app"
deps: ["T9", "T10"]
blocks: ["T12", "T15"]
acs: ["AC-03", "AC-07", "AC-08", "AC-09", "AC-10", "AC-14", "AC-16"]
files_hint: ["apps/api/src/modules/posts/app/publish.ts", "apps/api/src/modules/posts/app/schedule.ts", "apps/api/src/modules/posts/app/publish-confirmation.ts"]
owner: "Dmytro Hopko"
estimate: "L"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T11 — Add the publish confirmation, publish now and schedule / change time against the shown version, queuing one posts.send job in the transaction

## Place in the sequence

- **Blocked by:** T9 — Add the destination use cases: create and read a connect cod, T10 — Add the post draft use cases and reads: create, save against · **Blocks:** T12 — Add the posts.send job body: re-check owner and limits, per-, T15 — Register the posts routes (registerPosts): the 18 operations · **Wave:** 5 (after its deps).
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

This task delivers: add the publish confirmation, publish now and schedule / change time against the shown version, queuing one posts.send job in the transaction.

## Inlined context

> Flow 4: share-lock memberships, check the caller is an active business owner; take the workspace posting lock, lock the post row; alt operator → refused … version changed → refused … bot not working, or destination unavailable or of the replaced bot → refused … 30 posts sent in the last 24 hours → refused … already scheduled or sent → the post as it is now, nothing new queued … ready → state scheduled for now … queue a send job … in the same transaction
>
> — `sad.md §6 Flow 4, abridged` · full text: [sad.md](../sad.md)

> Flow 5: no time zone → refused …; skipped local time, under 2 minutes, over 90 days → refused …; 100 scheduled waiting, destination unavailable, bot not working, version changed → refused …; ready → state scheduled, moment as an instant, scheduled by the caller; queue a send job at that moment
>
> — `sad.md §6 Flow 5, abridged` · full text: [sad.md](../sad.md)

> `posts.send`, policy `standard` with no singleton key, payload `{postId, moment}`, `startAfter` = the scheduled moment (or now), queued in the same transaction as the schedule
>
> — `adr/0004, Option 1, abridged` · full text: [adr/0004](../adr/)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

`posts` — `state`, `scheduled_for`, `scheduled_by_account_id`, `schedule_kind`, `last_changed_*`; counts over `posts_sent_idx` / `posts_scheduled_idx`.

— `data-model.md §Entities, abridged` · full text: [data-model.md](../data-model.md)

## API contract

`getPublishConfirmation` (blockers, headroom), `publishPost` (`queued` / `already_scheduled`; 403 OWNER_ONLY; 409 POST_DRAFT_CHANGED / DESTINATION_UNAVAILABLE / POSTS_NEED_WORKING_BOT / POST_DAILY_LIMIT_REACHED), `schedulePost` (400 POST_SCHEDULE_OUT_OF_RANGE / POST_TIME_DOES_NOT_EXIST; 409 TIME_ZONE_REQUIRED / TIME_ZONE_CHANGED / POST_SCHEDULED_LIMIT_REACHED) — app layer.

— `contracts/openapi.yaml`, abridged

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

- [ ] confirmation read + blockers
- [ ] publish: lock order + checks in contract order; enqueue via `jobDb(tx)` port
- [ ] schedule + change time (same version) using T1 + T4
- [ ] integration tests: double confirm, two owners, stale version, limits, DST

## Edge cases

| Case | Behaviour |
|---|---|
| double click | one job, second answer `already_scheduled` |
| change time | new job; old job exits on moment mismatch (T12) |
| daily limit at publish | 409 with frees_at |
| zone differs from shown | TIME_ZONE_CHANGED |

## Definition of Done

- [ ] integration tests per branch pass (incl. concurrent publish)
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
