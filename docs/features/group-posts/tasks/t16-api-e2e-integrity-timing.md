---
id: T16
title: "Add the API end-to-end posts stories, the tenancy and secrecy suite, postIntegrity queries and the timing checks"
layer: "tests"
deps: ["T15"]
blocks: ["T23"]
acs: ["AC-01", "AC-04", "AC-07", "AC-08", "AC-09", "AC-12", "AC-17"]
files_hint: ["apps/api/src/e2e/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T16 — Add the API end-to-end posts stories, the tenancy and secrecy suite, postIntegrity queries and the timing checks

## Place in the sequence

- **Blocked by:** T15 — Register the posts routes (registerPosts): the 18 operations · **Blocks:** T23 — Add browser end-to-end posts flows against the real API: con · **Wave:** 9 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to connect the business's Telegram channel or group to the workspace by posting a code from the panel into it
> **So that** the team can post there through the business bot, and no other chat can be posted to by mistake
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

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
> **I want** replies to customers to go out and customer messages to arrive as fast as ever, whatever is being posted or written in the business's groups
> **So that** posting never makes support slower
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

This task delivers: add the API end-to-end posts stories, the tenancy and secrecy suite, postIntegrity queries and the timing checks.

## Inlined context

> Integrity run-book queries `postIntegrity.*` in `apps/api/src/e2e/helpers.ts`: posts whose send started more than 15 minutes late, two sends of one post, `sending` older than the job expiry, posts to a destination of another workspace, more than 30 sent in 24 h.
>
> — `sad.md §7 Monitoring, verbatim` · full text: [sad.md](../sad.md)

> | Scheduled post on time | p95 ≤ 30 s and max ≤ 60 s … | Customer capture unaffected | p95 capture time of private customer messages unchanged (± 1 s) while a destination group receives 10 messages per second |
>
> — `spec.md §6, abridged` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (reads all posts tables).

— `data-model.md §Entities, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Exercises every operation end to end.

— `contracts/openapi.yaml, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers" whose connected bot was added as an admin with the right to post to the channel "Acme Flowers News"
> **When** the owner creates a connect code in Settings and posts it in that channel within 10 minutes
> **Then** "Acme Flowers News" appears among the workspace's destinations, live, as a channel with its Telegram name, the code stops working, and the bot removes the code message from the channel when it is allowed to
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-04 — authorization

> **Given** members of "Acme Flowers" and of "Bolt Bikes"
> **When** a member of "Bolt Bikes" opens, edits or publishes a post or a destination of "Acme Flowers" by its address
> **Then** the system refuses as if it did not exist and reveals nothing about it; each workspace sees and posts only to its own destinations, through its own bot
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

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

### AC-12 — cross-context

> **Given** a post scheduled for 09:00
> **When** it cannot go out by 09:15 because the service was down, the bot was paused by Telegram or Telegram limited posting to that chat
> **Then** it is marked missed with the reason, is never published later, and counts as needing attention; after an outage, posts still inside their window go out in scheduled-time order, paced, and the rest are missed
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — cross-context

> **Given** a destination group where customers chat busily and a broadcast and replies are being sent
> **When** posts go out and people write in the group
> **Then** nothing written in a destination is captured — no contact, conversation, unread or ping is created; customer messages to the bot and replies keep their usual speed; a limit Telegram applies to one chat delays only posts to that chat, while posts still wait for the bot's send pause
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] e2e: connect channel by code → draft → schedule → goes out → published → delete
- [ ] e2e: outage > 15 min → missed; restart mid-send → not confirmed
- [ ] tenancy + secrecy: no text / title / chat id in logs, frames, job payloads
- [ ] postIntegrity queries all 0 rows after the suite
- [ ] timing: on-time with fake clock; group flood vs private capture

## Edge cases

| Case | Behaviour |
|---|---|
| log scan finds post text | test fails |

## Definition of Done

- [ ] e2e suite green; integrity queries return 0 rows
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
