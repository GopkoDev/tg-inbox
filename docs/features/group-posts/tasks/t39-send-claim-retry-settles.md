---
id: T39
title: "After a send job throws following its claim, guarantee that a later run settles the post as not confirmed \u2014 never stuck in sending"
layer: "app"
deps: []
blocks: []
acs: ["AC-08"]
files_hint: ["apps/api/src/modules/posts/app/send-post.ts", "apps/api/src/modules/posts/infra/jobs.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
status: "todo"
step: ""
---

# T39 — After a send job throws following its claim, guarantee that a later run settles the post as not confirmed — never stuck in sending

## Place in the sequence

- Third-round follow-up from the re-review (`_review/review-2026-11-04.md`). **Blocked by:** —. **Lane:** own lane.

## Why (user story)

Closes the re-review items below (user stories: see each AC's US tag in [spec.md](../spec.md) §4).

## Inlined context

> R2: in `send-post.ts:102-104`, while a same-moment claim is younger than `CLAIM_STALE_MS`, `prepare` returns `done`. The job's pg-boss retries (1–2 s, then 2–4 s) find a fresh claim and finish, so nothing settles the post. Fix: when the claim is the same moment but not stale yet, queue the same job in the same transaction with `startAfter = sendingStartedAt + CLAIM_STALE_MS`, so a later run settles it safely. Do not throw: the dead-letter settler has no staleness check and would settle a live claim. Make sure the dead-letter settler also respects staleness, or re-queues. Update the comment at `jobs.ts:88-89`. Tests: a unit test where the job throws after the claim, a retry 2 s later re-queues, and the post ends `not_confirmed`, never stuck. Reuse the reviewer's repro at `/private/tmp/claude-501/-Users-d-Documents-Own-Projects-tg/51b5329d-5934-49fb-a9c4-5b270ea4e678/scratchpad/n1/n1-retry.test.ts` as the RED (move it into `send-post.test.ts` or `jobs.int.test.ts`).
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T33–T37, abridged`

> After the suites, `postIntegrity.sendingPastExpiry` returns 0 rows.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T33–T37, abridged`

**Fallback:** read the cited code and [sad.md](../sad.md). Do not guess.

## Data delta

No DB changes.

## API contract

As in [openapi.yaml](../contracts/openapi.yaml).

## Acceptance criteria

### AC-08 — domain invariant

> **Given** a draft that a business owner is publishing or scheduling
> **When** the owner double-clicks, two owners confirm at the same time, the draft was changed after the confirmation opened, or the service restarts while the post is being sent
> **Then** the post goes out at most once; a confirmation for a changed draft publishes nothing and shows the current version to confirm again; a send that got no answer from Telegram is marked "not confirmed — Telegram did not answer, not sent again" and is never repeated automatically
>
> — `spec.md §5, AC-08, verbatim`

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
