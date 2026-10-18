---
id: T25
title: "Build SCR-02's reading side: thread header, paged history, mark read when visible, live items, edits, late redeliveries and phone layout"
layer: "ui"
deps: ["T23"]
blocks: ["T26", "T27"]
acs: ["AC-03", "AC-15"]
files_hint: ["apps/web/src/features/inbox/Thread.tsx", "apps/web/src/features/inbox/Thread.test.tsx", "apps/web/src/features/inbox/MessageBubble.tsx", "apps/web/src/pages/InboxPage.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T25 — Build SCR-02's reading side: thread header, paged history, mark read when visible, live items, edits, late redeliveries and phone layout

## Place in the sequence

- **Blocked by:** T23 — Replace the inbox sample source with the API source, a workspace-keyed store and the realtime client · **Blocks:** T26 — Build MessageContent for every message kind with media fetched through the API client, and SCR-03, the media viewer, T27 — Build the real reply composer and SCR-04: client key and drafts, sending lock, validation, rate limit, bot-unavailable states and the teammate confirmation · **Wave:** 3 — after T23.
- **Lane:** shares `pages/InboxPage.tsx` with T24 and `MessageBubble.tsx` with T26, T28 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to open a conversation and read everything the customer sent and everything the team replied, including the customer's photos, voice notes and files
> **So that** I answer with the full context, without asking the customer to repeat themselves
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** new customer messages and my teammates' replies to appear live, and to be warned before I answer a customer a teammate has just answered
> **So that** our team does not miss messages or give a customer two different answers
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It shows a conversation's whole history in order, marks it read only for the member looking at it, and keeps up live.

## Inlined context

> | default | `/w/<id>/inbox/<conversationId>` — right pane: header (`Avatar`, contact full name, `@username` when present); the latest page of the history oldest-first, customer messages left, team replies right, each with its time; customer message = `MessageBubble` inbound with its content by kind; reply = `MessageBubble` outbound with the author's display name above the text and its delivery state under it; the composer at the bottom. Opening it in a visible tab marks read through the page's `read_through_at` for this member only (AC-03; flow 5) |
>
> — `screens.md §SCR-02, default, verbatim` · full text: [screens.md](../screens.md)

> States built here: loading (header skeleton + 4 bubble skeletons; composer disabled) · loading older (skeleton above; scroll position kept) · start of history · error: older history («Couldn't load earlier messages» + **Retry**) · error («Something went wrong» + **Retry**; list stays usable) · not found (→ SCR-06 `NotFoundCard`) · background tab (nothing marked read; on visible, mark through the newest arrival shown) · live: customer message (placed by `sent_at`; view follows only if already at the bottom) · live: late redelivery (inserted at its place) · live: edited («edited» next to its time; unread unchanged) · live: teammate reply · phone: thread (**Back to conversations**; browser back does the same).
>
> — `screens.md §SCR-02, state table, abridged` · full text: [screens.md](../screens.md)

> Components: extended: MessageBubble (author name, «edited» mark, content slot, delivery-state slot), Avatar, ScrollArea, Skeleton, Alert (destructive), Button (`ghost`), NotFoundCard.
>
> — `screens.md §SCR-02 + §New components, abridged` · full text: [screens.md](../screens.md)

> Customer text, captions, names, file names, poll and venue text and reply texts are rendered as plain text (React escaping, no HTML rendering, links only as plain-text map links built by us from coordinates); replies go to Telegram without `parse_mode`; media served with an allow-listed content type, `nosniff`, a sandboxing CSP and `attachment` for documents
>
> — `sad.md §8, Untrusted content, verbatim` · full text: [sad.md](../sad.md)

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

Reads `getConversation`, `listThreadItems` (latest, `before`, `after`), `getThreadMessage`, `getThreadReply`; writes `markConversationRead { read_through_at }` (page's `read_through_at` on open, a live message's `received_at`) only while `document.visibilityState === 'visible'`. — `contracts/openapi.yaml, the thread operations, abridged`

## Acceptance criteria

### AC-03 — happy path

> **Given** an operator of "Acme Flowers" and a conversation with 600 messages and replies
> **When** they open it
> **Then** the thread shows the latest part of the history with the contact's name in its header, the customer's messages and the team's replies in the order they happened, each reply marked with the name of the member who wrote it; scrolling up loads older history until the first message; opening the conversation marks every message that has arrived in tg-inbox so far as read for this operator only — teammates' unread counts do not change (unread is counted by arrival in tg-inbox, not by place in the history); the conversation can be reopened by reload, the browser's back button or a saved link, and a link to a conversation that does not exist shows the not-found card; on a phone-width screen the list fills the screen, picking a conversation replaces it with the thread, and a back control returns to the list
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** two operators of "Acme Flowers" with the inbox open, one of them inside a conversation
> **When** the customer of that conversation sends a message or edits one, a new customer writes for the first time, or the other operator sends a reply
> **Then** within the live-update target of §6 and without reloading, the list and the open thread show it: the new conversation appears at the top, the edited message shows its new text marked as edited, the teammate's reply shows with their name and delivery state; a message that arrives in a thread open in a visible browser tab counts as read for the operator looking at it (a tab in the background does not mark anything read), an edit does not make a message unread again, and a customer message that arrived late and took its earlier place in the history (a late redelivery) counts as unread, by its arrival, for every member who has not looked at the conversation since — it is never hidden behind messages already read
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Thread pane: header, latest page, scroll-up paging by `prev_cursor` keeping the anchor, start-of-history, errors + retry, not-found card — `features/inbox/Thread.tsx`
- [ ] Mark read on open and on live messages only when visible; on `visibilitychange` to visible mark through the newest arrival shown — `features/inbox/Thread.tsx`
- [ ] Place live items by position (late redelivery in place), follow only when at the bottom; edited mark — `features/inbox/Thread.tsx`, `MessageBubble.tsx`
- [ ] Extend `MessageBubble` with author name, «edited», a content slot (plain text for now; T26 fills kinds) and a delivery-state slot (T28 fills it) — `features/inbox/MessageBubble.tsx`
- [ ] Route `/w/:workspaceId/inbox/:conversationId?` renders the thread; phone layout with **Back to conversations** — `pages/InboxPage.tsx`
- [ ] Testing Library tests for every state above incl. background tab — `features/inbox/Thread.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| Tab hidden when a message arrives | shown, not marked read; marked when the tab becomes visible |
| Late redelivery older than the oldest loaded item | not inserted until that page is loaded |
| Saved link to a foreign conversation | SCR-06 not-found card, no hint |
| Reload / back / saved link | same conversation reopens |

## Definition of Done

- [ ] Testing Library tests cover every SCR-02 reading state listed above, incl. mark-read only when visible and late-redelivery placement
- [ ] web lint + typecheck clean
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
