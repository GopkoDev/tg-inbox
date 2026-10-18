---
id: T8
title: "Maintain the conversation list columns on capture and edit, publish conversation.changed, and promote migration 10"
layer: "app"
deps: ["T1", "T3", "T7"]
blocks: ["T9", "T10"]
acs: ["AC-01", "AC-15"]
files_hint: ["apps/api/src/modules/conversations/app/conversations.ts", "apps/api/src/modules/conversations/app/ports.ts", "apps/api/src/modules/conversations/app/fakes.ts", "apps/api/src/modules/conversations/infra/conversation-repo.ts", "apps/api/src/modules/conversations/infra/message-repo.ts", "apps/api/migrations/", "docs/features/shared-inbox/migrations/10_contract_conversations_list_columns.up.sql", "apps/api/src/test/fixtures/conversations.ts", "apps/api/src/platform/db.types.gen.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T8 — Maintain the conversation list columns on capture and edit, publish conversation.changed, and promote migration 10

## Place in the sequence

- **Blocked by:** T1 — Promote the expand, backfill and new-table migrations 01–08, regenerate DB types and add the inbox test fixtures, T3 — Build platform/realtime: an in-transaction pg_notify publisher and a dedicated-connection listener with reconnect and gap resync, T7 — Give workspaces an active-since time, a richer guard result, active-member and display-name lookups and a deactivation signal; promote migration 09 · **Blocks:** T9 — Build the conversations read side: list page with unread counts, summary, thread page, single items, media reference and mark read, T10 — Build reply creation and re-queueing in conversations: idempotent client key, per-member limit under an advisory lock, teammate check, attempt row and drain job in one transaction · **Wave:** 3 — after T1, T3, T7.
- **Lane:** serialized lane with T9–T11 (shares `modules/conversations/app/ports.ts` / `fakes.ts`) and with T1/T7 on `apps/api/migrations/`.

## Why (user story)

> **As an** Operator
> **I want** one list of all the workspace's conversations, newest activity first, showing what I have not read and what is waiting for a reply
> **So that** I know at a glance which customers need an answer
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** new customer messages and my teammates' replies to appear live, and to be warned before I answer a customer a teammate has just answered
> **So that** our team does not miss messages or give a customer two different answers
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It makes every captured message move its conversation to the top and announce itself live, while an edit announces itself without moving anything.

## Inlined context

> | `last_activity_at` | timestamptz | NOT NULL (after contract), `CHECK = GREATEST(last_message_received_at, last_reply_sent_at)` | List order, newest first (AC-01). It moves when a customer message is captured (by arrival) or a reply is marked "sent". Edits, sending replies and failed replies never move it |
> | `last_message_received_at` | timestamptz | NOT NULL (after contract) | Arrival (`messages.received_at`) of the newest captured customer message. The conversation row is inserted with the arriving message's `received_at`, and capture raises it with `GREATEST`. A late redelivery arrives now, so it moves it |
>
> — `data-model.md §conversations — changed, verbatim` · full text: [data-model.md](../data-model.md)

> S->>D: replace the text and mark it edited, arrival and last activity unchanged, row's last item refreshed if it is this message
> S->>B: conversation-changed signal, change edited, published with the write
> […]
> S->>D: store the message at its Telegram send time in the history, arrival now
> S->>B: conversation-changed signal, change created, published with the write
>
> — `sad.md §6, flow 10, abridged` · full text: [sad.md](../sad.md)

> Conv->>Conv: store message, update activity, waiting and last item
> Conv->>Rt: signal conversation changed with message id, in the same transaction
>
> — `sad.md §6, critical flow 2, verbatim` · full text: [sad.md](../sad.md)

> `09` and `10` must not run before the code that writes […] the conversation list columns (capture, reply marked sent) is in place.
>
> — `_audit/data-model-2026-10-18.md, Ordering with code, abridged` · full text: [data-model audit](../_audit/data-model-2026-10-18.md)

> Publishing goes through a `platform/realtime` publisher that takes the caller's transaction, so modules stay unaware of `inbox`
>
> — `adr/0003, Decision outcome, abridged` · full text: [ADR-0003](../adr/0003-fan-out-live-signals-through-postgres-listen-notify-published-in-the-writing-transaction.md)

> **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation.
>
> — `CLAUDE.md §Rules, Tenancy, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Column | Type | Constraints | Change |
|---|---|---|---|
| `conversations.last_message_received_at` | timestamptz | NOT NULL after `10` | set on insert from the message's `received_at`; raised with `GREATEST` on every capture |
| `conversations.last_activity_at` | timestamptz | NOT NULL after `10`, `conversations_last_activity_at_check` = `GREATEST(last_message_received_at, last_reply_sent_at)` | written in the same `UPDATE` as `last_message_received_at` |
| `conversations.last_reply_sent_at` | timestamptz | NULL | read-only here (T11 writes it) |

Staged pair promoted here: `docs/features/shared-inbox/migrations/10_contract_conversations_list_columns.{up,down}.sql`. Fixture `insertConversation(db, { …, lastActivityAt?, lastMessageReceivedAt?, lastReplySentAt? })` defaults to `T` / `T` / `null` and changes in this task.

— `data-model.md §conversations + §Test fixtures, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface. (Emits the realtime signal behind live frame `conversation.changed` with `change: created | edited`, `item.type: message` — `events.md`.)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" whose business bot has captured conversations with 30 end customers
> **When** they open the inbox
> **Then** the list shows those 30 conversations and nothing else — no sample data and no "Sample data" label — newest activity first (activity = a new customer message or a reply marked "sent"; a customer's edit, and a reply still sending or not delivered, do not move a conversation), each with the contact's name, the last message (a non-text message shown by its kind and caption, for example "Photo · new bouquet?"), how long ago it happened, how many customer messages this operator has not read (teammates' replies never count as unread; messages that arrived before the operator joined or was reactivated count as read), and a "waiting for a reply" marker when the customer wrote after the last reply marked "sent" — a reply that is sending, not confirmed or not delivered does not clear it; a business owner of "Acme Flowers" sees and does in the inbox everything an operator does
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** two operators of "Acme Flowers" with the inbox open, one of them inside a conversation
> **When** the customer of that conversation sends a message or edits one, a new customer writes for the first time, or the other operator sends a reply
> **Then** within the live-update target of §6 and without reloading, the list and the open thread show it: the new conversation appears at the top, the edited message shows its new text marked as edited, the teammate's reply shows with their name and delivery state; a message that arrives in a thread open in a visible browser tab counts as read for the operator looking at it (a tab in the background does not mark anything read), an edit does not make a message unread again, and a customer message that arrived late and took its earlier place in the history (a late redelivery) counts as unread, by its arrival, for every member who has not looked at the conversation since — it is never hidden behind messages already read
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Capture: insert/upsert writes `last_message_received_at` and `last_activity_at = GREATEST(last_message_received_at, last_reply_sent_at)` in the capture transaction — `modules/conversations/infra/conversation-repo.ts`, `app/conversations.ts`
- [ ] Capture of a new message publishes `conversation.changed { change: created, item: message }`; an applied edit publishes `change: edited`; a duplicate update publishes nothing — `modules/conversations/app/conversations.ts`
- [ ] Take the realtime publisher as a port; update `app/fakes.ts` — `modules/conversations/app/ports.ts`
- [ ] Promote `10`, migrate/rollback, `pnpm db:codegen`; update `insertConversation` — `apps/api/migrations/`, `test/fixtures/conversations.ts`
- [ ] Integration tests: columns after capture, late redelivery, edit; signals on commit only; isolation unchanged — `modules/conversations/app/conversations.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Edit of a captured message | text replaced, `edited_at` set; `last_activity_at` and arrival unchanged; `edited` signal |
| Late redelivery | `last_message_received_at` = now → the row moves; `created` signal |
| Duplicate Telegram update | no column change, no signal |
| Capture fails | transaction rolls back, no signal (Telegram redelivers) |

## Definition of Done

- [ ] integration tests prove the column values after capture, late redelivery and edit, and signals only on commit
- [ ] staged `10` is promoted to live `migrations/`, then applies and reverts cleanly; the `GREATEST` CHECK holds for every fixture
- [ ] bot-connection capture tests still pass
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
