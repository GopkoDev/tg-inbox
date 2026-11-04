---
id: T12
title: "Add the posts.send job body: re-check owner and limits, per-chat order and pauses, claim before the send, outcomes, missed after 15 minutes, and the dead-letter settler"
layer: "app"
deps: ["T6", "T11"]
blocks: ["T14"]
acs: ["AC-08", "AC-11", "AC-12", "AC-13", "AC-14", "AC-16", "AC-17"]
files_hint: ["apps/api/src/modules/posts/app/send-post.ts", "apps/api/src/modules/posts/app/settle-dead-letter.ts"]
owner: "Dmytro Hopko"
estimate: "L"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T12 — Add the posts.send job body: re-check owner and limits, per-chat order and pauses, claim before the send, outcomes, missed after 15 minutes, and the dead-letter settler

## Place in the sequence

- **Blocked by:** T6 — Add bots.sendPost, bots.deletePost and postReadiness with a , T11 — Add the publish confirmation, publish now and schedule / cha · **Blocks:** T14 — Wire posts in buildDeps and buildApp: ChatEventsPort, onMemb · **Wave:** 6 (after its deps).
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

> **As an** Operator
> **I want** to see each post's state live — draft, scheduled, published (and open it in Telegram), failed or missed with a plain reason
> **So that** the team notices at once when a post did not go out and can act
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** replies to customers to go out and customer messages to arrive as fast as ever, whatever is being posted or written in the business's groups
> **So that** posting never makes support slower
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

This task delivers: add the posts.send job body: re-check owner and limits, per-chat order and pauses, claim before the send, outcomes, missed after 15 minutes, and the dead-letter settler.

## Inlined context

> Flow 2: share-lock the scheduling owner's membership; take the workspace posting lock, lock the post; check state, version, moment, window and the daily count; alt changed, rescheduled or back to draft → nothing; owner no longer an active business owner → back to draft with a notice; past the 15-minute window → missed …; an earlier post to this chat is due, the chat or the bot is paused → queue again after the wait; daily limit reached, destination unavailable or bot not working → failed …; ready → claim as sending and commit; send; accepted → published …; per-chat rate limit → back to scheduled, destination paused, queue again; refused → failed …; no answer → not confirmed
>
> — `sad.md §6 Critical flow 2, abridged` · full text: [sad.md](../sad.md)

> The post's own state is the idempotency key … any later attempt that finds a claim without an outcome settles it as not confirmed … the dead letter only settles what is left
>
> — `sad.md §6 Flow 11, abridged` · full text: [sad.md](../sad.md)

> ≤ 1 post per 3 s into one chat via `next_send_at`, ≤ 1 per second per bot via the post pacer
>
> — `sad.md §11, abridged` · full text: [sad.md](../sad.md)

> Hard rule (NFR): 0 posts sent twice … 0 posts whose send to Telegram started more than 15 min after their scheduled time
>
> — `spec.md §6, abridged` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

`posts` (claim / outcome columns, `needs_attention`, `draft_notice`), `destinations.paused_until`, `next_send_at`, `availability`.

— `data-model.md §Entities, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — job `posts.send` payload `{post_id, workspace_id, moment}`; DLQ `posts.send-dlq` (contracts/events.md).

## Acceptance criteria

### AC-08 — domain invariant

> **Given** a draft that a business owner is publishing or scheduling
> **When** the owner double-clicks, two owners confirm at the same time, the draft was changed after the confirmation opened, or the service restarts while the post is being sent
> **Then** the post goes out at most once; a confirmation for a changed draft publishes nothing and shows the current version to confirm again; a send that got no answer from Telegram is marked "not confirmed — Telegram did not answer, not sent again" and is never repeated automatically
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

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

### AC-13 — error

> **Given** a published-now or scheduled post
> **When** Telegram refuses it — the bot lost the right to post or was removed from the chat, the chat no longer exists, or the text was refused
> **Then** the post is marked failed with that reason in plain language, is not tried again, is counted next to Posts in the navigation for the whole team until any member opens it, and the destination is marked unavailable with what is wrong when the bot can no longer post there
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

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

### AC-17 — cross-context

> **Given** a destination group where customers chat busily and a broadcast and replies are being sent
> **When** posts go out and people write in the group
> **Then** nothing written in a destination is captured — no contact, conversation, unread or ping is created; customer messages to the bot and replies keep their usual speed; a limit Telegram applies to one chat delays only posts to that chat, while posts still wait for the bot's send pause
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `send-post.ts` per flow 2 with a fake clock
- [ ] settler per flow 11
- [ ] outcome writes + `post.changed`; destination marked on `no_post_right` / `chat_gone`
- [ ] integration tests: restart mid-send (hang), 429, outage > 15 min, three posts due together in one chat, owner demoted

## Edge cases

| Case | Behaviour |
|---|---|
| job for an old moment | exit |
| claim found without outcome | not_confirmed, attention |
| post 429 | destination paused, back to scheduled, requeued; bot pause untouched |
| bot replaced | failed `not_current_bot` |

## Definition of Done

- [ ] integration tests per branch pass with the fake Telegram and fake clock
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
