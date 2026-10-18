---
id: T22
title: "Update CLAUDE.md, the architecture map and the design-system canon for the inbox module, platform/realtime, the delivery queue and the new components"
layer: "docs"
deps: ["T18", "T20", "T26", "T27", "T28"]
blocks: []
acs: ["AC-13", "AC-15"]
files_hint: ["CLAUDE.md", "docs/architecture-map.md", "docs/design-system.md", "CONTEXT.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T22 — Update CLAUDE.md, the architecture map and the design-system canon for the inbox module, platform/realtime, the delivery queue and the new components

## Place in the sequence

- **Blocked by:** T18 — Build the inbox.deliver-replies drain worker with pre-checks, pacing, outcome handling, back-off jobs and the dead-letter handler, T20 — Add the live socket endpoint and hub: guarded upgrade with origin check, per-workspace dispatch, deactivation close, 5 s re-validation, ping and resync, T26 — Build MessageContent for every message kind with media fetched through the API client, and SCR-03, the media viewer, T27 — Build the real reply composer and SCR-04: client key and drafts, sending lock, validation, rate limit, bot-unavailable states and the teammate confirmation, T28 — Build ReplyDeliveryState with Try again and Send again, and SCR-05, the duplicate-risk confirmation · **Blocks:** — · **Wave:** 8 — after T18, T20, T26, T27, T28.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** new customer messages and my teammates' replies to appear live, and to be warned before I answer a customer a teammate has just answered
> **So that** our team does not miss messages or give a customer two different answers
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** the inbox to tell the whole team when the bot is not working or not receiving messages, and to point me to the bot settings
> **So that** nobody writes replies that cannot be delivered and I fix the connection quickly
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

It keeps the binding project docs true once the inbox exists, so the next feature builds on what is really there.

## Inlined context

> | `CLAUDE.md`, the architecture map and the module list do not yet show the `inbox` module, `platform/realtime`, the new dependency line and the delivery queue | Low | Update both in this feature's tasks | Tech Lead |
>
> — `sad.md §11, Risks, verbatim` · full text: [sad.md](../sad.md)

> The decided architecture lives in `docs/architecture-map.md` (+ ADRs in `docs/adr/`); this file is the short version. When they disagree, the map wins — fix this file.
>
> — `CLAUDE.md, preamble, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> | MessageContent | […] | pending |
> | ReplyDeliveryState | […] | pending |
> | ConversationList (extended) | […] its canon row is updated, not duplicated | pending |
> | MessageBubble (extended) | […] canon row updated | pending |
> | ReplyComposer (extended) | […] canon row updated | pending |
> | EmptyFilterState (extended) | […] canon row updated | pending |
>
> — `screens.md §New components, abridged` · full text: [screens.md](../screens.md)

> Terms marked † are not yet in [CONTEXT.md](../../../CONTEXT.md) — candidates for `/sdd:glossary`.
>
> — `sad.md §12, Glossary, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-13 — cross-context

> **Given** the bot of "Acme Flowers" is not connected, or is in the state "not working — needs a new token"
> **When** an operator or business owner opens the inbox or a conversation
> **Then** every conversation stays readable, the reply box is unavailable and explains that replies cannot be sent until the bot works again — a business owner gets the way to the bot settings, an operator is told to ask a business owner; a reply still "sending" when the bot stops working ends up "not delivered — the bot is not working"; once a business owner fixes the bot — the same bot, since a workspace keeps one business bot once customers have written to it (bot-connection AC-05) — replying works again without reloading
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** two operators of "Acme Flowers" with the inbox open, one of them inside a conversation
> **When** the customer of that conversation sends a message or edits one, a new customer writes for the first time, or the other operator sends a reply
> **Then** within the live-update target of §6 and without reloading, the list and the open thread show it: the new conversation appears at the top, the edited message shows its new text marked as edited, the teammate's reply shows with their name and delivery state; a message that arrives in a thread open in a visible browser tab counts as read for the operator looking at it (a tab in the background does not mark anything read), an edit does not make a message unread again, and a customer message that arrived late and took its earlier place in the history (a late redelivery) counts as unread, by its arrival, for every member who has not looked at the conversation since — it is never hidden behind messages already read
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `CLAUDE.md`: layout lists `inbox` (routes, hub, `inbox.deliver-replies` worker) and `platform/realtime`; dependency line `inbox → {conversations, contacts, bots, workspaces}`; `conversations` now has routes via `inbox`; queue names; no new tenancy exception — `CLAUDE.md`
- [ ] Architecture map: module table, C4 rows, realtime listener connection, socket deployment notes (ping 25 s, `Upgrade`), the reserved `shared/api/realtime.ts` now built — `docs/architecture-map.md`
- [ ] Design-system canon: add `MessageContent`, `ReplyDeliveryState`; update the rows of `ConversationList`, `MessageBubble`, `ReplyComposer`, `EmptyFilterState`; mark `SampleDataBadge` unused by the inbox — `docs/design-system.md`
- [ ] Add the † terms of SAD §12 (delivery state, not confirmed, waiting for a reply, unread, arrival watermark, client reply key, change signal, drain, position time) — `CONTEXT.md`

## Edge cases

| Case | Behaviour |
|---|---|
| Map and CLAUDE.md disagree after the edit | the map wins; CLAUDE.md is corrected |

## Definition of Done

- [ ] CLAUDE.md and the architecture map name the inbox module, platform/realtime, the queue and the dependency line exactly as built
- [ ] every new/extended component of `screens.md` has its canon row (status no longer pending)
- [ ] CONTEXT.md carries the nine glossary terms
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
