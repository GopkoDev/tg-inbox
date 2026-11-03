---
id: T27
title: "Fix posts reads and drafts: SQL-side list filters with truncated, idempotent back-to-draft with expected_version, mark seen publishes post.changed, owner re-checked with lockActiveOwners"
layer: "app"
deps: []
blocks: []
acs: ["AC-03", "AC-11", "AC-13"]
files_hint: ["apps/api/src/modules/posts/app/post-reads.ts", "apps/api/src/modules/posts/app/drafts.ts", "apps/api/src/modules/posts/app/publish.ts", "apps/api/src/modules/posts/app/delete-published.ts", "apps/api/src/modules/posts/app/destinations.ts", "apps/api/src/modules/posts/http/routes.ts", "apps/api/src/modules/posts/infra/post-repo.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T27 — Fix posts reads and drafts: SQL-side list filters with truncated, idempotent back-to-draft with expected_version, mark seen publishes post.changed, owner re-checked with lockActiveOwners

## Place in the sequence

- Follow-up task from the review of 2026-11-04 (`_review/review-2026-11-04.md`, gate CHANGES REQUESTED). **Blocked by:** —.
- **Lane:** own lane.

## Why (user story)

Fixes review findings F9, F10, F11, F12 so the ACs below are genuinely met. User stories: see each AC's US tag in [spec.md](../spec.md) §4.

## Inlined context

The review findings this task resolves (verbatim rows):


| F9 | 1/2 | List filters in memory after a 200-row cap; `truncated` always false — `posts/http/routes.ts:165-173`, `post-reads.ts:78-99`, `post-repo.ts:392-395` | AC-13 | Fix → T27 |
| F10 | 1/2 | Back-to-draft ignores `expected_version`; an already-draft post answers 409, not `unchanged` — `drafts.ts:162-176`, `routes.ts:291-305` | AC-11 | Fix → T27 |
| F11 | 1/2 | Mark seen publishes no `post.changed` (shared count never drops live) — `post-reads.ts:160-166` | AC-13 | Fix → T27 |
| F12 | 1 | Owner role not re-checked under the lock for publish, schedule, delete, remove (`lockActiveMembers` instead of `lockActiveOwners`) — `publish.ts:91-97`, `delete-published.ts:44-47`, `destinations.ts:48-51` | AC-03, §6.1 | Fix → T27 |

— `_review/review-2026-11-04.md §Findings, verbatim` · full text: [review](../_review/review-2026-11-04.md)

**Fallback:** read the cited code and [sad.md](../sad.md) / [openapi.yaml](../contracts/openapi.yaml) / [screens.md](../screens.md) / [adr/](../adr/). Do not guess.

## Data delta

No DB changes (unless a finding requires a new enum value — then note it).

## API contract

As in [openapi.yaml](../contracts/openapi.yaml); keep responses in line with it.

## Acceptance criteria

### AC-03 — authorization

> **Given** an operator of "Acme Flowers"
> **When** they look at destinations, a draft or a published post
> **Then** they see the destinations and the post but are offered no way to connect or remove a destination, publish, schedule or delete a published post, and an attempt made anyway is refused and says only a business owner can do it; a saved link to an owner-only step opens the post instead
>
> — `spec.md §5, AC-03, verbatim`

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

## Checklist

- [ ] list: filter by states / needs_attention in SQL before the 200 cap; fetch 201 to set `truncated`
- [ ] back-to-draft: pass and compare `expected_version`; a draft answers `unchanged`; route returns the real outcome
- [ ] markSeen: in a transaction, publish `post.changed` when the mark was cleared
- [ ] use `lockActiveOwners` for publish, schedule, change time, delete-from-Telegram, remove destination, set time zone, create code
- [ ] publish-confirmation: no `not_a_draft` blocker for a scheduled post when used for change time (or a flag) so change time works
- [ ] tests incl. demotion committed before the lock

## Edge cases

| Case | Behaviour |
|---|---|
| the cited scenario | the fixed behaviour, asserted by a test that failed before the fix |

## Definition of Done

- [ ] a RED test reproduces each finding before the fix, then passes
- [ ] the gate (tests of the touched modules + `pnpm lint`) is clean
