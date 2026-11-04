---
id: T24
title: "Update CLAUDE.md, the architecture map and the design-system canon for the posts module"
layer: "docs"
deps: ["T15", "T18", "T19", "T21", "T22"]
blocks: []
acs: ["AC-17"]
files_hint: ["CLAUDE.md", "docs/architecture-map.md", "docs/design-system.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
status: "done"
step: "COMMIT"
---

# T24 — Update CLAUDE.md, the architecture map and the design-system canon for the posts module

## Place in the sequence

- **Blocked by:** T15 — Register the posts routes (registerPosts): the 18 operations, T18 — Build SCR-33 Channels & groups with SCR-34 connect-code, SCR, T19 — Build SCR-36 the Posts list with state filters, workspace-zo, T21 — Build SCR-38 publish-now and SCR-39 schedule dialogs on thei, T22 — Build SCR-40 the post page for every non-draft state, with S · **Blocks:** — · **Wave:** 9 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** replies to customers to go out and customer messages to arrive as fast as ever, whatever is being posted or written in the business's groups
> **So that** posting never makes support slower
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

This task delivers: update CLAUDE.md, the architecture map and the design-system canon for the posts module.

## Inlined context

> When they disagree, the map wins — fix this file.
>
> — `CLAUDE.md header, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> NEW components: DestinationsCard, TimeZoneField, ConnectCodeDialog, PostsTable, PostEditor, PublishDialog, ScheduleDialog, PostPage, PostCrumb
>
> — `screens.md §New components, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-17 — cross-context

> **Given** a destination group where customers chat busily and a broadcast and replies are being sent
> **When** posts go out and people write in the group
> **Then** nothing written in a destination is captured — no contact, conversation, unread or ping is created; customer messages to the bot and replies keep their usual speed; a limit Telegram applies to one chat delays only posts to that chat, while posts still wait for the bot's send pause
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] CLAUDE.md: posts module line, Posts rule block, queues, deps order
- [ ] architecture-map: module row, deps, reflects_commit
- [ ] design-system: register new components

## Edge cases

| Case | Behaviour |
|---|---|
| CLAUDE.md vs map | map wins |

## Definition of Done

- [ ] docs updated; links resolve
- [ ] lint clean
- [ ] every Hard Rule inlined above still holds
