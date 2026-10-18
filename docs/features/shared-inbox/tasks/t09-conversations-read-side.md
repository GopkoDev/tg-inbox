---
id: T9
title: "Build the conversations read side: list page with unread counts, summary, thread page, single items, media reference and mark read"
layer: "infra"
deps: ["T5", "T8"]
blocks: ["T16", "T19"]
acs: ["AC-01", "AC-03", "AC-15", "AC-18"]
files_hint: ["apps/api/src/modules/conversations/app/ports.ts", "apps/api/src/modules/conversations/app/fakes.ts", "apps/api/src/modules/conversations/app/inbox-reads.ts", "apps/api/src/modules/conversations/infra/list-queries.ts", "apps/api/src/modules/conversations/infra/thread-queries.ts", "apps/api/src/modules/conversations/infra/read-mark-repo.ts", "apps/api/src/modules/conversations/infra/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T9 — Build the conversations read side: list page with unread counts, summary, thread page, single items, media reference and mark read

## Place in the sequence

- **Blocked by:** T5 — Add the conversations domain rules: reply states and transitions, thread position order and cursors, the arrival-watermark rule, T8 — Maintain the conversation list columns on capture and edit, publish conversation.changed, and promote migration 10 · **Blocks:** T16 — Create the inbox module with its read use cases and routes (list, search, conversation, thread, items, mark read, bot status) and wire it into buildDeps and buildApp, T19 — Add the openMessageMedia route that streams a customer's media with forced safe headers and typed unavailability · **Wave:** 4 — after T5, T8.
- **Lane:** serialized lane with T8, T10, T11 (shared `modules/conversations/app/ports.ts` / `fakes.ts`).

## Why (user story)

> **As an** Operator
> **I want** one list of all the workspace's conversations, newest activity first, showing what I have not read and what is waiting for a reply
> **So that** I know at a glance which customers need an answer
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to open a conversation and read everything the customer sent and everything the team replied, including the customer's photos, voice notes and files
> **So that** I answer with the full context, without asking the customer to repeat themselves
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It produces every row and item the inbox shows — per member, per workspace, within the latency targets.

## Inlined context

> `inbox` → `conversations`: *list page* (keyset, optional contact-id filter, with this member's unread counts and the "waiting" marker), *conversation summary*, *thread page* (before / after a position cursor), *thread item*, *mark read through*, […] *media reference of a message*.
>
> — `sad.md §5, Cross-module app-layer calls, abridged` · full text: [sad.md](../sad.md)

> **Waiting for a reply** (AC-01, AC-06, AC-10) is derived, not stored: `last_reply_sent_at IS NULL OR last_message_received_at > last_reply_sent_at`.
> **Last item shown in the row** (AC-01) is derived, not stored. It is the later of two reads:
> - the newest message by arrival — a backward scan of `messages_conversation_id_received_at_idx`, limit 1;
> - the newest "sent" reply — a backward scan of `replies_conversation_id_position_at_idx` with `state = 'sent'`.
>
> — `data-model.md §conversations — changed, abridged` · full text: [data-model.md](../data-model.md)

> - List page by `(workspace_id, last_activity_at DESC, id DESC)` keyset → `conversations_workspace_id_last_activity_at_idx`.
> - Search-filtered page: same index plus `contact_id = ANY(…)`.
> - Unread count per list row: `conversation_id = ? AND received_at > GREATEST(watermark, active_since)` → `messages_conversation_id_received_at_idx`.
> - Thread page: `(sent_at, telegram_message_id)` keyset → `messages_conversation_id_sent_at_idx`.
> - Mark read: `INSERT … ON CONFLICT (conversation_id, account_id) DO UPDATE SET read_through_at = GREATEST(…)`.
>
> — `data-model.md §Access patterns, abridged` · full text: [data-model.md](../data-model.md)

> Only this page carries `read_through_at`, which is the arrival time of the newest customer message captured when the page was read. […] That way everything that has arrived so far is marked read, including a late redelivery placed earlier in the history, and nothing that arrives after the read is marked by mistake (ADR-0005).
>
> — `contracts/openapi.yaml, listThreadItems, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

> It raises this member's arrival watermark for the conversation to `read_through_at` and never lowers it (`GREATEST`). It is also clamped to the newest arrival in the conversation, so a time in the future marks nothing extra. […] The write publishes a `conversation.changed` frame with `change: read` to this member's own sockets only
>
> — `contracts/openapi.yaml, markConversationRead, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

> | Inbox list p95 — first page, workspace with 1 000 conversations | ≤ 500 ms server time | request timing log; a seeded integration test of 1 000 conversations |
> | Thread open p95 — latest page of a 5 000-message conversation | ≤ 500 ms server time | request timing log; seeded integration test |
>
> — `spec.md §6, NFR table, verbatim` · full text: [spec.md](../spec.md)

> **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation.
>
> — `CLAUDE.md §Rules, Tenancy, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Read-only on `conversations`, `messages`, `replies`; writes `read_marks`:

| Table | Columns used | Index |
|---|---|---|
| `conversations` | `workspace_id`, `contact_id`, `last_activity_at`, `last_message_received_at`, `last_reply_sent_at` | `conversations_workspace_id_last_activity_at_idx`, `conversations_contact_id_key` |
| `messages` | `received_at`, `sent_at`, `telegram_message_id`, `kind`, `body`, `edited_at`, `telegram_message` (projection of attachment / location / contact / poll; file reference for media) | `messages_conversation_id_received_at_idx`, `messages_conversation_id_sent_at_idx` |
| `replies` | all columns of `ThreadReply` | `replies_conversation_id_position_at_idx` |
| `read_marks` | `read_through_at` (upsert, `GREATEST`, clamped) | `read_marks_conversation_id_account_id_key` |

— `data-model.md §Entities + §Indexes, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Supplies (through the `inbox` routes in T16 / T19) the shapes `ConversationPage`, `Conversation`, `ThreadPage`, `ThreadMessage`, `ThreadReply` (with `author.account_id` only — names are joined by `inbox`), `ReadState`, and for media an internal `{ fileReference, kind, fileSize, fileName, mimeType } | not found` (a kind with no file is not found).

— `contracts/openapi.yaml, listConversations / getConversation / listThreadItems / getThreadMessage / getThreadReply / markConversationRead / openMessageMedia, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" whose business bot has captured conversations with 30 end customers
> **When** they open the inbox
> **Then** the list shows those 30 conversations and nothing else — no sample data and no "Sample data" label — newest activity first (activity = a new customer message or a reply marked "sent"; a customer's edit, and a reply still sending or not delivered, do not move a conversation), each with the contact's name, the last message (a non-text message shown by its kind and caption, for example "Photo · new bouquet?"), how long ago it happened, how many customer messages this operator has not read (teammates' replies never count as unread; messages that arrived before the operator joined or was reactivated count as read), and a "waiting for a reply" marker when the customer wrote after the last reply marked "sent" — a reply that is sending, not confirmed or not delivered does not clear it; a business owner of "Acme Flowers" sees and does in the inbox everything an operator does
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

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

### AC-18 — cross-context

> **Given** one person writes to the bots of both "Acme Flowers" and "Bolt Bikes", and an account is a member of both workspaces
> **When** that account opens the inbox of each workspace in turn
> **Then** each inbox shows only its own workspace's conversation with that person — only the messages sent to its own bot and the replies sent by its own team — and a reply sent from one workspace goes only through that workspace's bot, to that person's conversation with it; each inbox holds at most one conversation per end customer
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] List page: keyset on (`last_activity_at`, `id`) desc, optional `contactIds` filter, per-row unread count (floor = `GREATEST(read_through_at, activeSince)`), waiting marker, last item — `modules/conversations/infra/list-queries.ts`
- [ ] Summary = one list row by (workspace, id) — same file
- [ ] Thread page: merge messages + replies by (position time, kind, id) from T5; latest / `before` / `after`; `has_prev`/`has_next`; `read_through_at` = `last_message_received_at` read in the same snapshot, latest page only — `modules/conversations/infra/thread-queries.ts`
- [ ] Single message / single reply by (workspace, conversation, id); media reference of a message (null for kinds with no file) — `modules/conversations/infra/thread-queries.ts`
- [ ] Mark read: upsert with `GREATEST`, clamp to the newest arrival, return unread count, publish `conversation.changed { change: read, account_id }` — `modules/conversations/infra/read-mark-repo.ts`, `app/inbox-reads.ts`
- [ ] Ports + fakes, cross-workspace isolation test per method on `twoWorkspacesWithInbox`, and seeded perf tests (1 000 conversations, 5 000-message thread) asserting the server time — `modules/conversations/infra/*.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Operator joined after messages arrived | those messages count as read (floor = `active_since`) |
| A teammate's reply | never counted as unread |
| Late redelivery after the operator's last read | counted unread by arrival, placed at its `sent_at` |
| `markRead` with an older time than stored | stored watermark kept |
| `markRead` with a future time | clamped to the newest arrival |
| Conversation / message / reply id of another workspace | not found (isolation test) |
| Media reference of a `text` / `location` / `poll` message | not found |

## Definition of Done

- [ ] integration tests prove unread by arrival and active-since, waiting marker, last item, thread order and paging, read-mark raise/clamp and the read signal
- [ ] a cross-workspace isolation test exists for every new repository method (AC-18)
- [ ] seeded tests: first list page of 1 000 conversations and latest page of a 5 000-message thread each under 500 ms server time
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
