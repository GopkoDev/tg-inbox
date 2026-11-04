---
id: T33
title: "Guard a live claim against a same-moment job, prove the owner re-check with a demoted-owner test, step older migration tests off migration 025, and bring the contract, data model and staged migrations in line with the new code results"
layer: "app"
deps: []
blocks: []
acs: ["AC-01", "AC-02", "AC-03", "AC-07", "AC-08"]
files_hint: ["apps/api/src/modules/posts/app/send-post.ts", "apps/api/src/test/migrations.int.test.ts", "apps/api/src/modules/posts/app/publish.test.ts", "docs/features/group-posts/contracts/openapi.yaml", "docs/features/group-posts/data-model.md", "docs/features/group-posts/migrations/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T33 — Guard a live claim against a same-moment job, prove the owner re-check with a demoted-owner test, step older migration tests off migration 025, and bring the contract, data model and staged migrations in line with the new code results

## Place in the sequence

- Second-round follow-up from the re-review (`_review/review-2026-11-04.md` §Re-review after T25–T32). **Blocked by:** —. **Lane:** own lane.

## Why (user story)

Closes the re-review items below so the ACs listed are met end to end (user stories: see each AC's US tag in [spec.md](../spec.md) §4).

## Inlined context

> N1 — `send-post.ts:94-104`: a job whose moment equals a live claim's must not settle it as not confirmed while the send can still be in flight: settle a `sending` claim only when `sending_started_at` is older than the send timeout plus a margin (else return; retry / dead letter settle later). Unit test with two jobs of the same moment.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T25–T32, abridged`

> F12 — add tests (unit with a role-aware fake AND one integration through the real `workspaceAccess` / `lockActiveOwners`) proving an owner demoted to operator before the lock is refused `OWNER_ONLY` for publish, schedule, delete-from-Telegram, remove destination, set time zone, create code.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T25–T32, abridged`

> N3 — `src/test/migrations.int.test.ts`: the 'later migrations' lists / loop counts (≈ lines 713, 1233, 2453) must also step off `1791681110025_widen_destination_codes_result`; prefer deriving the count from the migration folder after the target so future features do not break it.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T25–T32, abridged`

> N2 — add `destination_limit` (and its meaning) to `contracts/openapi.yaml` `DestinationCodeStatus.status` and the `getDestinationCode` description; add `no_send_right` / `destination_limit` to `data-model.md` destination_codes.result; stage the migration as `migrations/05_widen_destination_codes_result.{up,down}.sql` (verbatim SQL of the live 025).
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

### AC-02 — domain invariant

> **Given** a business owner whose bot is in a group but may not send messages there, or in a channel without the right to post
> **When** the owner posts a valid connect code there
> **Then** the chat is not connected, and Settings tells the owner which right the bot needs in that chat; a chat the bot was added to without a code never becomes a destination; an expired or already used code connects nothing, and Settings shows the code as expired
>
> — `spec.md §5, AC-02, verbatim`

### AC-03 — authorization

> **Given** an operator of "Acme Flowers"
> **When** they look at destinations, a draft or a published post
> **Then** they see the destinations and the post but are offered no way to connect or remove a destination, publish, schedule or delete a published post, and an attempt made anyway is refused and says only a business owner can do it; a saved link to an owner-only step opens the post instead
>
> — `spec.md §5, AC-03, verbatim`

### AC-07 — happy path

> **Given** a business owner with a draft for "Acme Flowers News" and a working bot
> **When** the owner opens Publish, sees the destination's Telegram name and kind and the exact text, and confirms
> **Then** the post appears in the channel from the bot within seconds (if the bot is paused by Telegram it waits, at most 15 minutes, then is marked missed), once, and is marked published with the time, the owner who published it and a way to open it in Telegram; its text and destination never change afterwards, and it can be duplicated into a new draft
>
> — `spec.md §5, AC-07, verbatim`

### AC-08 — domain invariant

> **Given** a draft that a business owner is publishing or scheduling
> **When** the owner double-clicks, two owners confirm at the same time, the draft was changed after the confirmation opened, or the service restarts while the post is being sent
> **Then** the post goes out at most once; a confirmation for a changed draft publishes nothing and shows the current version to confirm again; a send that got no answer from Telegram is marked "not confirmed — Telegram did not answer, not sent again" and is never repeated automatically
>
> — `spec.md §5, AC-08, verbatim`

## Checklist

- [ ] item 1 of Inlined context
- [ ] item 2 of Inlined context
- [ ] item 3 of Inlined context
- [ ] item 4 of Inlined context

## Edge cases

| Case | Behaviour |
|---|---|
| the cited scenario | the fixed behaviour, asserted by a test that failed before the fix |

## Definition of Done

- [ ] a RED test reproduces each item before the fix, then passes
- [ ] gate clean (tests of the touched modules + `pnpm lint`)
