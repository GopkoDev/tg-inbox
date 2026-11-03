---
id: T17
title: "Add the web posts API source, stores (posts, destinations, attention), time helpers, routes and the Posts nav item with its count"
layer: "ui"
deps: ["T2", "T1"]
blocks: ["T18", "T19", "T20"]
acs: ["AC-12", "AC-13"]
files_hint: ["apps/web/src/features/posts/", "apps/web/src/app/routes.tsx", "apps/web/src/shared/ui/app-shell.tsx", "apps/web/src/features/settings/SettingsLayout.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "S"
status: "todo"
step: ""
---

# T17 — Add the web posts API source, stores (posts, destinations, attention), time helpers, routes and the Posts nav item with its count

## Place in the sequence

- **Blocked by:** T2 — Add the posts zod contracts, the 17 new error codes, and the, T1 — Add the shared workspace time-zone rule: IANA validity, loca · **Blocks:** T18 — Build SCR-33 Channels & groups with SCR-34 connect-code, SCR, T19 — Build SCR-36 the Posts list with state filters, workspace-zo, T20 — Build SCR-37 the post editor with autosave, destination pick · **Wave:** 2 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** to see each post's state live — draft, scheduled, published (and open it in Telegram), failed or missed with a plain reason
> **So that** the team notices at once when a post did not go out and can act
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

This task delivers: add the web posts API source, stores (posts, destinations, attention), time helpers, routes and the Posts nav item with its count.

## Inlined context

> Addresses: `/w/<id>/posts` (SCR-36, `?filter=` in the address), `/w/<id>/posts/new` …, `/w/<id>/posts/<postId>` (SCR-37 while `state: draft`, SCR-40 otherwise), `/w/<id>/posts/<postId>/publish` (SCR-38) and `/schedule` (SCR-39) … `/w/<id>/settings/channels` (SCR-33). Navigation: a Posts item (lucide `Send`) between Broadcasts and Settings for both roles, with a `SidebarMenuBadge` … «N posts need attention». Settings gains Channels & groups for both roles
>
> — `screens.md §Decisions 1–2, abridged` · full text: [screens.md](../screens.md)

> SCR-15 attention: `getPostAttention.count > 0`, re-read on `post.changed`; loading → no badge; error → last count stays
>
> — `screens.md SCR-15, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Client for every posts operation, responses parsed with the T2 schemas (`apps/web/src/shared/api/client.ts`).

— `contracts/openapi.yaml, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

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

- [ ] `features/posts/api.ts`, `posts-store.ts`, `destinations-store.ts`, `attention-store.ts` (live via `subscribeLive`)
- [ ] `features/posts/time.ts` over T1
- [ ] routes + lazy pages placeholders; nav item + badge; Settings section
- [ ] store tests

## Edge cases

| Case | Behaviour |
|---|---|
| live frame for another workspace | ignored |
| count read fails | last count kept |

## Definition of Done

- [ ] store tests pass; nav shows the badge in a Testing Library test
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
