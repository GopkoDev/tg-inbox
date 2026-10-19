---
id: T5
title: "Record the waiting period in conversations — set by capture, cleared by a sent reply and a close, restarted by a reopen while waiting — and promote migrations 01–03"
layer: "app"
deps: ["T1"]
blocks: ["T6"]
acs: ["AC-07", "AC-08"]
files_hint: ["docs/features/operator-notifications/migrations/01_add_conversations_waiting_period.up.sql", "docs/features/operator-notifications/migrations/02_backfill_conversations_waiting_period.up.sql", "docs/features/operator-notifications/migrations/03_add_conversations_waiting_index.up.sql", "apps/api/migrations/", "apps/api/src/platform/db.types.gen.ts", "apps/api/src/test/migrations.int.test.ts", "apps/api/src/test/fixtures/conversations.ts", "apps/api/src/modules/conversations/domain/waiting.ts", "apps/api/src/modules/conversations/infra/conversation-repo.ts", "apps/api/src/modules/conversations/app/conversations.ts", "apps/api/src/modules/conversations/app/replies.ts", "apps/api/src/modules/conversations/app/state-changes.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T5 — Record the waiting period in conversations — set by capture, cleared by a sent reply and a close, restarted by a reopen while waiting — and promote migrations 01–03

## Place in the sequence

- **Blocked by:** T1 — Promote migrations 04–08 (the bot send pause and the five notifications tables), regenerate DB types and add the test fixtures · **Blocks:** T6 — Add the conversations reads waitingForPings (period start, start kind, assignee, per-member read state) and attentionCount · **Wave:** 2 — after T1.
- **Lane:** shares `apps/api/migrations/`, `apps/api/src/platform/db.types.gen.ts`, `apps/api/src/test/migrations.int.test.ts` with T1 — serialized.

## Why (user story)

> **As an** Operator
> **I want** the business bot to ping me in Telegram when a customer of mine, or an unassigned one, has waited 5 minutes and I am away from the web
> **So that** no customer waits because I closed my laptop
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It gives every open waiting conversation the one period start that the ledger keys on and the 5- and 30-minute clocks run from.

## Inlined context

> **Chosen:** Option 1. The owner of the transitions records them where they happen, under the conversation row lock capture already takes. The period gets a stable identity (`waiting_since`) for the ledger's unique key, and the KPI becomes a simple query. The read stays a single-table, indexed scan.
>
> — `adr/0007-record-the-waiting-period-start-on-the-conversation-in-the-writing-transactions.md §Decision outcome, ADR-0007, verbatim` · full text: [ADR-0007](../adr/0007-record-the-waiting-period-start-on-the-conversation-in-the-writing-transactions.md)

> Capture sets them when a customer message arrives in a conversation that is not waiting (`message`, at its arrival time).
> A reply marked sent and a close clear them.
> A reopen while the customer is still waiting sets them to the reopen time (`reopen`): a member reopen over an unanswered message, or a reply that ends not delivered or not confirmed.
> A reassignment does not touch them, so the clock does not restart.
>
> — `sad.md §4, Supporting choices, waiting period, abridged` · full text: [sad.md](../sad.md)

> - Promote `01`–`03` with the `conversations` code that maintains the period: capture, settle, close, member reopen and failed-reply reopen (ADR-0007).
> - `02` touches only rows that are open, waiting and still NULL, so a re-run after deploying that code fills any row that changed in the gap. Under the new code an open waiting conversation always has a start, so the re-run is safe.
>
> — `_audit/data-model-2026-10-19.md §Ordering with code, 01–03, verbatim` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

> 6. **`conversations_waiting_open_check`** (`status = 'open' OR waiting_since IS NULL`) is added beyond the SAD. It is the DB's guard that a close ends the period.
>
> — `_audit/data-model-2026-10-19.md §Deviations, 6, verbatim` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

> | Time | Server clock (UTC) for every threshold. Waiting is measured from arrival in tg-inbox (`waiting_since`), not from Telegram send time, so a recovering bot's backlog starts fresh clocks instead of instant pings (spec §1 "ping storms"). | [ADR-0007](adr/0007-record-the-waiting-period-start-on-the-conversation-in-the-writing-transactions.md) |
>
> — `sad.md §8, Time, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Staged pairs promoted by this task (after T1's `04`–`08`; ordinal order kept inside the group):

- `docs/features/operator-notifications/migrations/01_add_conversations_waiting_period.{up,down}.sql` — expand
- `…/02_backfill_conversations_waiting_period.{up,down}.sql` — backfill (down is a no-op)
- `…/03_add_conversations_waiting_index.{up,down}.sql` — partial index

| Column | Type | Constraints | Change |
|---|---|---|---|
| `conversations.waiting_since` | timestamptz | NULL; NULL ⇔ `waiting_started_by` NULL; NULL when `status = 'closed'` (`conversations_waiting_open_check`) | added |
| `conversations.waiting_started_by` | text | NULL, `CHECK IN ('message','reopen')` | added |
| `conversations_workspace_id_waiting_since_idx` | `(workspace_id, waiting_since)` partial `waiting_since IS NOT NULL` | — | new index |

Backfill (data-model assumption 4): last end = later of `last_reply_sent_at` and the last `closed` entry; a member or failed-reply reopen after it starts a `reopen` period if a customer message was waiting; else the first customer arrival after the end starts a `message` period; closed and answered stay NULL — the ten audit shapes. Fixture: `insertConversation(db, { …, waitingSince?, waitingStartedBy? })`, both default `null`.

— `data-model.md §Entities conversations + Assumptions 4 + §Test fixtures, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface. Existing capture, `settle()`, close and reopen keep their contracts.

## Acceptance criteria

### AC-07 — happy path

> **Given** an operator of "Acme Flowers" with a Telegram link who is away from the web (no tab of theirs, on any device, has "Acme Flowers" open with a working live connection and on screen within the last 10 minutes), and an open conversation assigned to them in which the customer is waiting for a reply, with the message that started the wait still unread for them
> **When** 5 minutes pass since that message arrived in tg-inbox and nothing has ended the wait
> **Then** the "Acme Flowers" bot sends them one ping: "Acme Flowers: 1 customer is waiting for your reply (5 min)", with a link that opens that conversation in the panel. The ping contains no message text and no contact name. A conversation that is unassigned at that moment pings every linked member of "Acme Flowers" who is away and has not read the message. A member who is present on the web gets the in-web notifications instead (AC-01, AC-02) and no ping at that point. If they become away later while the customer is still waiting and the message is still unread for them, the ping goes out as soon as they are counted away. The 5 minutes always run from the start of the wait. For a waiting period that began when a conversation reopened (AC-08), the clock starts at the reopen. Having read the earlier messages does not hold such a ping back, because the customer's message was read and the team's reply did not reach them.
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — domain invariant

> **Given** a conversation of "Acme Flowers" for which a linked away member has been pinged
> **When** the customer writes more messages in the same waiting period, or other conversations become due for the same member within 10 minutes
> **Then** that member is pinged at most once per conversation per waiting period. Pings to one member from one workspace are at most one per 10 minutes. Conversations that become due in between are combined into the next ping, sent at the member's next allowed moment. A ping counts only the conversations not yet pinged to this member in their current waiting period, and the longest wait among them. If all of them are the member's own, it reads "Acme Flowers: 4 customers are waiting for your reply, the longest 12 min" and links to the inbox's "mine" lens. If all are unassigned, it says so and links to the "unassigned" lens. A mixed set reads "Acme Flowers: 4 customers are waiting for a reply (2 yours, 1 unassigned, 1 a teammate's), the longest 12 min" and links to the inbox's open conversations. A waiting period ends when a reply is marked sent or the conversation is closed. The next customer message after that starts a new one. A conversation that is reopened while its customer is still waiting for a reply also starts a new one at the moment it reopens, for example after a reply ends "not delivered" (assignment-statuses AC-08). A member who reads the waiting message before their ping is sent is not pinged for that period. A reassignment does not restart the clock. A new assignee who is away, linked and has not read the message becomes due at once if the customer has already waited 5 minutes. Unassigning a waiting conversation makes it due at once for the away members as an unassigned one. Each member still gets at most one ping per conversation per waiting period.
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Pure transitions `startOnMessage`, `endOnSentReply`, `endOnClose`, `restartOnReopen(waitingNow)` — `apps/api/src/modules/conversations/domain/waiting.ts` (+ `waiting.test.ts`)
- [ ] Capture transaction: set `waiting_since = arrival`, `started_by = 'message'` when not waiting (also on a reopening message); leave it while waiting — `apps/api/src/modules/conversations/infra/conversation-repo.ts`, `apps/api/src/modules/conversations/app/conversations.ts`
- [ ] `settle()`: a reply marked sent clears the period; a not-delivered / not-confirmed reopen while the customer waits restarts it as `reopen` — `apps/api/src/modules/conversations/app/replies.ts`
- [ ] Close clears it; a member reopen over an unanswered customer message restarts it as `reopen`; assign / unassign never touch it — `apps/api/src/modules/conversations/app/state-changes.ts`
- [ ] Promote `01`–`03`, run `pnpm db:codegen`, add the backfill-shape block (ten shapes) to the migrations test, add the two fixture fields — `apps/api/migrations/`, `apps/api/src/platform/db.types.gen.ts`, `apps/api/src/test/migrations.int.test.ts`, `apps/api/src/test/fixtures/conversations.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Second customer message while waiting | `waiting_since` unchanged |
| Customer message reopens a closed conversation | period starts at its arrival, `message` |
| Member reopens when the last reply was sent after the last customer message | stays NULL (not waiting) |
| Reply ends not delivered in a closed conversation with an unanswered message | reopened, period restarts at the reopen time, `reopen` |
| Late redelivery with an earlier Telegram date | period start is the arrival in tg-inbox, not the Telegram date |

## Definition of Done

- [ ] Unit and integration tests prove capture starts a message period only when not waiting, a sent reply and a close clear it, a member reopen or a failed-reply reopen over a waiting customer restarts it as reopen, assignee changes leave it, migrations 01–03 apply, backfill the ten audit shapes and revert cleanly, and the waiting-open CHECK never fires on any existing path.
- [ ] staged migrations 01–03 are promoted to live `apps/api/migrations/`, then apply and revert cleanly
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
