---
id: T36
title: "Show the destination-limit result in the connect dialog, and show the code expiry and the change-time prefill only in the workspace time zone"
layer: "ui"
deps: ["T35"]
blocks: []
acs: ["AC-01", "AC-09"]
files_hint: ["apps/web/src/features/posts/settings/ConnectCodeDialog.tsx", "apps/web/src/pages/PostDetailPage.tsx", "apps/web/src/features/posts/time.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T36 — Show the destination-limit result in the connect dialog, and show the code expiry and the change-time prefill only in the workspace time zone

## Place in the sequence

- Second-round follow-up from the re-review (`_review/review-2026-11-04.md` §Re-review after T25–T32). **Blocked by:** T35. **Lane:** own lane.

## Why (user story)

Closes the re-review items below so the ACs listed are met end to end (user stories: see each AC's US tag in [spec.md](../spec.md) §4).

## Inlined context

> F5 — `ConnectCodeDialog.tsx:117-120,240-243`: `destination_limit` gets its own view (Alert «You can connect up to 20 channels and groups», no spinner, no «Waiting…»); component test.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T25–T32, abridged`

> F21 — `ConnectCodeDialog.tsx:34-35`: expiry via `formatPostTime` with the workspace zone named; `PostDetailPage.tsx:117`: do not open the change-time dialog (or prefill) until the workspace zone is known; tests.
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
