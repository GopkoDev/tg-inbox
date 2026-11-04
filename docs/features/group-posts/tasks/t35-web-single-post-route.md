---
id: T35
title: "Keep one post page instance across new / :id / publish / schedule with real lazy routes, drop the second React root, and test with the real lazy route shape"
layer: "ui"
deps: []
blocks: []
acs: ["AC-05", "AC-06", "AC-11"]
files_hint: ["apps/web/src/app/routes.tsx", "apps/web/src/pages/PostDetailPage.tsx", "apps/web/src/pages/PostDetailPage.routing.test.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T35 — Keep one post page instance across new / :id / publish / schedule with real lazy routes, drop the second React root, and test with the real lazy route shape

## Place in the sequence

- Second-round follow-up from the re-review (`_review/review-2026-11-04.md` §Re-review after T25–T32). **Blocked by:** —. **Lane:** own lane.

## Why (user story)

Closes the re-review items below so the ACs listed are met end to end (user stories: see each AC's US tag in [spec.md](../spec.md) §4).

## Inlined context

> F16 — `routes.tsx:110-130` gives each post address its own `lazy()` in its own Suspense, and `PostDetailPage.tsx:194-205` keeps a module-level second `createRoot` with forwarded router contexts (cuts SidebarProvider etc. off). Use ONE lazy component constant for all four post routes (or a single `posts/:postId/:step?` route) so React keeps the instance; render the editor / post page / dialogs in the normal tree; keep the post store open across steps and flush on real unmount.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T25–T32, abridged`

> Rewrite `PostDetailPage.routing.test.tsx` to use the real lazy + Suspense route shape (the reviewer's failing repro lives at the scratchpad path `lazy/src/lazy-routing.test.tsx`): `/new → /:id` and `/:id → /:id/publish|schedule` keep one editor instance (mount count 1), keyboard focus and pending text.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T25–T32, abridged`

**Fallback:** read the cited code, [sad.md](../sad.md), [openapi.yaml](../contracts/openapi.yaml), [screens.md](../screens.md), [test-plan.md](../test-plan.md). Do not guess.

## Data delta

No DB changes (except staging the already-live migration 025 as a design record in T33).

## API contract

As in [openapi.yaml](../contracts/openapi.yaml).

## Acceptance criteria

### AC-05 — happy path

> **Given** an operator of "Acme Flowers" with the destination "Acme Flowers News"
> **When** they create a post, pick that destination, type the text and tick "send without sound"
> **Then** the draft is saved as they type, shows how the text will look in the chat and how many characters remain, and appears on the Posts page for every member with its destination and who last changed it
>
> — `spec.md §5, AC-05, verbatim`

### AC-06 — error

> **Given** an operator editing a draft
> **When** the text is empty after trimming spaces and line breaks, is longer than Telegram allows for one message, or no destination is picked, or a teammate saved a newer version of the draft meanwhile
> **Then** the draft cannot be published or scheduled, the editor says plainly what is missing or too long, and a stale save is refused with the teammate's current version shown, never overwriting it
>
> — `spec.md §5, AC-06, verbatim`

### AC-11 — domain invariant

> **Given** a scheduled post
> **When** any member changes its text, destination or sound option, or its scheduling owner is deactivated before its time
> **Then** the post first goes back to a draft (after a confirmation for the member, with a notice when it was the deactivation), so it only goes out after a business owner schedules or publishes it again; what goes out is always exactly what an owner confirmed
>
> — `spec.md §5, AC-11, verbatim`

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
