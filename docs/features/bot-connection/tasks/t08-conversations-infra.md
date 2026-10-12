---
id: T8
title: "Build the conversation and message repositories with cross-workspace isolation tests"
layer: "infra"
deps: ["T1", "T6"]
blocks: ["T9"]
acs: ["AC-10", "AC-11", "AC-13"]
files_hint: ["apps/api/src/modules/conversations/app/ports.ts", "apps/api/src/modules/conversations/infra/", "apps/api/src/test/fixtures/conversations.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T8 — Build the conversation and message repositories with cross-workspace isolation tests

## Place in the sequence

- **Blocked by:** T1 — migrations, T6 — edit rule · **Blocks:** T9 — Implement the conversations app layer: capture inbound message, apply edit, last message time, has conversations · **Wave:** 2.
- **Lane:** shares `modules/conversations/app/ports.ts` with T9 — serialized (T9 depends on this task anyway).

## Why (user story)

> **As an** Operator
> **I want** every message from one customer kept in a single conversation, in the order it was sent and up to date with the customer's edits
> **So that** I see the whole history when I answer
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

This task builds the persistence that makes capture exactly-once and edits converge on the customer's last edit.

## Inlined context

> Messages unique per (conversation, Telegram message id); contacts per (workspace, Telegram user id); conversations per contact and per (workspace, Telegram chat id); order by Telegram message id; edits by edit time with update-id tie-break
>
> — `sad.md §8, Idempotency and order, abridged` · full text: [sad.md](../sad.md)

> Cross-module FK `conversations.contact_id → contacts(id)` is a constraint only […]: `conversations` never queries `contacts`
>
> — `data-model.md §Conventions applied, abridged` · full text: [data-model.md](../data-model.md)

> `insertConversation(db, { workspaceId, contactId, telegramChatId? })` defaults `telegramChatId` to the contact's Telegram user id. `insertMessage(db, { workspaceId, conversationId, telegramMessageId, kind?, body?, sentAt?, receivedAt?, editedAt?, editUpdateId? })`.
>
> — `data-model.md §Test fixtures, abridged` · full text: [data-model.md](../data-model.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Access pattern | SQL shape | Index |
|---|---|---|
| Upsert the contact's conversation | `INSERT … ON CONFLICT (workspace_id, telegram_chat_id) DO NOTHING` then select | `conversations_workspace_id_telegram_chat_id_key` (+ `conversations_contact_id_key`) |
| Find by chat for an edit | `WHERE workspace_id=$w AND telegram_chat_id=$c` | same |
| Has conversations | `EXISTS … WHERE workspace_id=$w` | same, leading column |
| Insert message once | `INSERT … ON CONFLICT (conversation_id, telegram_message_id) DO NOTHING` → `captured` \| `already_present` | `messages_conversation_id_telegram_message_id_key` |
| Conditional edit | `UPDATE … SET body, telegram_message, edited_at, edit_update_id WHERE conversation_id=$c AND telegram_message_id=$m AND workspace_id=$w AND (edited_at IS NULL OR (edited_at, edit_update_id) < ($edit_date, $update_id))` → `applied` \| `not_later` \| `not_found` | same |
| Newest received of a workspace | `max(received_at) WHERE workspace_id=$w` (backward index-only scan, check with `EXPLAIN`) | `messages_workspace_id_received_at_idx` |

— `data-model.md §Entities (conversations, messages) access patterns, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-10 — happy path

> **Given** a captured message in an end customer's conversation — text, or a non-text message with a caption
> **When** the customer edits its text or caption in Telegram
> **Then** the conversation holds the edited text in place of the old one, marked as edited, and no new message is added; when edits arrive out of order, the one the customer made last (by Telegram's edit time) wins; an edit of a message that has not been captured adds nothing and is not kept for later
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — domain invariant

> **Given** a message from an end customer that has already been captured
> **When** Telegram delivers the same message again (for example after a delivery retry)
> **Then** the conversation still holds it exactly once, and messages keep the order in which the customer sent them (Telegram's order for that chat), not the order in which they reached tg-inbox — a late redelivered message takes its original place
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — cross-context

> **Given** "Acme Flowers" and "Bolt Bikes" each have a connected bot, and one person writes to both bots
> **When** both messages are captured
> **Then** each workspace has its own contact and conversation for that person, holding only the messages sent to its own bot, and neither workspace can see that the other one knows the person
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Ports `ConversationRepo`, `MessageRepo` (every method takes `workspaceId` and an optional `tx`) — `conversations/app/ports.ts`
- [ ] Kysely repos per the table above, `newId()` ids, clock-supplied `received_at` / `created_at` — `conversations/infra/{conversation,message}-repo.ts`
- [ ] Fixtures `insertConversation`, `insertMessage` — `apps/api/src/test/fixtures/conversations.ts`
- [ ] Integration tests: every method on two workspaces (never reads/changes the other's rows); duplicate insert → `already_present`; out-of-order edits converge; edit of a missing message → `not_found` and nothing written; `EXPLAIN` of the newest-received query uses the index — `conversations/infra/*.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Edit with an equal `edit_date` and lower `update_id` | `not_later`, row unchanged |
| Conditional edit called with workspace B for A's conversation | 0 rows (`not_found`) |
| No messages yet | newest received = `null` |

## Definition of Done

- [ ] every repository method has a passing two-workspace isolation test
- [ ] idempotent insert and conditional-edit integration tests pass
- [ ] no query in `conversations/infra` touches `contacts` or `bots`
- [ ] lint + vet clean (`pnpm lint`)
