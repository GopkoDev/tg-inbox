---
id: T22
title: "Build SCR-40 the post page for every non-draft state, with SCR-41 delete-from-Telegram and mark-seen"
layer: "ui"
deps: ["T20"]
blocks: ["T23", "T24"]
acs: ["AC-07", "AC-08", "AC-12", "AC-13", "AC-15"]
files_hint: ["apps/web/src/features/posts/page/", "apps/web/src/pages/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T22 — Build SCR-40 the post page for every non-draft state, with SCR-41 delete-from-Telegram and mark-seen

## Place in the sequence

- **Blocked by:** T20 — Build SCR-37 the post editor with autosave, destination pick · **Blocks:** T23 — Add browser end-to-end posts flows against the real API: con, T24 — Update CLAUDE.md, the architecture map and the design-system · **Wave:** 4 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** to see each post's state live — draft, scheduled, published (and open it in Telegram), failed or missed with a plain reason
> **So that** the team notices at once when a post did not go out and can act
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to delete a post the bot published, shortly after it went out
> **So that** a mistake does not stay in front of the business's audience
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task delivers: build SCR-40 the post page for every non-draft state, with SCR-41 delete-from-Telegram and mark-seen.

## Inlined context

> SCR-40 states: loading · scheduled · sending · published (Open in Telegram, Delete within deletable_until) · failed (reason lines) · missed · not confirmed · deleted · needs attention (calls markPostSeen once) · operator · error · live
>
> — `screens.md SCR-40, abridged` · full text: [screens.md](../screens.md)

> SCR-41 refused: «The bot can no longer delete this post» / «Telegram did not let the bot delete it» / «Telegram is not responding — try again»
>
> — `screens.md SCR-41, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

getPost, markPostSeen, deletePostFromTelegram, duplicatePost.

— `contracts/openapi.yaml, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-07 — happy path

> **Given** a business owner with a draft for "Acme Flowers News" and a working bot
> **When** the owner opens Publish, sees the destination's Telegram name and kind and the exact text, and confirms
> **Then** the post appears in the channel from the bot within seconds (if the bot is paused by Telegram it waits, at most 15 minutes, then is marked missed), once, and is marked published with the time, the owner who published it and a way to open it in Telegram; its text and destination never change afterwards, and it can be duplicated into a new draft
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — domain invariant

> **Given** a draft that a business owner is publishing or scheduling
> **When** the owner double-clicks, two owners confirm at the same time, the draft was changed after the confirmation opened, or the service restarts while the post is being sent
> **Then** the post goes out at most once; a confirmation for a changed draft publishes nothing and shows the current version to confirm again; a send that got no answer from Telegram is marked "not confirmed — Telegram did not answer, not sent again" and is never repeated automatically
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — cross-context

> **Given** a post scheduled for 09:00
> **When** it cannot go out by 09:15 because the service was down, the bot was paused by Telegram or Telegram limited posting to that chat
> **Then** it is marked missed with the reason, is never published later, and counts as needing attention; after an outage, posts still inside their window go out in scheduled-time order, paced, and the rest are missed
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — error

> **Given** a published-now or scheduled post
> **When** Telegram refuses it — the bot lost the right to post or was removed from the chat, the chat no longer exists, or the text was refused
> **Then** the post is marked failed with that reason in plain language, is not tried again, is counted next to Posts in the navigation for the whole team until any member opens it, and the destination is marked unavailable with what is wrong when the bot can no longer post there
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** a post the bot published to "Acme Flowers News" less than 48 hours ago
> **When** a business owner deletes it from Telegram and confirms
> **Then** the message disappears from the channel, the post is marked deleted with the owner and time, and its text stays readable in the panel; after 48 hours, or if Telegram refuses, the panel says it can no longer be deleted by the bot
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] PostPage with reason copy per `outcome_reason`
- [ ] delete dialog
- [ ] tests per state

## Edge cases

| Case | Behaviour |
|---|---|
| deletable_until passes while open | delete hidden on re-read |

## Definition of Done

- [ ] component tests per state pass
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
