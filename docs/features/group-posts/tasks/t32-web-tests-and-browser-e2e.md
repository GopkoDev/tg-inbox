---
id: T32
title: "Make the web tests assert real outcomes and run the browser e2e suite green, adding attention and change-time flows"
layer: "tests"
deps: ["T28", "T30", "T31"]
blocks: []
acs: ["AC-09", "AC-11", "AC-13", "AC-18"]
files_hint: ["apps/web/src/features/posts/", "apps/web/src/pages/", "apps/web/e2e/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T32 — Make the web tests assert real outcomes and run the browser e2e suite green, adding attention and change-time flows

## Place in the sequence

- Follow-up task from the review of 2026-11-04 (`_review/review-2026-11-04.md`, gate CHANGES REQUESTED). **Blocked by:** T28, T30, T31.
- **Lane:** own lane.

## Why (user story)

Fixes review findings F27 so the ACs below are genuinely met. User stories: see each AC's US tag in [spec.md](../spec.md) §4.

## Inlined context

The review findings this task resolves (verbatim rows):


| F27 | 1/2 | Web tests tautological or missing (delete refused, switch to post page, detail-page 404 / live, e2e back-to-draft); no e2e-through-UI for attention or change time; the browser e2e suite was not run green (operator "Change time" expectation cannot pass) — `PostEditor.test.tsx:308-347`, `PostDetailPage.test.tsx:6-58`, `e2e/posts.spec.ts:164-168` | AC-09, AC-11, AC-13, AC-18 | Fix → T32 |

— `_review/review-2026-11-04.md §Findings, verbatim` · full text: [review](../_review/review-2026-11-04.md)

**Fallback:** read the cited code and [sad.md](../sad.md) / [openapi.yaml](../contracts/openapi.yaml) / [screens.md](../screens.md) / [adr/](../adr/). Do not guess.

## Data delta

No DB changes (unless a finding requires a new enum value — then note it).

## API contract

As in [openapi.yaml](../contracts/openapi.yaml); keep responses in line with it.

## Acceptance criteria

### AC-09 — happy path

> **Given** a business owner of a workspace whose time zone is Europe/Kyiv, with a draft
> **When** the owner schedules it for tomorrow 09:00 and confirms the destination and text
> **Then** the post is marked scheduled for "09:00 (Europe/Kyiv)", shown in that zone to every member, appears in the chat within 1 minute after that time with no one online (posts due together in one chat follow each other a few seconds apart), and until then any member can move it back to a draft and an owner can change its time, which confirms it again
>
> — `spec.md §5, AC-09, verbatim`

### AC-11 — domain invariant

> **Given** a scheduled post
> **When** any member changes its text, destination or sound option, or its scheduling owner is deactivated before its time
> **Then** the post first goes back to a draft (after a confirmation for the member, with a notice when it was the deactivation), so it only goes out after a business owner schedules or publishes it again; what goes out is always exactly what an owner confirmed
>
> — `spec.md §5, AC-11, verbatim`

### AC-13 — error

> **Given** a published-now or scheduled post
> **When** Telegram refuses it — the bot lost the right to post or was removed from the chat, the chat no longer exists, or the text was refused
> **Then** the post is marked failed with that reason in plain language, is not tried again, is counted next to Posts in the navigation for the whole team until any member opens it, and the destination is marked unavailable with what is wrong when the bot can no longer post there
>
> — `spec.md §5, AC-13, verbatim`

### AC-18 — authorization

> **Given** a draft created by an operator
> **When** another operator tries to delete it
> **Then** they are refused and told only its author or a business owner can delete it; a scheduled post must be moved back to a draft first, and a published, failed or missed post is kept as a record and cannot be deleted from the panel
>
> — `spec.md §5, AC-18, verbatim`

## Checklist

- [ ] replace tautological tests: delete refused → FORBIDDEN alert after confirming; back-to-draft → editor rendered; POST_NOT_A_DRAFT → post page
- [ ] e2e-through-UI: US-05 nav attention count cleared on open; change time by an owner; operator sees no Change time
- [ ] run `pnpm --filter @tg/web test:e2e` (Playwright, real API, fake Telegram) and make it green; report the command output

## Edge cases

| Case | Behaviour |
|---|---|
| the cited scenario | the fixed behaviour, asserted by a test that failed before the fix |

## Definition of Done

- [ ] a RED test reproduces each finding before the fix, then passes
- [ ] the gate (tests of the touched modules + `pnpm lint`) is clean
