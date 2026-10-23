---
id: T25
title: "Enrich the inbox thread with broadcast items: listThreadItems returns broadcast entries with the broadcast name, text and launching owner from broadcasts.itemDetails, and getThreadBroadcastItem reads one"
layer: "ports"
deps: ["T13", "T17"]
blocks: ["T26"]
acs: ["AC-08", "AC-16"]
files_hint: ["apps/api/src/modules/inbox/app/reads.ts", "apps/api/src/modules/inbox/app/reads.test.ts", "apps/api/src/modules/inbox/app/ports.ts", "apps/api/src/modules/inbox/http/routes.ts", "apps/api/src/modules/inbox/http/routes.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T25 — Enrich the inbox thread with broadcast items: listThreadItems returns broadcast entries with the broadcast name, text and launching owner from broadcasts.itemDetails, and getThreadBroadcastItem reads one

## Place in the sequence

- **Blocked by:** T13 — Add broadcast items to conversations: recordBroadcastItem in the outcome transaction without touching any conversation column, the thread kind broadcast in the keyset order, one-item reads and conversation.changed with item type broadcast, T17 — Add the broadcasts reads: the list with each draft's audience size, one broadcast as a draft with its breakdown for the current bot or as a launched broadcast with its frozen audience and totals, the recipients page, and itemDetails for the inbox thread · **Blocks:** T26 — Register the broadcasts routes (registerBroadcasts): the seventeen operations with their zod schemas, the owner-only launch confirmation, launch and stop, the masked picker search, and the wiring in buildDeps (contacts ⇄ bots late-bound ports, broadcasts after team, inbox given itemDetails) and buildApp · **Wave:** 6 — after T13, T17.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** my replies to go out without waiting behind a broadcast, and to see the broadcast in a customer's conversation when they answer it
> **So that** support works as usual and I understand what the customer is answering
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

It lets the operator who opens a recipient's conversation see the broadcast they are being answered about, with its name, text and launching owner, at its place in the thread.

## Inlined context

> **A broadcast item is a new thread entry kind owned by `conversations`, written in the send's outcome transaction, and enriched by `inbox` from `broadcasts`.** `conversations` stores, per recipient conversation, the broadcast id, the state (delivered / not confirmed) and the position time. It never touches the conversation's status, assignee, state version, waiting period, last activity or anyone's unread. The thread read returns it in the same keyset order as messages, replies and activity entries. `inbox` adds the broadcast's name, text and launching owner from `broadcasts` (AC-16)
>
> — `sad.md §4, choice 10, abridged` · full text: [sad.md](../sad.md)

> | inbox | thread entries of kind `broadcast` enriched with `broadcasts.itemDetails` | web (SCR-02) | AC-16 |
> | workspaces | `lockActiveMembers` (existing) for launch / stop; display names incl. deactivated (existing) | broadcasts, inbox | AC-08, AC-16 |
>
> — `sad.md §5, App-layer additions, abridged` · full text: [sad.md](../sad.md)

> The thread read returns broadcast items in the same keyset order as messages, replies and activity entries. `inbox` adds each broadcast's name, text and launching owner from `broadcasts`, and names a deactivated owner too. A not confirmed item is marked and sits at the time of the send. The item links to the broadcast page.
>
> — `sad.md §6, flow 18, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. The thread stays one ordered query in its owner. The item is written in the same transaction as the recipient's outcome, so the report and the thread never disagree. It has its own kind, so no existing rule about messages or replies (unread, waiting, reopen, pings) sees it.
>
> — `adr/0010 §Decision outcome, ADR-0010, verbatim` · full text: [ADR-0010](../adr/0010-store-broadcast-items-as-a-conversations-thread-entry-that-never-touches-conversation-state.md)

> **Hard rule:** Dependencies are one-way: `inbox → {conversations, contacts, bots, workspaces, notifications}` […]. Static edges added: `broadcasts → {contacts, conversations, bots, workspaces}` and `inbox → broadcasts`. No module calls `broadcasts` back, so it needs no port, and the graph stays acyclic. […] `inbox` keeps owning no tables.
>
> — `sad.md §2 + §4, module direction, choice 1, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (reads `broadcast_items` through `conversations` (T13) and `broadcasts` through `broadcasts.itemDetails` (T17)).

## API contract

- `GET /api/workspaces/{workspaceId}/inbox/conversations/{conversationId}/items` (`listThreadItems`, changed) → `200 ThreadPage`; `ThreadItem` gains `type: broadcast` → `ThreadBroadcastItem { type: broadcast, id, workspace_id, conversation_id, broadcast_id, broadcast_name, text, launched_by: MemberRef (named after a deactivation too), state: delivered | not_confirmed, position_at }` in the same keyset order. Errors: `400`, `401`, `403 ACCESS_REMOVED`, `404 ConversationNotFound`.
- `GET …/inbox/conversations/{conversationId}/broadcast-items/{broadcastItemId}` (`getThreadBroadcastItem`, added) → `200 ThreadBroadcastItem`; `404 ITEM_NOT_FOUND` for an item of another conversation or workspace; `400`, `401`, `403`.

— `contracts/openapi.yaml, operationId listThreadItems, getThreadBroadcastItem; schema ThreadBroadcastItem, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-08 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, open, create, edit, duplicate, delete or launch a broadcast of "Acme Flowers", see its delivery report, or add a contact of "Acme Flowers" to a group of another workspace (or a contact of another workspace to a group of "Acme Flowers")
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the broadcast or the contact exists; a deactivated member gets the access-removed notice and a member deactivated while on the confirmation launches nothing; someone not signed in is asked to sign in first; a broadcast's audience, recipients and report only ever hold contacts of its own workspace, and the bot of one workspace never sends another workspace's broadcast
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — cross-context

> **Given** "Olena K.", whose conversation is closed, unassigned and not waiting for a reply, received the broadcast "Spring prices"
> **When** an operator opens her conversation in the inbox, and then she answers the broadcast in Telegram
> **Then** the thread shows the broadcast at the time it was delivered as a broadcast item — its text, its name and the business owner who launched it (still named if that owner was deactivated since) — distinct from the team's replies; a recipient whose send ended "not confirmed" also gets the item, marked "not confirmed" and placed at the time the send was made; receiving it did not reopen the conversation, did not change its assignee, its "waiting for a reply" marker, any unread or attention count, and triggered no ping; her answer is captured as a customer message as before: it reopens the conversation and counts for unread, "waiting for a reply" and pings like any message; a recipient whose broadcast failed for any other reason, was stopped before their turn, or who was left out gets no broadcast item
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Add `BroadcastsReads.itemDetails(ws, broadcastIds)` to the inbox ports (name, text, launched_by account id) — `apps/api/src/modules/inbox/app/ports.ts`
- [ ] Enrich the thread page's broadcast entries in one `itemDetails` call per page plus member display names (deactivated included); add `getThreadBroadcastItem` — `apps/api/src/modules/inbox/app/reads.ts` (+ `reads.test.ts` with fakes)
- [ ] Register `GET …/broadcast-items/:broadcastItemId` with its zod schemas; `listThreadItems`' response schema accepts the broadcast kind — `apps/api/src/modules/inbox/http/routes.ts`
- [ ] Route integration tests: item between messages at its position, deactivated launcher named, foreign item 404, no read mark or attention change — `apps/api/src/modules/inbox/http/routes.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| the launching owner was deactivated | still named in `launched_by` (AC-16) |
| item id of another conversation of the same workspace | `404 ITEM_NOT_FOUND` |
| item id of another workspace | `404`, no hint (AC-08) |
| a not confirmed item | `state: not_confirmed`, positioned at the claim time |
| a page with no broadcast items | no `itemDetails` call |
| reading the thread or one item | no `markConversationRead`, no attention change (AC-16) |

## Definition of Done

- [ ] Route integration tests prove listThreadItems returns a broadcast item between the messages and replies at its position with name, text, state and the launching owner (also when deactivated), getThreadBroadcastItem answers one item and 404 ITEM_NOT_FOUND for an item of another conversation or workspace, and neither read changes read state or attention.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
