---
id: T37
title: "Make the whole browser e2e suite pass, starting with the AC-01 connect flow that times out on \u00ab\u2026 is connected\u00bb"
layer: "tests"
deps: ["T33", "T35", "T36"]
blocks: []
acs: ["AC-01", "AC-09", "AC-13"]
files_hint: ["apps/web/e2e/", "apps/web/src/features/posts/settings/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T37 — Make the whole browser e2e suite pass, starting with the AC-01 connect flow that times out on «… is connected»

## Place in the sequence

- Second-round follow-up from the re-review (`_review/review-2026-11-04.md` §Re-review after T25–T32). **Blocked by:** T33, T35, T36. **Lane:** own lane.

## Why (user story)

Closes the re-review items below so the ACs listed are met end to end (user stories: see each AC's US tag in [spec.md](../spec.md) §4).

## Inlined context

> N4 — `apps/web/e2e/posts.spec.ts:83`: after `world.channelPost(token, CHANNEL, code)` the dialog never shows «Acme Flowers News is connected» within 20 s. Since T31 the dialog re-reads only on `destinations.changed` / resync (no polling) — check that redeem publishes `destinations.changed` in its transaction, that the hub forwards it to every socket of the workspace, and that the dialog re-reads on it (and on reconnect). Fix the real cause (not the test's expectation).
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T25–T32, abridged`

> Run the WHOLE suite: `pnpm --filter @tg/web test:e2e` must pass (all specs, not only posts). Report the final summary line.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T25–T32, abridged`

**Fallback:** read the cited code, [sad.md](../sad.md), [openapi.yaml](../contracts/openapi.yaml), [screens.md](../screens.md), [test-plan.md](../test-plan.md). Do not guess.

## Data delta

No DB changes (except staging the already-live migration 025 as a design record in T33).

## API contract

As in [openapi.yaml](../contracts/openapi.yaml).

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers" whose connected bot was added as an admin with the right to post to the channel "Acme Flowers News"
> **When** the owner creates a connect code in Settings and posts it in that channel within 10 minutes
> **Then** "Acme Flowers News" appears among the workspace's destinations, live, as a channel with its Telegram name, the code stops working, and the bot removes the code message from the channel when it is allowed to
>
> — `spec.md §5, AC-01, verbatim`

### AC-09 — happy path

> **Given** a business owner of a workspace whose time zone is Europe/Kyiv, with a draft
> **When** the owner schedules it for tomorrow 09:00 and confirms the destination and text
> **Then** the post is marked scheduled for "09:00 (Europe/Kyiv)", shown in that zone to every member, appears in the chat within 1 minute after that time with no one online (posts due together in one chat follow each other a few seconds apart), and until then any member can move it back to a draft and an owner can change its time, which confirms it again
>
> — `spec.md §5, AC-09, verbatim`

### AC-13 — error

> **Given** a published-now or scheduled post
> **When** Telegram refuses it — the bot lost the right to post or was removed from the chat, the chat no longer exists, or the text was refused
> **Then** the post is marked failed with that reason in plain language, is not tried again, is counted next to Posts in the navigation for the whole team until any member opens it, and the destination is marked unavailable with what is wrong when the bot can no longer post there
>
> — `spec.md §5, AC-13, verbatim`

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
