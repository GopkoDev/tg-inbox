---
id: T2
title: "Add the posts zod contracts, the 17 new error codes, and the post.changed / destinations.changed frames and signals"
layer: "ports"
deps: []
blocks: ["T4", "T5", "T6", "T17"]
acs: ["AC-04", "AC-06"]
files_hint: ["packages/shared/src/posts.ts", "packages/shared/src/errors.ts", "packages/shared/src/inbox.ts", "packages/shared/src/index.ts", "apps/api/src/platform/realtime.ts", "apps/api/src/platform/errors.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T2 — Add the posts zod contracts, the 17 new error codes, and the post.changed / destinations.changed frames and signals

## Place in the sequence

- **Blocked by:** — · **Blocks:** T4 — Add the posts domain: states and transitions, the schedule w, T5 — Classify group and channel updates in bots into four facts, , T6 — Add bots.sendPost, bots.deletePost and postReadiness with a , T17 — Add the web posts API source, stores (posts, destinations, a · **Wave:** 1 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** to write a post for one of the workspace's destinations and save it as a draft the team can see and edit
> **So that** posts are prepared together before an owner sends them
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to see each post's state live — draft, scheduled, published (and open it in Telegram), failed or missed with a plain reason
> **So that** the team notices at once when a post did not go out and can act
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

This task delivers: add the posts zod contracts, the 17 new error codes, and the post.changed / destinations.changed frames and signals.

## Inlined context

> Every schema in `components.schemas` (PostState, PostOutcomeReason, DraftNotice, DestinationKind, DestinationProblem, DestinationRef, Destination, DestinationList, DestinationCodeCreated, DestinationCodeStatus, DestinationRemoved, TimeZoneSet, TimeZoneSaved, PostSummary, PostList, Post, PostCreate, PostSave, ExpectedVersion, PostSchedule, PublishConfirmation, PostScheduled, PostOutcome, Outcome, PostAttention).
>
> — `contracts/openapi.yaml §components.schemas, abridged` · full text: [contracts/openapi.yaml](../contracts/openapi.yaml)

> New (to add to `packages/shared/src/errors.ts` at implement): `POST_TEXT_INVALID`, `POST_DRAFT_CHANGED`, `POST_NOT_A_DRAFT`, `POST_NOT_SCHEDULED`, `POST_NOT_PUBLISHED`, `POST_SCHEDULE_OUT_OF_RANGE`, `POST_TIME_DOES_NOT_EXIST`, `POST_DAILY_LIMIT_REACHED`, `POST_SCHEDULED_LIMIT_REACHED`, `POST_DELETE_WINDOW_PASSED`, `POST_DELETE_REFUSED`, `DESTINATION_UNAVAILABLE`, `DESTINATION_LIMIT_REACHED`, `POSTS_NEED_WORKING_BOT`, `TIME_ZONE_REQUIRED`, `TIME_ZONE_INVALID`, `TIME_ZONE_CHANGED`
>
> — `contracts/api-sync-report.md §Drift checklist, verbatim` · full text: [contracts/api-sync-report.md](../contracts/api-sync-report.md)

> `post.changed` `{ workspace_id, post_id }` and `destinations.changed` `{ workspace_id }`, published by `posts` inside the writing transaction; both to every socket of the workspace.
>
> — `contracts/events.md §Realtime signals + Assumptions 1, abridged` · full text: [contracts/events.md](../contracts/events.md)

> Text rule: the shipped `packages/shared/src/broadcast-text.ts` (UTF-16 units after trimming, 1–4096) is reused as is, not copied
>
> — `sad.md §4 Supporting choices, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Shared DTOs for every operation in `contracts/openapi.yaml` (list above); error classes in `apps/api/src/platform/errors.ts` per the existing specific-code pattern (e.g. `PostDraftChangedError` → 409).

## Acceptance criteria

### AC-04 — authorization

> **Given** members of "Acme Flowers" and of "Bolt Bikes"
> **When** a member of "Bolt Bikes" opens, edits or publishes a post or a destination of "Acme Flowers" by its address
> **Then** the system refuses as if it did not exist and reveals nothing about it; each workspace sees and posts only to its own destinations, through its own bot
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — error

> **Given** an operator editing a draft
> **When** the text is empty after trimming spaces and line breaks, is longer than Telegram allows for one message, or no destination is picked, or a teammate saved a newer version of the draft meanwhile
> **Then** the draft cannot be published or scheduled, the editor says plainly what is missing or too long, and a stale save is refused with the teammate's current version shown, never overwriting it
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `packages/shared/src/posts.ts` — zod schemas mirroring the contract components (snake_case fields)
- [ ] `packages/shared/src/errors.ts` — the 17 codes; `apps/api/src/platform/errors.ts` — subclasses with status per contract
- [ ] `packages/shared/src/inbox.ts` `LiveFrame` + `apps/api/src/platform/realtime.ts` signal union — `post.changed`, `destinations.changed`
- [ ] schema unit tests (parse the contract examples)

## Edge cases

| Case | Behaviour |
|---|---|
| unknown frame type on an old tab | ignored by the existing parser |
| text over 4096 UTF-16 units | schema refuses via broadcast-text rule |

## Definition of Done

- [ ] contract examples parse with the new schemas
- [ ] `pnpm -r build` green (api + web compile with the new unions)
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
