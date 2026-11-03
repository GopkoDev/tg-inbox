---
id: T19
title: "Build SCR-36 the Posts list with state filters, workspace-zone times and the attention rows"
layer: "ui"
deps: ["T17"]
blocks: ["T23", "T24"]
acs: ["AC-05", "AC-12", "AC-13"]
files_hint: ["apps/web/src/features/posts/list/", "apps/web/src/pages/"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T19 — Build SCR-36 the Posts list with state filters, workspace-zone times and the attention rows

## Place in the sequence

- **Blocked by:** T17 — Add the web posts API source, stores (posts, destinations, a · **Blocks:** T23 — Add browser end-to-end posts flows against the real API: con, T24 — Update CLAUDE.md, the architecture map and the design-system · **Wave:** 3 (after its deps).
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

This task delivers: build SCR-36 the Posts list with state filters, workspace-zone times and the attention rows.

## Inlined context

> SCR-36 states: loading · default (PostsTable, filter Tabs All / Drafts / Scheduled / Published / Needs attention, state Badge with time) · needs attention row · empty (+ no destination → SCR-33) · empty filter · truncated · error · live
>
> — `screens.md SCR-36, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

listPosts (filter), getPostAttention.

— `contracts/openapi.yaml, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-05 — happy path

> **Given** an operator of "Acme Flowers" with the destination "Acme Flowers News"
> **When** they create a post, pick that destination, type the text and tick "send without sound"
> **Then** the draft is saved as they type, shows how the text will look in the chat and how many characters remain, and appears on the Posts page for every member with its destination and who last changed it
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

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

## Checklist

- [ ] PostsTable component; filter in the address
- [ ] tests per state

## Edge cases

| Case | Behaviour |
|---|---|
| filter with no match | EmptyFilterState |

## Definition of Done

- [ ] component tests per state pass
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
