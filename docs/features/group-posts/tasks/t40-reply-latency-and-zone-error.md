---
id: T40
title: "Measure reply latency while posts go out, and give change time an error or retry when the workspace zone cannot be read"
layer: "tests"
deps: ["T39"]
blocks: []
acs: ["AC-09", "AC-17"]
files_hint: ["apps/api/src/e2e/posts-load.int.test.ts", "apps/web/src/pages/PostDetailPage.tsx"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
status: "todo"
step: ""
---

# T40 — Measure reply latency while posts go out, and give change time an error or retry when the workspace zone cannot be read

## Place in the sequence

- Third-round follow-up from the re-review (`_review/review-2026-11-04.md`). **Blocked by:** T39. **Lane:** own lane.

## Why (user story)

Closes the re-review items below (user stories: see each AC's US tag in [spec.md](../spec.md) §4).

## Inlined context

> R3: add a reply-latency run to `posts-load.int.test.ts`: replies at 2 per second while posts go out, for a scaled run. The time from reply send to Telegram accepting it must have p95 ≤ 2 s (test-plan.md NFR table). Replies go through the real inbox send path and the fake Bot API.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T33–T37, abridged`

> R5: in `PostDetailPage.tsx:48-56,104`, a failed `listDestinations` currently leaves `zone` null and makes Change time a silent no-op. Show the schedule dialog's error state with Retry, or retry the read, and add a component test.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T33–T37, abridged`

**Fallback:** read the cited code and [sad.md](../sad.md). Do not guess.

## Data delta

No DB changes.

## API contract

As in [openapi.yaml](../contracts/openapi.yaml).

## Acceptance criteria

### AC-09 — happy path

> **Given** a business owner of a workspace whose time zone is Europe/Kyiv, with a draft
> **When** the owner schedules it for tomorrow 09:00 and confirms the destination and text
> **Then** the post is marked scheduled for "09:00 (Europe/Kyiv)", shown in that zone to every member, appears in the chat within 1 minute after that time with no one online (posts due together in one chat follow each other a few seconds apart), and until then any member can move it back to a draft and an owner can change its time, which confirms it again
>
> — `spec.md §5, AC-09, verbatim`

### AC-17 — cross-context

> **Given** a destination group where customers chat busily and a broadcast and replies are being sent
> **When** posts go out and people write in the group
> **Then** nothing written in a destination is captured — no contact, conversation, unread or ping is created; customer messages to the bot and replies keep their usual speed; a limit Telegram applies to one chat delays only posts to that chat, while posts still wait for the bot's send pause
>
> — `spec.md §5, AC-17, verbatim`

## Checklist

- [ ] item 1 of Inlined context
- [ ] item 2 of Inlined context

## Edge cases

| Case | Behaviour |
|---|---|
| the cited scenario | the fixed behaviour, asserted by a test that failed before the fix |

## Definition of Done

- [ ] a RED test reproduces each item before the fix, then passes
- [ ] gate clean (tests of the touched modules + `pnpm lint`)
