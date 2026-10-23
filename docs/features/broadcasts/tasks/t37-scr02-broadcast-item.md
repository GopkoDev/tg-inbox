---
id: T37
title: "Render the broadcast item in the inbox thread (SCR-02): BroadcastItem as a new ThreadItemView kind with the name linking to the broadcast, the launching owner, the text and the delivered or not-confirmed time, inserted live without touching read state or attention"
layer: "ui"
deps: ["T4"]
blocks: ["T39", "T40"]
acs: ["AC-16"]
files_hint: ["apps/web/src/features/inbox/BroadcastItem.tsx", "apps/web/src/features/inbox/BroadcastItem.test.tsx", "apps/web/src/features/inbox/ThreadItemView.tsx", "apps/web/src/features/inbox/Thread.test.tsx", "apps/web/src/features/inbox/store.ts", "apps/web/src/features/inbox/api-source.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
step: ""
---

# T37 — Render the broadcast item in the inbox thread (SCR-02): BroadcastItem as a new ThreadItemView kind with the name linking to the broadcast, the launching owner, the text and the delivered or not-confirmed time, inserted live without touching read state or attention

## Place in the sequence

- **Blocked by:** T4 — Add the broadcasts zod contracts, the eleven BROADCAST_* error codes, the broadcast.changed frame and signal, the widened contact.changed (reach) and conversation.changed (broadcast) frames with their hub mapping, and keep the web stores ignoring what they do not handle yet · **Blocks:** T39 — Add browser end-to-end broadcasts flows against the real API: draft a tag audience, build a group, launch and follow the live report, stop, duplicate "did not reach", the broadcast item in the thread, the blocked marker, and the operator's missing launch, T40 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the broadcasts module, its routes, tables, queues and signals, the new edges, contact_bot_reach and broadcast_items, and the new components · **Wave:** 3 — after T4.
- **Lane:** shares `apps/web/src/features/inbox/store.ts` with T4 — serialized.

## Why (user story)

> **As an** Operator
> **I want** my replies to go out without waiting behind a broadcast, and to see the broadcast in a customer's conversation when they answer it
> **So that** support works as usual and I understand what the customer is answering
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

It shows the operator, inside the customer's conversation, the broadcast the customer is answering — as an item of its own that never reads as a reply and never changes the conversation's state.

## Inlined context

> | broadcast item: delivered | a `ThreadBroadcastItem` with `state: delivered` in `listThreadItems` — the centred block «📣 Broadcast **Spring prices** · sent by Test User», the text (plain, line breaks kept), the delivered time; the name links to SCR-28 |
> | broadcast item: not confirmed | `state: not_confirmed` — the same block with a `Badge` «Not confirmed» and «sent at 09:00 — Telegram did not answer» |
> | launcher deactivated | `launched_by` is a deactivated member — still named |
> | live | `conversation.changed { item.type: broadcast, change: created }` for the open conversation — `getThreadBroadcastItem`, inserted at its position; the header's status, assignee, waiting marker, the unread state and the frame's attention count do **not** change |
> | customer answers | inherited: the answer is a customer message (reopens, unread, waiting, ping as usual) |
> | loading / error / empty | inherited verbatim (Thread) |
>
> — `screens.md §SCR-02, added states (Source-ref column dropped), abridged` · full text: [screens.md](../screens.md)

> 12. **The broadcast item** in a thread (NEW: BroadcastItem, a new `ThreadItemView` kind) is a full-width, centred card-like block — not a bubble on either side — so it never reads as a team reply or a customer message: a `Megaphone` icon, «Broadcast «Spring prices» · sent by Test User», the text, and the time (or a «Not confirmed» `Badge` with the send time). The broadcast name is a link to SCR-28.
>
> — `screens.md §Source, Decision 12, verbatim` · full text: [screens.md](../screens.md)

> - **Panel reaction** (flow 18): a tab with that conversation open re-reads `getThreadBroadcastItem` and shows the item; the inbox list (`features/inbox`) and the attention store (`features/attention/store.ts`) **ignore** a frame whose `item.type` is `broadcast` — no list refetch, no attention refetch (ADR-0010). Never `markConversationRead`.
>
> — `contracts/events.md §Frame: conversation.changed, panel reaction, verbatim` · full text: [events.md](../contracts/events.md)

> **Chosen:** Option 1. The thread stays one ordered query in its owner. The item is written in the same transaction as the recipient's outcome, so the report and the thread never disagree. It has its own kind, so no existing rule about messages or replies (unread, waiting, reopen, pings) sees it.
>
> — `adr/0010-store-broadcast-items-as-a-conversations-thread-entry-that-never-touches-conversation-state.md §Decision outcome, ADR-0010, verbatim` · full text: [ADR-0010](../adr/0010-store-broadcast-items-as-a-conversations-thread-entry-that-never-touches-conversation-state.md)

> | BroadcastItem | SCR-02's broadcast entry: a centred, full-width block that is neither bubble side, with name link, launching owner, text and delivered / not-confirmed time; like `ActivityLine`, fixed copy no primitive provides; composes Badge, Button (link) | pending |
> | ThreadItemView (extended) | Existing component; gains the kind `broadcast` rendering BroadcastItem — canon row updated | pending |
>
> — `screens.md §New components, BroadcastItem + ThreadItemView, verbatim` · full text: [screens.md](../screens.md)

**Reuse:** `ThreadItemView` (extended) and the `activity` twin in `features/inbox/store.ts` (`getThreadActivity` → here `getThreadBroadcastItem`), `ActivityLine` as the layout precedent, `Badge` and `Button` (link) from `apps/web/src/shared/ui`, `relativeTime` / the thread time helper. T4 already makes the inbox list and the attention store ignore broadcast frames; this task adds the open-thread re-read. Because `ThreadItemView` is shared with the profile's read-only history (`ContactConversationHistory`), the item renders there too, with the same no-mark-read rule. NEW: `BroadcastItem` only.

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `GET …/inbox/conversations/{conversationId}/items` → `ThreadPage` items now include `ThreadBroadcastItem { type: broadcast, id, conversation_id, broadcast_id, broadcast_name, text, launched_by: MemberRef, state: delivered | not_confirmed, position_at }`.
- `GET …/inbox/conversations/{conversationId}/broadcast-items/{broadcastItemId}` → `200 ThreadBroadcastItem` · errors: `404 NOT_FOUND` (foreign or unknown id, no hint), guard `401` / `403`. Never marks anything read.

— `contracts/openapi.yaml, operationId listThreadItems + getThreadBroadcastItem, schema ThreadBroadcastItem, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-16 — cross-context

> **Given** "Olena K.", whose conversation is closed, unassigned and not waiting for a reply, received the broadcast "Spring prices"
> **When** an operator opens her conversation in the inbox, and then she answers the broadcast in Telegram
> **Then** the thread shows the broadcast at the time it was delivered as a broadcast item — its text, its name and the business owner who launched it (still named if that owner was deactivated since) — distinct from the team's replies; a recipient whose send ended "not confirmed" also gets the item, marked "not confirmed" and placed at the time the send was made; receiving it did not reopen the conversation, did not change its assignee, its "waiting for a reply" marker, any unread or attention count, and triggered no ping; her answer is captured as a customer message as before: it reopens the conversation and counts for unread, "waiting for a reply" and pings like any message; a recipient whose broadcast failed for any other reason, was stopped before their turn, or who was left out gets no broadcast item
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `BroadcastItem`: centred full-width block, `Megaphone` icon, «Broadcast «name» · sent by <launched_by>» with the name as a link to `/w/:workspaceId/broadcasts/:broadcastId`, the text as plain text (`whitespace-pre-wrap`), the time, or the «Not confirmed» `Badge` with «sent at … — Telegram did not answer» — `apps/web/src/features/inbox/BroadcastItem.tsx`
- [ ] `ThreadItemView` renders kind `broadcast` with `BroadcastItem` — `apps/web/src/features/inbox/ThreadItemView.tsx`
- [ ] API source `getThreadBroadcastItem`; the inbox store, on `conversation.changed { item.type: broadcast, change: created }` for the open conversation only, fetches it and merges it at its `(position_at, kind, id)` place; no mark-read, no list or attention refetch — `apps/web/src/features/inbox/api-source.ts`, `apps/web/src/features/inbox/store.ts`
- [ ] Testing Library tests: delivered, not confirmed, deactivated launcher named, markup shown literally — `apps/web/src/features/inbox/BroadcastItem.test.tsx`
- [ ] Thread / store tests: the live frame inserts the item in place for the open conversation, a frame for another conversation fetches nothing, and the header state, unread and attention count stay — `apps/web/src/features/inbox/Thread.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| frame for a conversation not open in this tab | ignored: no fetch, no list refetch, no attention change (AC-16) |
| conversation closed, unassigned, not waiting | after the item arrives the header still shows closed / unassigned / not waiting; unread unchanged (AC-16) |
| launcher deactivated since | still named «sent by Test User» (AC-16) |
| `not_confirmed` item | marked «Not confirmed», placed at the send time (AC-16) |
| the customer then answers | the answer is an ordinary message: reopens, unread, waiting as before (AC-16) |
| `getThreadBroadcastItem` answers 404 | the item is not shown; nothing else changes |
| the text contains Markdown or HTML | rendered literally (spec §6.1) |

## Definition of Done

- [ ] Testing Library and store tests cover every SCR-02 broadcast-item state in screens.md: delivered and not confirmed, a deactivated launcher still named, the text as plain text with line breaks, the item fetched by getThreadBroadcastItem on conversation.changed broadcast for the open conversation only and inserted at its position, and no mark-read call, no list refetch and no attention change.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
