---
id: T23
title: "Replace the inbox sample source with the API source, a workspace-keyed store and the realtime client"
layer: "ui"
deps: ["T2"]
blocks: ["T24", "T25"]
acs: ["AC-09", "AC-15", "AC-18"]
files_hint: ["apps/web/src/features/inbox/api-source.ts", "apps/web/src/features/inbox/store.ts", "apps/web/src/features/inbox/store.test.ts", "apps/web/src/features/inbox/sample-source.ts", "apps/web/src/features/inbox/sample-data.ts", "apps/web/src/shared/api/realtime.ts", "apps/web/src/shared/api/realtime.test.ts", "apps/web/src/shared/api/client.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T23 — Replace the inbox sample source with the API source, a workspace-keyed store and the realtime client

## Place in the sequence

- **Blocked by:** T2 — Define the inbox zod contracts, the live-frame schemas and the six new error codes · **Blocks:** T24 — Build SCR-01, the conversation list, on real data: rows, search, empty states, the not-receiving notice and live updates, T25 — Build SCR-02's reading side: thread header, paged history, mark read when visible, live items, edits, late redeliveries and phone layout · **Wave:** 2 — after T2.
- **Lane:** shares `features/inbox/store.ts` with T24–T28 — this task goes first; owns `shared/api/realtime.ts`.

## Why (user story)

> **As an** Operator
> **I want** new customer messages and my teammates' replies to appear live, and to be warned before I answer a customer a teammate has just answered
> **So that** our team does not miss messages or give a customer two different answers
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** one list of all the workspace's conversations, newest activity first, showing what I have not read and what is waiting for a reply
> **So that** I know at a glance which customers need an answer
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

It gives every inbox screen one source of truth that never mixes workspaces and heals itself after any missed live signal.

## Inlined context

> State lives in a `features/inbox/store.ts` Zustand store **keyed by workspace id**: entering another workspace in a tab resets the store and closes that tab's live socket before anything renders, and any response or live event tagged with another workspace id is dropped, so no conversation of one workspace is ever drawn inside another (AC-09, AC-18). Live events arrive through one client in `shared/api/realtime.ts` (the place the architecture map reserved for it) and only trigger refetches through the typed API client.
>
> — `sad.md §4, UI architecture, verbatim` · full text: [sad.md](../sad.md)

> The preview's data seam (`features/inbox/sample-source.ts`, ui-redesign [ADR-0002](../ui-redesign/adr/0002-serve-preview-screens-from-a-swappable-per-feature-sample-data-source.md)) is replaced by an API source; the "Sample data" label and the "nothing is sent" note go.
>
> — `sad.md §4, UI architecture, abridged` · full text: [sad.md](../sad.md)

> Shared inbox states (SCR-01, SCR-02, SCR-03, SCR-04, SCR-05). Handled once — in the API client, the realtime client (`shared/api/realtime.ts`) and the workspace-keyed store — not per screen.
>
> — `screens.md §Screens, Shared inbox states, verbatim` · full text: [screens.md](../screens.md)

> | socket close `4403` | no reconnect; live updates stop, the screen stays as shown; the next request the member triggers (open, scroll, send, media) gets `403` → the row above | AC-09; flow 2; events.md close codes |
> | socket close `4401` | no reconnect; the next request gets `401` → sign-in | AC-08; events.md close codes |
> | socket close `1001`, network drop, `resync` frame | no visible state; reconnect with backoff, then re-read the first list page, the open thread's latest page and the bot status | AC-15; events.md `resync`, close codes; ADR-0003 |
> | a response or frame tagged with another `workspace_id` | dropped, nothing drawn | AC-09, AC-18; flow 4 |
> | workspace switched in this tab | the store resets and the socket closes **before** anything renders; SCR-01 starts in `loading` for the new workspace — the old workspace's rows are never shown, not even for a frame; other tabs are untouched | AC-09; flow 2 |
> | `bot.changed` frame | re-read `getInboxBotStatus`; the SCR-01 notice and the SCR-02 reply area switch without a reload | AC-13, AC-14; flow 8 |
>
> — `screens.md §Shared inbox states, abridged` · full text: [screens.md](../screens.md)

> | `created` | `message` | `getConversation` […]. If the thread is open, also `getThreadMessage`, then `markConversationRead` with its `received_at` when the tab is visible | AC-15, AC-01 |
> | `created` | `reply` | `getThreadReply` if the thread is open. The row is unchanged until the reply is "sent" | AC-15 |
> | `edited` | `message` | `getThreadMessage` if open. `getConversation` when it is the row's last item. The unread count is unchanged | AC-15 |
> | `state` | `reply` | `getThreadReply` if open, and `getConversation` […] | AC-06, AC-10…AC-13 |
> | `read` | — | `getConversation`. […] | AC-03 |
>
> — `contracts/events.md §Frame: conversation.changed, Panel reaction, abridged` · full text: [events.md](../contracts/events.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Calls every inbox read through the typed client, parsing with the T2 schemas: `listConversations`, `getConversation`, `listThreadItems`, `getThreadMessage`, `getThreadReply`, `markConversationRead`, `getInboxBotStatus` (automatic refetches and marking read send `X-Background-Request: 1`); opens `openLiveSocket` at `/api/workspaces/{workspaceId}/inbox/live` and parses `LiveFrame`s.

— `contracts/openapi.yaml + contracts/events.md, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-09 — authorization

> **Given** an operator of "Acme Flowers" with the inbox open
> **When** a business owner deactivates their membership, or the operator switches to another workspace in that browser tab
> **Then** within 5 seconds the open inbox stops receiving new messages and replies of "Acme Flowers", the next action leads to the access-removed notice (deactivation) or shows only the other workspace's conversations (switch), and no conversation of "Acme Flowers" is shown inside another workspace, not even for a moment; switching affects only that tab — another tab of the same account still showing "Acme Flowers" keeps working; after deactivation, the member's replies still waiting to be retried are not sent and end "not delivered — the author's access was removed"
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** two operators of "Acme Flowers" with the inbox open, one of them inside a conversation
> **When** the customer of that conversation sends a message or edits one, a new customer writes for the first time, or the other operator sends a reply
> **Then** within the live-update target of §6 and without reloading, the list and the open thread show it: the new conversation appears at the top, the edited message shows its new text marked as edited, the teammate's reply shows with their name and delivery state; a message that arrives in a thread open in a visible browser tab counts as read for the operator looking at it (a tab in the background does not mark anything read), an edit does not make a message unread again, and a customer message that arrived late and took its earlier place in the history (a late redelivery) counts as unread, by its arrival, for every member who has not looked at the conversation since — it is never hidden behind messages already read
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — cross-context

> **Given** one person writes to the bots of both "Acme Flowers" and "Bolt Bikes", and an account is a member of both workspaces
> **When** that account opens the inbox of each workspace in turn
> **Then** each inbox shows only its own workspace's conversation with that person — only the messages sent to its own bot and the replies sent by its own team — and a reply sent from one workspace goes only through that workspace's bot, to that person's conversation with it; each inbox holds at most one conversation per end customer
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `api-source.ts`: one function per read operation via `shared/api/client.ts`, background marker on automatic calls — `features/inbox/api-source.ts`
- [ ] `realtime.ts`: one socket per tab for the current workspace; reconnect with backoff on `1001`/drop; no reconnect on `4401`/`4403`; emits frames + `reconnected`; ignores unknown types — `shared/api/realtime.ts`
- [ ] `store.ts` keyed by workspace id: reset + close socket on workspace change before render; drop answers/frames for another workspace; frame → refetch per the reaction table; on (re)connect / `resync` re-read first list page, open thread latest page and bot status — `features/inbox/store.ts`
- [ ] Delete `sample-source.ts` and `sample-data.ts` (keep any type still used by the contacts preview where it lives) — `features/inbox/`
- [ ] Tests (fake socket + mocked client): workspace switch never renders old rows, foreign-tagged frame dropped, `resync` triggers the three re-reads, `4403` stops reconnecting — `features/inbox/store.test.ts`, `shared/api/realtime.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Late answer of workspace A arrives after switching to B | dropped |
| Two tabs, one switches | the other tab's socket and store untouched |
| Burst of 10 frames for one conversation | refetches coalesced per conversation |
| Socket closed `4403` | no reconnect; next request gets `403` → access-removed |

## Definition of Done

- [ ] store and realtime tests prove workspace isolation on switch, foreign-frame dropping, resync re-reads, reconnect rules per close code
- [ ] no import of `sample-source` remains in the inbox feature
- [ ] web lint + typecheck clean
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
