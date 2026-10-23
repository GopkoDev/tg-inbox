---
id: T13
title: "Add broadcast items to conversations: recordBroadcastItem in the outcome transaction without touching any conversation column, the thread kind broadcast in the keyset order, one-item reads and conversation.changed with item type broadcast"
layer: "app"
deps: ["T3", "T4"]
blocks: ["T22", "T25"]
acs: ["AC-16"]
files_hint: ["apps/api/src/modules/conversations/app/broadcast-items.ts", "apps/api/src/modules/conversations/app/broadcast-items.test.ts", "apps/api/src/modules/conversations/infra/broadcast-item-repo.ts", "apps/api/src/modules/conversations/infra/broadcast-item-repo.int.test.ts", "apps/api/src/modules/conversations/domain/thread.ts", "apps/api/src/modules/conversations/domain/thread.test.ts", "apps/api/src/modules/conversations/infra/thread-queries.ts", "apps/api/src/modules/conversations/infra/conversation-signals.ts", "apps/api/src/modules/conversations/app/ports.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T13 — Add broadcast items to conversations: recordBroadcastItem in the outcome transaction without touching any conversation column, the thread kind broadcast in the keyset order, one-item reads and conversation.changed with item type broadcast

## Place in the sequence

- **Blocked by:** T3 — Promote migrations 03–08 (the conversations (workspace_id, id) key, broadcasts, broadcast_audience_tags, broadcast_group_contacts, broadcast_recipients, broadcast_items), regenerate DB types and add the broadcast fixtures, T4 — Add the broadcasts zod contracts, the eleven BROADCAST_* error codes, the broadcast.changed frame and signal, the widened contact.changed (reach) and conversation.changed (broadcast) frames with their hub mapping, and keep the web stores ignoring what they do not handle yet · **Blocks:** T22 — Add one link of the sending chain: resolve stale in-flight recipients as not confirmed with their items, serve the sending broadcasts in turns with at most 8 sends in flight for at most 20 s, check the block at each turn, claim before the send, record each outcome with its broadcast item and a coalesced report signal, abort or finish, and decide the successor, T25 — Enrich the inbox thread with broadcast items: listThreadItems returns broadcast entries with the broadcast name, text and launching owner from broadcasts.itemDetails, and getThreadBroadcastItem reads one · **Wave:** 3 — after T3, T4.
- **Lane:** shares `apps/api/src/modules/conversations/app/ports.ts` with T7 — serialized.

## Why (user story)

> **As an** Operator
> **I want** my replies to go out without waiting behind a broadcast, and to see the broadcast in a customer's conversation when they answer it
> **So that** support works as usual and I understand what the customer is answering
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

It lets the recipient's conversation show the broadcast the customer may be answering, without the broadcast ever changing the conversation's state or anyone's unread.

## Inlined context

> **A broadcast item is a new thread entry kind owned by `conversations`, written in the send's outcome transaction, and enriched by `inbox` from `broadcasts`.** `conversations` stores, per recipient conversation, the broadcast id, the state (delivered / not confirmed) and the position time. It never touches the conversation's status, assignee, state version, waiting period, last activity or anyone's unread. The thread read returns it in the same keyset order as messages, replies and activity entries.
>
> — `sad.md §4, choice 10, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. The thread stays one ordered query in its owner. The item is written in the same transaction as the recipient's outcome, so the report and the thread never disagree. It has its own kind, so no existing rule about messages or replies (unread, waiting, reopen, pings) sees it.
>
> — `adr/0010 §Decision outcome, ADR-0010, verbatim` · full text: [ADR-0010](../adr/0010-store-broadcast-items-as-a-conversations-thread-entry-that-never-touches-conversation-state.md)

> | conversations | `recordBroadcastItem(tx, { workspaceId, contactId, broadcastId, state, positionAt, telegramMessageId })`; thread read gains kind `broadcast` | broadcasts; inbox | ADR-0010 |
>
> — `sad.md §5, App-layer additions, verbatim` · full text: [sad.md](../sad.md)

> - **The thread's `KIND_ORDER`** (`conversations/domain/thread.ts`) gains `broadcast` after `activity`. The cursor's `kind` and the item union gain it too, and `thread-queries.ts` adds a fourth keyset half on `broadcast_items_conversation_position_at_idx`.
>
> — `_audit/data-model-2026-10-23.md §Code-level findings, verbatim` · full text: [audit](../_audit/data-model-2026-10-23.md)

> `recordBroadcastItem` finds the recipient's conversation by the existing `conversations_contact_id_key` (one per contact).
>
> — `data-model.md §Entities, conversations (changed), verbatim` · full text: [data-model.md](../data-model.md)

> 5. **`conversation.changed` for a broadcast item is `change: "created"` only**: an item is never edited. The inbox list and the attention store ignore it (ADR-0010); only a tab with that conversation open refetches it.
>
> — `contracts/events.md §Assumptions, 5, verbatim` · full text: [events.md](../contracts/events.md)

> **Outcome:** recipient row → broadcast item insert (foreign-key `KEY SHARE` on the conversation and broadcast rows, compatible with `NO KEY UPDATE`) → signal.
>
> — `sad.md §8, Lock order, abridged` · full text: [sad.md](../sad.md)

> | Tenancy | every new table has a non-null `workspace_id` and composite foreign keys `(workspace_id, …)` to `contacts`, `memberships`, `broadcasts` and `conversations`; every repository method takes `workspaceId`; each repository has a cross-workspace isolation test. The sender job carries its workspace id; `sendBroadcastMessage` takes the workspace id and the expected Telegram bot id. **No new tenancy exception** (the six stay six) | CLAUDE.md; ADR-0007 |
>
> — `sad.md §8, Tenancy, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Column | Type | Constraints | Change |
|---|---|---|---|
| `broadcast_items.id` | uuid | PK, UUIDv7 from `newId()` | written |
| `workspace_id` | uuid | NOT NULL, FK → `workspaces` | written |
| `conversation_id` | uuid | FK `(workspace_id, conversation_id) → conversations (workspace_id, id)` | written |
| `broadcast_id` | uuid | FK `(workspace_id, broadcast_id) → broadcasts`; UNIQUE with conversation | written |
| `state` | text | `CHECK IN ('delivered','not_confirmed')` | written |
| `position_at` | timestamptz | NOT NULL — delivered: when recorded; not confirmed: the claim time | written |
| `telegram_message_id` | bigint | non-null ⇔ `delivered` | written |
| `created_at` | timestamptz | NOT NULL | written |

Indexes: `broadcast_items_broadcast_conversation_key` (one item per broadcast and conversation), `broadcast_items_conversation_position_at_idx (workspace_id, conversation_id, position_at, id)` (thread keyset). The table and `conversations_workspace_id_id_key` are promoted by T3. **No column of `conversations` is written.**

— `data-model.md §Entities, broadcast_items + §Indexes, abridged` · full text: [data-model.md](../data-model.md)

## API contract

- `GET …/inbox/conversations/{conversationId}/items` (`listThreadItems`), **changed:** "the thread merges a fourth keyset half, broadcast items by `broadcast_items.position_at` […]. At equal positions the order is message < reply < activity < broadcast. The opaque cursor also encodes the kind `broadcast`; a cursor issued before this feature still decodes. A broadcast item is never unread, never moves `read_through_at`, never becomes the list row's `last_item`, and changes no conversation state." This task returns the raw item (id, conversation, broadcast id, state, position); `inbox` adds `broadcast_name`, `text`, `launched_by` (T25).
- `GET …/broadcast-items/{broadcastItemId}` (`getThreadBroadcastItem`): this task provides the one-item read by (workspace, conversation, id); the route is T25's.
- Frame / signal: `conversation.changed { item: { type: "broadcast", id }, change: "created" }`, published by `recordBroadcastItem` in the outcome transaction.

— `contracts/openapi.yaml, operationId listThreadItems / getThreadBroadcastItem, abridged`; `contracts/events.md §Frame: conversation.changed, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-16 — cross-context

> **Given** "Olena K.", whose conversation is closed, unassigned and not waiting for a reply, received the broadcast "Spring prices"
> **When** an operator opens her conversation in the inbox, and then she answers the broadcast in Telegram
> **Then** the thread shows the broadcast at the time it was delivered as a broadcast item — its text, its name and the business owner who launched it (still named if that owner was deactivated since) — distinct from the team's replies; a recipient whose send ended "not confirmed" also gets the item, marked "not confirmed" and placed at the time the send was made; receiving it did not reopen the conversation, did not change its assignee, its "waiting for a reply" marker, any unread or attention count, and triggered no ping; her answer is captured as a customer message as before: it reopens the conversation and counts for unread, "waiting for a reply" and pings like any message; a recipient whose broadcast failed for any other reason, was stopped before their turn, or who was left out gets no broadcast item
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Failing domain tests first: `compareThreadPosition` orders `broadcast` after `activity` at equal times; cursors with kind `broadcast` round-trip and an old cursor still decodes — `apps/api/src/modules/conversations/domain/thread.test.ts`
- [ ] `KIND_ORDER` gains `broadcast: 3`; `ThreadPosition.kind` gains it — `apps/api/src/modules/conversations/domain/thread.ts`
- [ ] Repo: insert one item (conversation found by `(workspace_id, contact_id)`), read one by (workspace, conversation, id), and the thread half by `(position_at, id)` — `apps/api/src/modules/conversations/infra/broadcast-item-repo.ts`
- [ ] Fourth keyset half merged into before / after pages — `apps/api/src/modules/conversations/infra/thread-queries.ts`
- [ ] `recordBroadcastItem(tx, …)` + `getBroadcastItem(workspaceId, conversationId, itemId)` exposed in the app layer (ports in `apps/api/src/modules/conversations/app/ports.ts`) — `apps/api/src/modules/conversations/app/broadcast-items.ts`
- [ ] Publish `conversation.changed` item type `broadcast`, `created` — `apps/api/src/modules/conversations/infra/conversation-signals.ts`
- [ ] Unit test with fakes: the use case never calls a conversation-state, read-mark or activity writer — `apps/api/src/modules/conversations/app/broadcast-items.test.ts`
- [ ] Integration tests: status / assignee / `state_version` / waiting / last activity / read marks unchanged after an item; a second item for the same broadcast and conversation refused by the unique key; mixed pages in keyset order; isolation over `twoWorkspacesWithBroadcasts` — `apps/api/src/modules/conversations/infra/broadcast-item-repo.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| conversation closed and unassigned | stays closed, unassigned, not waiting (AC-16) |
| `not_confirmed` | item at the claim time, no message id (AC-16) |
| recipient failed / stopped / left out | no item is ever written (caller only records delivered / not confirmed) (AC-16) |
| launching owner deactivated | item unaffected; the name is added by `inbox` (T25) |
| item for a conversation of another workspace | refused by the composite FK (AC-08) |
| equal `position_at` with a message | message first, broadcast last |

## Definition of Done

- [ ] Integration tests prove recordBroadcastItem writes one item per broadcast and conversation at the given position time (delivered with its message id, not confirmed without) and publishes conversation.changed { item.type: broadcast, change: created } while the conversation's status, assignee, state_version, waiting, last activity and every read mark stay unchanged, that the thread pages interleave broadcast items with messages, replies and activity entries in (position_at, kind, id) order with broadcast after activity, and that every read is scoped by workspace with an isolation test.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
