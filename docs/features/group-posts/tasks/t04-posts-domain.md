---
id: T4
title: "Add the posts domain: states and transitions, the schedule window, the 15-minute miss rule, limits, connect-code format and hashing, outcome reasons, Telegram link"
layer: "domain"
deps: ["T1", "T2"]
blocks: ["T8"]
acs: ["AC-08", "AC-10", "AC-11", "AC-12", "AC-16"]
files_hint: ["apps/api/src/modules/posts/domain/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T4 — Add the posts domain: states and transitions, the schedule window, the 15-minute miss rule, limits, connect-code format and hashing, outcome reasons, Telegram link

## Place in the sequence

- **Blocked by:** T1 — Add the shared workspace time-zone rule: IANA validity, loca, T2 — Add the posts zod contracts, the 17 new error codes, and the · **Blocks:** T8 — Build the posts repositories for destinations, destination c · **Wave:** 2 (after its deps).
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

This task delivers: add the posts domain: states and transitions, the schedule window, the 15-minute miss rule, limits, connect-code format and hashing, outcome reasons, Telegram link.

## Inlined context

> 'draft' → 'scheduled' → 'sending' → 'published' (→ 'deleted') | 'failed' | 'missed' | 'not_confirmed'; 'scheduled' and later go back to 'draft' only from 'scheduled' (AC-11). "Publish now" is 'scheduled' for the confirmation moment
>
> — `migrations/04_create_posts.up.sql, header comment, abridged` · full text: [migrations/04_create_posts.up.sql](../migrations/04_create_posts.up.sql)

> The 15-minute window covers every wait. It runs from the scheduled time, or from the confirmation for "publish now", and is measured at the moment the send to Telegram starts.
>
> — `spec.md §1 Clarifications, abridged` · full text: [spec.md](../spec.md)

> Limits are counted on what went out. The 30-per-24-hours limit counts posts sent to Telegram — published, not confirmed and later deleted ones … scheduling itself checks only the 100 waiting
>
> — `spec.md §1 Clarifications, abridged` · full text: [spec.md](../spec.md)

> Code: `tgp_` + random, only its hash stored, 10 minutes, single use; in a group a command addressed to the bot (`/connect@<bot> tgp_…`)
>
> — `adr/0002, Option 1, abridged` · full text: [adr/0002](../adr/)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Reads the state / reason enums of `posts` (data-model.md §Entities posts) — no DB access in domain.

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-08 — domain invariant

> **Given** a draft that a business owner is publishing or scheduling
> **When** the owner double-clicks, two owners confirm at the same time, the draft was changed after the confirmation opened, or the service restarts while the post is being sent
> **Then** the post goes out at most once; a confirmation for a changed draft publishes nothing and shows the current version to confirm again; a send that got no answer from Telegram is marked "not confirmed — Telegram did not answer, not sent again" and is never repeated automatically
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — error

> **Given** a business owner scheduling a post or changing a scheduled post's time
> **When** at the moment they confirm, the chosen time is less than 2 minutes ahead, more than 90 days ahead, the destination is unavailable, or a local time the daylight-saving change skips in the workspace's time zone
> **Then** the post is not scheduled and the owner is told the allowed range, that this time does not exist on that day, or what right the bot is missing in that chat
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — domain invariant

> **Given** a scheduled post
> **When** any member changes its text, destination or sound option, or its scheduling owner is deactivated before its time
> **Then** the post first goes back to a draft (after a confirmation for the member, with a notice when it was the deactivation), so it only goes out after a business owner schedules or publishes it again; what goes out is always exactly what an owner confirmed
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — cross-context

> **Given** a post scheduled for 09:00
> **When** it cannot go out by 09:15 because the service was down, the bot was paused by Telegram or Telegram limited posting to that chat
> **Then** it is marked missed with the reason, is never published later, and counts as needing attention; after an outage, posts still inside their window go out in scheduled-time order, paced, and the rest are missed
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — domain invariant

> **Given** a workspace that sent 30 posts to Telegram in the last 24 hours, or holds 100 scheduled posts waiting
> **When** a business owner publishes another post now, or schedules one more while 100 are waiting
> **Then** the system refuses and says the daily posting limit (and when posting is possible again) or the scheduled-post limit was reached; a scheduled post whose time comes while the daily limit is reached fails with that reason
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `domain/post.ts` — states, allowed transitions, `canEdit`, `needsAttention`
- [ ] `domain/schedule.ts` — `checkRange(instant, now)` (2 min / 90 d), `isMissed(scheduledFor, now)` (15 min), `nextSendAt`, per-chat 3 s
- [ ] `domain/limits.ts` — 30 / 24 h, 100 scheduled, 20 destinations, `freesAt`
- [ ] `domain/connect-code.ts` — `newCode()`, `hashCode()` (reuse `platform/tokens.ts` hash), parse from `/connect@bot tgp_…` or a channel post text
- [ ] `domain/telegram-link.ts` — `t.me/<username>/<id>` or `t.me/c/<id without -100>/<msgId>`; unit tests for all

## Edge cases

| Case | Behaviour |
|---|---|
| transition published → draft | refused |
| exactly 15:00 after the time | still allowed; 15:00.001 → missed |
| code with surrounding text in a channel post | parsed |
| `/connect@other_bot tgp_x` | not ours → ignored |

## Definition of Done

- [ ] unit tests for every transition, window edge, limit and parser pass
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
