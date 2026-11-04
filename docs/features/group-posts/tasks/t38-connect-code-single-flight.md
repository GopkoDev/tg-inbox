---
id: T38
title: "Create exactly one connect code per dialog open and make the newest code the live one, show the expiry when the workspace has no time zone, and get the AC-01 browser flow green"
layer: "ui"
deps: []
blocks: []
acs: ["AC-01", "AC-02"]
files_hint: ["apps/web/src/features/posts/settings/ConnectCodeDialog.tsx", "apps/api/src/modules/posts/app/destinations.ts", "apps/api/src/modules/posts/infra/code-repo.ts", "apps/web/e2e/posts.spec.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
status: "done"
step: "COMMIT"
---

# T38 — Create exactly one connect code per dialog open and make the newest code the live one, show the expiry when the workspace has no time zone, and get the AC-01 browser flow green

## Place in the sequence

- Third-round follow-up from the re-review (`_review/review-2026-11-04.md`). **Blocked by:** —. **Lane:** own lane.

## Why (user story)

Closes the re-review items below (user stories: see each AC's US tag in [spec.md](../spec.md) §4).

## Inlined context

> R1: in `ConnectCodeDialog.tsx:82-99`, `createDestinationCode` runs in a `useEffect`, so under `<StrictMode>` (main.tsx:9; the e2e bundle is a development build) it fires twice. `createCode` (`destinations.ts:83-90`) replaces the owner's earlier live codes in whichever transaction runs later, so the code shown on screen can already be replaced. Fix: create the code once per dialog open, e.g. from the Connect click, or reuse the in-flight promise across the StrictMode re-run. Also serialize `createCode` per owner with an advisory lock taken before replacing, so the newest code is the live one. Tests: a component test under StrictMode that asserts exactly one create call; an API test where two concurrent creates leave exactly one live code, the later one.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T33–T37, abridged`

> R4: in `ConnectCodeDialog.tsx:243`, when the workspace zone is unset, still show the expiry: the relative «Expires in 10 min», or the time with the browser zone named. Update the test at `ConnectCodeDialog.test.tsx:89-93`.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T33–T37, abridged`

> N4: `pnpm --filter @tg/web test:e2e -- e2e/posts.spec.ts` must pass every test (AC-01 included) twice in a row, run alone.
>
> — `docs/features/group-posts/_review/review-2026-11-04.md §Re-review after T33–T37, abridged`

**Fallback:** read the cited code and [sad.md](../sad.md). Do not guess.

## Data delta

No DB changes.

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

## Checklist

- [ ] item 1 of Inlined context
- [ ] item 2 of Inlined context
- [ ] item 3 of Inlined context

## Edge cases

| Case | Behaviour |
|---|---|
| the cited scenario | the fixed behaviour, asserted by a test that failed before the fix |

## Definition of Done

- [ ] a RED test reproduces each item before the fix, then passes
- [ ] gate clean (tests of the touched modules + `pnpm lint`)
