---
id: T21
title: "Build ContactConversationHistory, the profile's read-only thread: inbox-order items, older pages, media, live items, no read marking and no composer, with ReplyDeliveryState readOnly"
layer: "ui"
deps: ["T20"]
blocks: ["T25", "T26"]
acs: ["AC-04", "AC-05"]
files_hint: ["apps/web/src/features/contacts/ContactConversationHistory.tsx", "apps/web/src/features/contacts/ContactConversationHistory.test.tsx", "apps/web/src/features/inbox/ReplyDeliveryState.tsx", "apps/web/src/features/inbox/ReplyDeliveryState.test.tsx", "apps/web/src/features/contacts/ContactProfile.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T21 — Build ContactConversationHistory, the profile's read-only thread: inbox-order items, older pages, media, live items, no read marking and no composer, with ReplyDeliveryState readOnly

## Place in the sequence

- **Blocked by:** T20 — Build SCR-19, the contact profile: the header card with facts and tags, the conversation card, the Conversation / Tag history tabs with TagHistoryList and ContactCrumb, and remove the contacts sample source and SampleDataBadge · **Blocks:** T25 — Add browser end-to-end contacts flows against the real API: list and filter, profile reading without marking read, tagging live between two members, owner rename / merge / delete, the operator refusal, T26 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the contacts routes and tables, the contacts → workspaces edge, the new signals and the new components · **Wave:** 6 — after T20.
- **Lane:** Shares `apps/web/src/features/contacts/ContactProfile.tsx` with T20; shares `apps/web/src/features/contacts/ContactProfile.tsx` with T22 — serialized.

## Why (user story)

> **As an** Operator
> **I want** a contact's profile with what Telegram tells us, their tags, where their conversation stands and its history
> **So that** I understand the customer before I answer and can jump into the conversation
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It lets a member read the whole conversation on the profile without anything counting as read.

## Inlined context

> 6. **The profile's history is the inbox thread's rendering without its two writing parts**: no read marking while visible and no composer (ADR-0006). It reuses `MessageBubble`, `MessageContent`, `ActivityLine` and `MediaViewer` as they are; a reply's delivery line shows its state with **no** «Try again» / «Send again» buttons (extended: ReplyDeliveryState `readOnly`), because the profile does not act on the conversation.
>
> — `screens.md §Decisions, 6, verbatim` · full text: [screens.md](../screens.md)

> - The profile shows the conversation's thread read-only and never marks anything read; answering happens in the inbox, one click away.
>
> — `spec.md §1, Assumptions, read-only history, verbatim` · full text: [spec.md](../spec.md)

> | `conversation.changed` (any change) for the profile's conversation | contact profile (SCR-19) | `getContactConversation` (status, assignee, waiting marker), the new thread items through `listThreadItems`, and `getContact` (a captured new Telegram name). **Never** `markConversationRead` (ADR-0006) | AC-04, AC-05, AC-13 |
>
> — `contracts/events.md §Existing frames, new consumers, verbatim` · full text: [events.md](../contracts/events.md)

> | conversation tab | … |
> | conversation: loading older | … |
> | conversation: older failed | … |
> | conversation: media | … |
> | conversation: empty | … |
> | conversation: error | … |
> | live: conversation changed | … nothing is marked read … |
>
> — `screens.md §SCR-19, conversation states, abridged` · full text: [screens.md](../screens.md)

> **Chosen:** Option 1. The read side already has the required property; adding a route or a flag adds surface without adding safety. The property is pinned by tests so a future change that makes the thread read mark read breaks the build.
>
> — `adr/0006-read-the-profile-conversation-through-the-existing-inbox-reads-that-never-mark-read.md §Decision outcome, ADR-0006, verbatim` · full text: [ADR-0006](../adr/0006-read-the-profile-conversation-through-the-existing-inbox-reads-that-never-mark-read.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- The unchanged `listThreadItems` (`…/inbox/conversations/{conversationId}/items`, `before`) and the media route. **Never** `markConversationRead`.

— `contracts/openapi.yaml, operationId getContactConversation (description), abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-04 — happy path

> **Given** a contact of "Acme Flowers" whose conversation is open, assigned to a teammate and waiting for a reply
> **When** an operator opens the contact's profile (from the list, from the contact's name in the inbox conversation header, or by a saved link)
> **Then** the profile shows the contact's name, username, language, when they first wrote and when they last wrote, their tags with who added each one and when, the contact's tag history (each tag added, removed, merged or removed by a delete, by whom and when, under the name the tag had then, newest first, older entries loaded on scrolling), and their conversation: its status, its assignee (or "unassigned"), the "waiting for a reply" marker when it applies, and a way to open it in the inbox; a history section shows the conversation's messages, the team's replies with their authors and its activity entries in the same order as in the inbox, latest first part loaded and older ones on scrolling, with media opened through the panel as in the inbox; the profile can be reopened by reload, the back button or a saved link, and a link to a contact that does not exist shows the not-found card inside the frame
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — cross-context

> **Given** a conversation of "Acme Flowers" holding customer messages the operator has not read
> **When** the operator reads its history on the contact's profile, including while new customer messages arrive
> **Then** nothing counts as read for the operator: the conversation's unread count, the operator's attention count and the pings they would get stay exactly as if the profile had not been opened, and the profile has no reply box; only opening the conversation in the inbox marks it read, as before; new messages, replies and activity entries appear in the open history without reloading, and the conversation's status, assignee and "waiting for a reply" marker at the top of the profile change with them
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `ContactConversationHistory` (ScrollArea, MessageBubble, MessageContent, ActivityLine, ReplyDeliveryState, MediaViewer, Skeleton, Alert, Button): items in inbox order, «Start of the conversation», older pages by `before`, media through `MediaViewer`, new items from `conversation.changed`, no read-marking effect, no composer — `apps/web/src/features/contacts/ContactConversationHistory.tsx` (+ test)
- [ ] `ReplyDeliveryState` gains `readOnly` (state text without «Try again» / «Send again») — `apps/web/src/features/inbox/ReplyDeliveryState.tsx` (+ test)
- [ ] Mount it in the Conversation tab — `apps/web/src/features/contacts/ContactProfile.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| history visible while new customer messages arrive | they append; no mark-read request is made (AC-05) |
| a failed reply in the history | its state shows, with no resend buttons |
| a photo | opens in `MediaViewer`; closing returns focus to the profile |
| no items | «No messages to show» |

## Definition of Done

- [ ] Testing Library tests cover every Conversation-tab state of SCR-19 in screens.md (history in inbox order, loading older, older failed, media, empty, error, live conversation changed) and prove the component issues no mark-read request and renders no composer, while ReplyDeliveryState readOnly hides Try again / Send again.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
