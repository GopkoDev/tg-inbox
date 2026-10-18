---
id: T8
title: "Reopen a closed conversation on a newly captured customer message, raise the customer message counter under the row lock, and promote contract migration 05"
layer: "app"
deps: ["T1", "T7"]
blocks: ["T15"]
acs: ["AC-06", "AC-07"]
files_hint: ["apps/api/src/modules/conversations/app/conversations.ts", "apps/api/src/modules/conversations/app/conversations.test.ts", "apps/api/src/modules/conversations/app/conversations.int.test.ts", "apps/api/src/modules/conversations/infra/conversation-repo.ts", "docs/features/assignment-statuses/migrations/05_contract_conversations_state_columns.up.sql", "apps/api/migrations/", "apps/api/src/platform/db.types.gen.ts", "apps/api/src/test/migrations.int.test.ts", "apps/api/src/test/fixtures/conversations.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T8 — Reopen a closed conversation on a newly captured customer message, raise the customer message counter under the row lock, and promote contract migration 05

## Place in the sequence

- **Blocked by:** T1 — Promote the expand, backfill, activity-table and lens-index migrations 01–04, regenerate DB types and extend the test fixtures, T7 — Add the changeAssignee and changeStatus use cases in conversations: version guard, close reasons against the snapshot, the per-member change limit, the write, the activity entry and its signal · **Blocks:** T15 — Add the API end-to-end assignment stories, the integrity checks, and the secrecy and log assertions for the new responses and frames · **Wave:** 4 — after T1, T7.
- **Lane:** shares `conversation-repo.ts` with T6 / T10 and `apps/api/migrations/`, `db.types.gen.ts`, fixtures with T1 — serialized after T1 and T7.

## Why (user story)

> **As an** End customer
> **I want** my new message to a business to reach the team even if they had closed our conversation
> **So that** I get an answer whenever I write again
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It makes a customer's new message always bring a closed conversation back to the team, in the same transaction that captures it.

## Inlined context

> Today its upsert is `ON CONFLICT DO NOTHING` plus a plain read, which takes no lock. The raise is an `UPDATE`, and it now also raises the customer message counter. That `UPDATE` **returns the status and assignee under its row lock**, and capture decides on that locked result, never on the earlier read. When the message is newly captured (not a duplicate, not an edit) and the status is closed, the same transaction:
> - reopens the conversation and keeps the assignee;
> - raises the version;
> - inserts the activity entry "reopened — the customer wrote";
> - publishes the signal.
>
> — `sad.md §4, choice 4 Capture, verbatim` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. A database trigger is excluded by the repo rules (no triggers) and was not weighed. Only an in-transaction reopen makes "0 closed conversations with a later arrival" true at every moment, and it adds no queue latency.
>
> — `adr/0004 §Decision outcome, verbatim` · full text: [ADR-0004](../adr/0004-reopen-closed-conversations-inside-the-capture-and-reply-outcome-transactions.md)

> | Capture's upsert takes no lock today, and the reopen decision must read status only from the locked raise `UPDATE`. Reading it from the upsert would reintroduce the lost-customer race. | Medium | Specified in ADR-0004. Covered by the concurrent close-versus-capture test in §10 QG-1 (c). | Tech Lead |
>
> — `sad.md §11, Risks, verbatim` · full text: [sad.md](../sad.md)

> - (b) capture a message between the refusal and close-anyway, including one whose arrival timestamp is not later than the current one (concurrent webhook connections): refused again, because the counter grew;
> - (c) a close and a capture racing on one conversation, run concurrently many times, then the integrity query returns no row;
> - (e) a capture into a closed conversation […]: each reopens with the right activity entry;
> - (f) a duplicate redelivery and an edit: no reopen;
>
> — `sad.md §10, QG-1 How verify, abridged` · full text: [sad.md](../sad.md)

> - `05` must not run before the code that writes the three columns: `conversation-repo.ts` capture insert (`status 'open'`, `state_version 0`, `customer_message_seq 0`), the capture raise of the counter, and the change paths. The `insertConversation` fixture must change in the same task, or existing integration tests fail the NOT NULL.
> - No production deployment exists yet […], so all five may promote in one release, provided `05` lands in the same task or PR as that code.
>
> — `_audit/data-model-2026-10-18.md §Ordering with code, abridged` · full text: [data-model audit](../_audit/data-model-2026-10-18.md)

> **Member change:** (1) memberships `FOR SHARE`; (2) the conversation row `FOR UPDATE`; (3) the `changes:<ws>:<account>` advisory lock, after the no-op, version and close checks; (4) the activity insert.
> **Deactivation:** (1) the workspace row `FOR UPDATE`; (2) the membership `UPDATE`, whose row lock conflicts with `FOR SHARE`; (3) the conversation rows assigned to the member (`UPDATE`); (4) activity inserts.
> **Capture:** contact upsert and message insert (unique key), then the conversation row (the raise `UPDATE`, returning status).
> **Reply outcome** (`settle()`): the `drain:` advisory lock and the reply / attempt rows, then the conversation row.
>
> — `sad.md §8, Concurrency, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Column | Type | Constraints | Change |
|---|---|---|---|
| `conversations.status` | text | **NOT NULL** (this task promotes `05`) | capture inserts `'open'`; reopen sets `'open'` |
| `conversations.state_version` | integer | **NOT NULL** | insert 0; reopen raises by one |
| `conversations.customer_message_seq` | integer | **NOT NULL** | insert 0; raised by one in the arrival-raise `UPDATE` for every newly captured customer message |
| `conversation_activities` | — | — | insert `reopened` / `customer_wrote`, no actor, `position_at` = capture time, never before the latest entry |

Staged pair promoted here: `docs/features/assignment-statuses/migrations/05_contract_conversations_state_columns.{up,down}.sql` (`SET NOT NULL` / `DROP NOT NULL` on the three columns; `assignee_account_id` stays nullable).

— `data-model.md §conversations + migrations/05, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no new operation. Capture is bot-connection's `receiveTelegramUpdate` (unchanged); the reopen publishes `created`/`message` **and** `created`/`activity` frames in one transaction — `contracts/events.md, Panel reaction, abridged`.

## Acceptance criteria

### AC-06 — domain invariant

> **Given** an operator of "Acme Flowers" about to close a conversation
> **When** its customer is still waiting for a reply, or a customer message arrived after the operator's own arrival watermark (they have not read it — a thread in a background tab marks nothing read)
> **Then** before closing the inbox shows why — the customer is waiting for a reply, the newest message the operator has not read, or the conversation's latest reply was "not delivered" / "not confirmed" — and asks whether to close anyway or keep it open; the conversation is closed only if the operator confirms; the condition is checked again at the moment the close is recorded, so a customer message recorded between the question and the close asks again — a customer is never put out of sight by a close made over a message the closer had not read; a customer message recorded after the close reopens it (AC-07)
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-07 — cross-context

> **Given** a closed conversation of "Acme Flowers" assigned to an operator
> **When** its end customer sends a new message to the business bot
> **Then** the conversation opens again and returns to the open lenses for the whole team without reloading, with the same assignee (an assignee is always an active member — AC-10), the thread records "reopened — the customer wrote" with the time, and the message counts as unread and as waiting for a reply exactly as for an open conversation; this holds for a customer message that arrives late and takes an earlier place in the history (a late redelivery) — it reopens by its arrival, the message keeps its earlier place, and the "reopened" line sits at the time it arrived; an edit of an earlier message does not reopen
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Capture's conversation insert writes `status 'open'`, `state_version 0`, `customer_message_seq 0` — `conversations/infra/conversation-repo.ts`
- [ ] `raiseReceived` also raises `customer_message_seq` and `RETURNING status, assignee_account_id, state_version` — only for a newly captured message (not a duplicate, not an edit) — `conversation-repo.ts`
- [ ] In `captureInbound`, on locked status `closed`: `recordChange(tx, reopen, cause 'customer_wrote', no actor)` (T7), keep the assignee — `conversations/app/conversations.ts`
- [ ] Promote `05` as the next TS migration; `pnpm db:migrate` → `pnpm db:codegen` (three columns non-null); extend the migrations block (NULL status rejected after contract; revert + re-apply) — `apps/api/migrations/`, `db.types.gen.ts`, `migrations.int.test.ts`
- [ ] Unit + integration tests: reopen with assignee kept, late redelivery keeps its message place while the line sits at arrival, duplicate / edit no reopen, QG-1 (b) and (c) with the integrity query — `conversations.test.ts`, `conversations.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Duplicate redelivery of a message into a closed conversation | nothing moves, stays closed, no counter raise |
| Edit of an earlier message in a closed conversation | text replaced, stays closed (AC-07) |
| Late redelivery (earlier `sent_at`) | message at its earlier place; `reopened` line at its arrival; unread and waiting as for an open conversation |
| Capture waits on a close holding the row lock | after the close commits, capture sees `closed` and reopens |
| Capture transaction fails | rolled back, not acknowledged; Telegram redelivers; the unique key keeps the reopen single |

## Definition of Done

- [ ] Integration tests prove a new message into a closed conversation reopens it with the same assignee, one reopened/customer_wrote entry at its arrival and its signal; a duplicate and an edit do not; QG-1 (b) and (c) hold with the integrity query returning no row; and migration 05 is promoted, applies and reverts cleanly with every capture insert writing the three columns.
- [ ] staged migration `05` is promoted to live `apps/api/migrations/`, then applies and reverts cleanly
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
