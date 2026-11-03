---
id: T25
title: "Fix the posts.send job: same-instant order and 3 s pace, stale-job settle only for its own moment, wait past the window \u2192 missed now with the pause reason, lock order destination \u2192 post"
layer: "app"
deps: []
blocks: []
acs: ["AC-08", "AC-09", "AC-12", "AC-15", "AC-17"]
files_hint: ["apps/api/src/modules/posts/app/send-post.ts", "apps/api/src/modules/posts/infra/post-repo.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T25 — Fix the posts.send job: same-instant order and 3 s pace, stale-job settle only for its own moment, wait past the window → missed now with the pause reason, lock order destination → post

## Place in the sequence

- Follow-up task from the review of 2026-11-04 (`_review/review-2026-11-04.md`, gate CHANGES REQUESTED). **Blocked by:** —.
- **Lane:** own lane.

## Why (user story)

Fixes review findings F1, F2, F3, F4 so the ACs below are genuinely met. User stories: see each AC's US tag in [spec.md](../spec.md) §4.

## Inlined context

The review findings this task resolves (verbatim rows):


| F1 | 1 | Posts due at the same instant in one chat skip order and the 3 s pace: strict `scheduled_for < moment`, `next_send_at` set only after the answer, `sending` posts not counted — `posts/infra/post-repo.ts:476`, `posts/app/send-post.ts:161-176` | AC-09, AC-17, §6 | Fix → T25 |
| F2 | 2 | A stale job settles another job's live `sending` claim as not confirmed (no moment check, no lock), losing the published outcome — `send-post.ts:92-98` | AC-08, AC-15 | Fix → T25 |
| F3 | 1 | A pause / 429 that ends past `moment + 15 min` keeps the post scheduled and later marks it missed with `service_down` — `send-post.ts:143-148,164-170,230-234` | AC-12 | Fix → T25 |
| F4 | 2 | Send job locks post before destination, against sad.md §8 — `send-post.ts:120-129,211-224` | n/a | Fix → T25 |

— `_review/review-2026-11-04.md §Findings, verbatim` · full text: [review](../_review/review-2026-11-04.md)

**Fallback:** read the cited code and [sad.md](../sad.md) / [openapi.yaml](../contracts/openapi.yaml) / [screens.md](../screens.md) / [adr/](../adr/). Do not guess.

## Data delta

No DB changes (unless a finding requires a new enum value — then note it).

## API contract

As in [openapi.yaml](../contracts/openapi.yaml); keep responses in line with it.

## Acceptance criteria

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

### AC-17 — cross-context

> **Given** a destination group where customers chat busily and a broadcast and replies are being sent
> **When** posts go out and people write in the group
> **Then** nothing written in a destination is captured — no contact, conversation, unread or ping is created; customer messages to the bot and replies keep their usual speed; a limit Telegram applies to one chat delays only posts to that chat, while posts still wait for the bot's send pause
>
> — `spec.md §5, AC-17, verbatim`

## Checklist

- [ ] tie-break due posts by (scheduled_for, id); a `sending` post of the same destination is a reason to wait; set `next_send_at = now + 3 s` in the claim transaction
- [ ] settle a `sending` claim only when `scheduled_for` equals the job moment, under the post lock
- [ ] when the computed wait ends after `moment + 15 min`, mark missed now with `bot_paused` / `chat_rate_limited`
- [ ] lock destination before post in prepare; update destination before post in record
- [ ] tests: two/three posts at the identical instant with interleaved prepare (integration); old-moment job finding `sending`; pause past window

## Edge cases

| Case | Behaviour |
|---|---|
| the cited scenario | the fixed behaviour, asserted by a test that failed before the fix |

## Definition of Done

- [ ] a RED test reproduces each finding before the fix, then passes
- [ ] the gate (tests of the touched modules + `pnpm lint`) is clean
