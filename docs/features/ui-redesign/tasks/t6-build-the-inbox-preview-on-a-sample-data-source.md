---
id: T6
title: "Build the inbox preview on a swappable sample-data source"
layer: "ui"
deps: ["T3"]
blocks: ["T8"]
acs: ["AC-12", "AC-12b", "AC-13", "AC-14", "AC-17"]
files_hint: ["apps/web/src/features/inbox/", "apps/web/src/pages/InboxPage.tsx"]
owner: "Dmytro Hopko"
estimate: "L"
context_budget: "M"
status: "todo"
---

# T6 — Build the inbox preview on a swappable sample-data source

## Place in the sequence

- **Blocked by:** T3 — Render workspace screens inside one layout route with the sidebar frame · **Blocks:** T8 — Register the new components in the canon and remove the reference markup · **Wave:** 3 — after the route tree exists; parallel with T4 and T7.
- **Lane:** own lane (`features/inbox/`).

## Why (user story)

> **As an** Operator
> **I want** an inbox screen with a conversation list and a conversation thread, filled with labelled sample data
> **So that** I can see how I will answer customers before the real inbox arrives
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

This task builds the whole inbox preview — sample source, conversation list, thread, reply box — behind the source seam steps 4 will swap.

## Inlined context

> **Chosen:** Option 1. It keeps fixtures out of the API client (no invented contract that steps 4/7 would have to honour or undo, no risk of mixing with real responses), and gives each later step one seam to replace — the source's functions become API calls with the shared contracts those steps define.
>
> — `adr/0002, Decision outcome, verbatim` · full text: [adr/0002-serve-preview-screens-from-a-swappable-per-feature-sample-data-source.md](../adr/0002-serve-preview-screens-from-a-swappable-per-feature-sample-data-source.md)

> | Sample data | Per-feature read-only source + fixtures; every preview screen shows the sample-data badge; a sent preview reply lives only in InboxPreview component state (never a store), so leaving, switching workspace or reloading drops it; nothing persists, nothing is sent | ADR-0002 |
> | Safe rendering | User-typed text (preview replies, search boxes) is rendered as plain React text, never as HTML | spec §6.1 |
>
> — `sad.md §8, rows Sample data / Safe rendering, verbatim` · full text: [sad.md](../sad.md)

> default (desktop): title «Inbox» + SampleDataBadge; one full-height Card, two panes — list (search «Search conversations», rows: avatar, name, relative time, last-message preview, unread Badge) and «Pick a conversation to see it here». thread open: address `/w/<id>/inbox/<conversationId>`, header (avatar, name, `@username`), messages grouped by sender (customer left, operator right), reply area; unread cleared for this visit. validation: empty / spaces / > 4096 — send disabled, over the limit «Replies are limited to 4096 characters». success: Enter (Shift+Enter = new line) or Send — operator bubble appended, list entry shows it as last message «now» and moves to top; note «Preview — nothing is sent to customers» always under the box. reset: another conversation / leave / switch / reload drops sent replies. empty: search → «No conversations match» + Clear search. phone: list fills the body; thread replaces it with «Back to conversations». not found: unknown id → frame NotFoundCard. loading / error: N/A. Sample data: ~12 conversations, invented names and `@usernames`, unread 0–3, times «now»…«13 days», 3–12 text messages each.
>
> — `screens.md §SCR-08, abridged` · full text: [screens.md](../screens.md)

> | ConversationList | Avatar + name + relative time + preview + unread badge rows with selection; no shadcn primitive for a chat list | pending |
> | MessageBubble | Chat bubble aligned by sender with time; the canon names it a `NEW:` candidate (no shadcn primitive) | pending |
> | ReplyComposer | Textarea + send button + Enter/Shift+Enter + 4096 limit + preview note; composed once, reused by step 4 | pending |
>
> — `screens.md §New components, three rows, verbatim` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) · [ux-flows.md](../ux-flows.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface. The preview never calls the API client (AC-17).

## Acceptance criteria

### AC-12 — happy path

> **Given** an Operator on the inbox preview
> **When** they look at the conversation list and pick a conversation
> **Then** the list shows each sample conversation with an avatar, the contact's name, a relative time, the last message and an unread count, the chosen conversation opens as a thread (contact header, messages grouped by sender, a reply box), and a visible "Sample data" label in the page title row says these are not real conversations; opening a conversation clears its unread count for this visit, and the chosen conversation can be reopened by reload, the browser's back button or a saved link — a link to a sample conversation that does not exist shows the not-found card inside the frame
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-12b — happy path

> **Given** an Operator on the inbox preview on a phone-width screen
> **When** they pick a conversation and then go back
> **Then** the list fills the screen, picking a conversation replaces the list with its thread, and a back control in the thread header returns to the list
>
> — `spec.md §5, AC-12b, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — error

> **Given** an Operator in a sample conversation thread
> **When** they try to send with an empty reply box, one holding only spaces, or one longer than 4096 characters
> **Then** nothing is added to the thread and sending stays unavailable — for an over-long reply the box says replies are limited to 4096 characters; Enter sends a valid reply and Shift+Enter starts a new line
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — domain invariant

> **Given** an Operator in a sample conversation thread
> **When** they type a reply and send it
> **Then** the reply appears at the end of the thread, and that conversation's list entry shows it as the last message and moves to the top; a note always visible in the reply area says that preview screens send nothing to customers; the reply is gone once they pick another conversation, leave the inbox, switch workspace or reload, and it never appears in any other workspace's preview — a preview screen never saves anything and never writes to any end customer
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — cross-context

> **Given** "Acme Flowers" whose business bot has already captured real contacts and conversations
> **When** an Operator of "Acme Flowers" opens the inbox, contacts or contact profile preview
> **Then** they see only the labelled sample data — the same in every workspace — and never a real contact or conversation of "Acme Flowers" or of any other workspace mixed into it
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `features/inbox/sample-data.ts` (fixtures) + `features/inbox/sample-source.ts` — `listSampleConversations()`, `getSampleConversation(id)`; identical for every workspace; unit-tested
- [ ] `features/inbox/ConversationList.tsx`, `MessageBubble.tsx`, `ReplyComposer.tsx` (pure reply-validity rule: trimmed non-empty and ≤ 4096; unit-tested)
- [ ] `features/inbox/InboxPreview.tsx` — reads the source only; selection from `:conversationId`; unknown id → not found; unread cleared on open; sent replies in component state, reset on conversation change; list reorders with the sent reply
- [ ] Phone width (< md): list or thread, with «Back to conversations»
- [ ] `pages/InboxPage.tsx` renders InboxPreview with title + SampleDataBadge
- [ ] Component tests: AC-12, AC-12b, AC-13, AC-14, AC-17 (no API client call while rendering)

## Edge cases

| Case | Behaviour |
|---|---|
| reply of only spaces or > 4096 characters | nothing added; send unavailable; limit message over 4096 |
| user types HTML/markup in a reply | shown as plain text |
| unknown conversation id in the address | frame NotFoundCard |
| switching workspace after sending | sent reply gone; nothing appears in the other workspace's preview |

## Definition of Done

- [ ] unit tests for the sample source and the reply-validity rule pass
- [ ] component tests for AC-12, AC-12b, AC-13, AC-14, AC-17 pass
- [ ] no component outside `sample-source.ts` imports the fixtures
- [ ] every Hard Rule inlined above still holds
- [ ] lint + typecheck clean (`pnpm lint`)
