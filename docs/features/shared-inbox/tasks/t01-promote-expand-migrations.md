---
id: T1
title: "Promote the expand, backfill and new-table migrations 01–08, regenerate DB types and add the inbox test fixtures"
layer: "migration"
deps: []
blocks: ["T7", "T8"]
acs: ["AC-01", "AC-11", "AC-18"]
files_hint: ["docs/features/shared-inbox/migrations/", "apps/api/migrations/", "apps/api/src/platform/db.types.gen.ts", "apps/api/src/test/migrations.int.test.ts", "apps/api/src/test/fixtures/conversations.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T1 — Promote the expand, backfill and new-table migrations 01–08, regenerate DB types and add the inbox test fixtures

## Place in the sequence

- **Blocked by:** — · **Blocks:** T7 — Give workspaces an active-since time, a richer guard result, active-member and display-name lookups and a deactivation signal; promote migration 09, T8 — Maintain the conversation list columns on capture and edit, publish conversation.changed, and promote migration 10 · **Wave:** 1 — nothing upstream.
- **Lane:** `layer: migration` is always serialized; shares `apps/api/migrations/` with T7 (09) and T8 (10) and `test/fixtures/conversations.ts` with T8.

## Why (user story)

> **As an** Operator
> **I want** one list of all the workspace's conversations, newest activity first, showing what I have not read and what is waiting for a reply
> **So that** I know at a glance which customers need an answer
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** every reply I send to show whether it reached Telegram, and if not, why
> **So that** no customer is left believing they were answered when they were not
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It creates the tables and columns every inbox read and every reply write stands on; their constraints are the database backstop of at-most-once (unique client key) and per-workspace scoping.

## Inlined context

> Promote one TS migration per ordinal, in order, with the SQL inline in `` sql`…`.execute(db) `` and a header comment `// Promoted from docs/features/shared-inbox/migrations/NN_….{up,down}.sql.` (precedent: `1791681109982_create_messages.ts`).
>
> — `_audit/data-model-2026-10-18.md, Promote-time hint, abridged` · full text: [data-model audit](../_audit/data-model-2026-10-18.md)

> `09` and `10` must not run before the code that writes `active_since` (join, reactivation, the first-owner CLI) and the conversation list columns (capture, reply marked sent) is in place.
> […] the contract migrations land in the same task or PR as that code and the fixture updates (`insertMembership`, `insertConversation`). Otherwise existing fixtures fail the NOT NULL.
>
> — `_audit/data-model-2026-10-18.md, Ordering with code, abridged` · full text: [data-model audit](../_audit/data-model-2026-10-18.md)

> **Migrations:** reversible — every migration exports a working `up` **and** `down`. After migrating, run `pnpm db:codegen` and commit the regenerated types. Destructive changes still go expand → migrate → contract.
>
> — `CLAUDE.md §Rules, Migrations, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> States, reasons and kinds are `text` + `CHECK (… IN (…))`, with no `ENUM`. State-dependent columns are tied together by `CHECK ((state = …) = (col IS NULL))`.
> There are no triggers. Derived columns are written by the application in the same statement as their sources, and a `CHECK` guards the result.
>
> — `data-model.md §Conventions applied, verbatim` · full text: [data-model.md](../data-model.md)

> OQ-2 | Confirm the dead-letter handler for an exhausted `inbox.deliver-replies` job […] | before the contract is finalized (and before migration `05` is promoted) | `ReplyFailureReason` includes `delivery_interrupted` (= data-model CHECK) […] If `design` decides otherwise, drop the value from the contract and from `05_create_replies` together
>
> — `contracts/api-sync-report.md, OQ-2, abridged` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> **IDs:** UUIDv7 from `newId()` (`src/platform/ids.ts`), never DB defaults. Telegram ids are `bigint` columns, never primary keys.
>
> — `CLAUDE.md §Rules, IDs, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Staged pairs promoted verbatim (constraint and index names unchanged), ordinals 01–08 only — `09`/`10` belong to T7/T8:

| Ordinal | Staged pair | Change |
|---|---|---|
| 01 | `docs/features/shared-inbox/migrations/01_add_memberships_active_since.{up,down}.sql` | `memberships.active_since timestamptz NULL` (expand) |
| 02 | `…/02_backfill_memberships_active_since.{up,down}.sql` | `active_since = created_at` where null |
| 03 | `…/03_add_conversations_list_columns.{up,down}.sql` | `conversations.last_activity_at`, `last_message_received_at`, `last_reply_sent_at` — all NULL (expand) |
| 04 | `…/04_backfill_conversations_list_columns.{up,down}.sql` | both times = newest `messages.received_at` (or `created_at`) |
| 05 | `…/05_create_replies.{up,down}.sql` | `replies` (+ unique `(conversation_id, client_key)`, body / state / reason / sent CHECKs, `replies_pending_idx`, `replies_conversation_id_position_at_idx`, `replies_workspace_id_sent_at_idx`, `replies_author_account_id_idx`) |
| 06 | `…/06_create_reply_attempts.{up,down}.sql` | `reply_attempts` (+ kind / initiator / outcome CHECKs and the four indexes) |
| 07 | `…/07_create_read_marks.{up,down}.sql` | `read_marks` (+ unique `(conversation_id, account_id)`, two FK indexes) |
| 08 | `…/08_add_messages_inbox_indexes.{up,down}.sql` | `messages_conversation_id_received_at_idx`, `messages_conversation_id_sent_at_idx` |

Key constraints the tests must hit:

| Column | Type | Constraints |
|---|---|---|
| `replies.client_key` | uuid | NOT NULL, UNIQUE (`conversation_id`, `client_key`) |
| `replies.body` | text | `CHECK (char_length(body) BETWEEN 1 AND 4096 AND body ~ '\S')` |
| `replies.state` | text | `CHECK IN ('sending','sent','not_delivered','not_confirmed')` |
| `replies.failure_reason` | text | non-null ⇔ `state = 'not_delivered'`; `customer_blocked`, `customer_account_gone`, `chat_not_found`, `bot_not_working`, `author_access_removed`, `telegram_not_accepted`, `delivery_interrupted` |
| `replies.sent_at` / `telegram_message_id` | timestamptz / bigint | non-null ⇔ `state = 'sent'` |
| `reply_attempts.initiated_by_account_id` | uuid | null ⇔ `kind = 'retry'` |
| `reply_attempts.outcome` | text | `CHECK IN ('accepted','refused','bot_unauthorized','not_accepted','unknown','skipped')`; `skipped` ⇔ finished without `started_at` |
| `read_marks` | — | UNIQUE (`conversation_id`, `account_id`) |

— `data-model.md §Entities + §Indexes, abridged` · full text: [data-model.md](../data-model.md)

New fixtures (`apps/api/src/test/fixtures/`): `insertReply`, `insertReplyAttempt`, `insertReadMark`, `twoWorkspacesWithInbox` — `data-model.md §Test fixtures, abridged`.

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" whose business bot has captured conversations with 30 end customers
> **When** they open the inbox
> **Then** the list shows those 30 conversations and nothing else — no sample data and no "Sample data" label — newest activity first (activity = a new customer message or a reply marked "sent"; a customer's edit, and a reply still sending or not delivered, do not move a conversation), each with the contact's name, the last message (a non-text message shown by its kind and caption, for example "Photo · new bouquet?"), how long ago it happened, how many customer messages this operator has not read (teammates' replies never count as unread; messages that arrived before the operator joined or was reactivated count as read), and a "waiting for a reply" marker when the customer wrote after the last reply marked "sent" — a reply that is sending, not confirmed or not delivered does not clear it; a business owner of "Acme Flowers" sees and does in the inbox everything an operator does
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — domain invariant

> **Given** an operator of "Acme Flowers" sending a reply
> **When** they press send twice quickly, lose their connection right after sending, or tg-inbox cannot learn whether Telegram accepted the reply
> **Then** the customer receives the reply at most once: a double press of one send sends one reply (two replies a member deliberately sends, even with the same text, are both sent); when the outcome is unknown the reply is marked "not confirmed — it may or may not have reached the customer" and is never resent automatically; the operator can send it again only after a warning that the customer may receive it twice — a reply is never delivered twice without a member choosing so
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — cross-context

> **Given** one person writes to the bots of both "Acme Flowers" and "Bolt Bikes", and an account is a member of both workspaces
> **When** that account opens the inbox of each workspace in turn
> **Then** each inbox shows only its own workspace's conversation with that person — only the messages sent to its own bot and the replies sent by its own team — and a reply sent from one workspace goes only through that workspace's bot, to that person's conversation with it; each inbox holds at most one conversation per end customer
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Confirm OQ-2 is still open (`delivery_interrupted` kept, as the contract and `screens.md` Decision 1 assume); promote `05` unchanged — `docs/features/shared-inbox/migrations/05_create_replies.up.sql`
- [ ] For ordinals 01–08 run `pnpm db:new <name>` in order, paste each staged `up`/`down` SQL inline with the `// Promoted from …` header — `apps/api/migrations/`
- [ ] `pnpm db:migrate`, `pnpm db:rollback` ×8, `pnpm db:migrate` — every `down` reverts cleanly
- [ ] `pnpm db:codegen`; commit `apps/api/src/platform/db.types.gen.ts` (never hand-edit)
- [ ] Add `insertReply`, `insertReplyAttempt`, `insertReadMark` and `twoWorkspacesWithInbox` (synthetic ids, `Test User`, `@example.test` only) — `apps/api/src/test/fixtures/conversations.ts`
- [ ] Extend `apps/api/src/test/migrations.int.test.ts` with every constraint case in *Edge cases* and the 01–08 revert/re-apply

## Edge cases

| Case | Behaviour |
|---|---|
| Second reply with the same (`conversation_id`, `client_key`) | unique violation — the `ON CONFLICT DO NOTHING` target of a double press (AC-11) |
| A blank (`'  \n'`) or 4097-character body | CHECK violation |
| `state = 'sent'` with null `sent_at` | CHECK violation |
| `state = 'not_delivered'` with null `failure_reason`, or `sending` with a reason | CHECK violation |
| `kind = 'retry'` with an initiator, or `send` without one | CHECK violation |
| A second read mark for one (conversation, account) | unique violation — the upsert target |
| Backfill on a conversation with messages | `last_activity_at = last_message_received_at = max(received_at)`, `last_reply_sent_at` null |

## Definition of Done

- [ ] migrations 01–08 are promoted to live `apps/api/migrations/`, then apply and revert cleanly on a fresh Postgres 16
- [ ] regenerated `db.types.gen.ts` compiles and is committed
- [ ] the extended migrations integration test passes every constraint case above
- [ ] the four new fixtures exist and `twoWorkspacesWithInbox` builds two isolated workspaces sharing one Telegram user
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
