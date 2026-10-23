---
id: T15
title: "Build the broadcasts recipient repository: the launch insert by unnest with positions, the conditional claim, outcome writes, back to waiting, stale in-flight resolution, settling waiting recipients, totals, the report page, the next waiting recipient and the duplicate sets, with isolation tests"
layer: "infra"
deps: ["T3"]
blocks: ["T17", "T19", "T21", "T23"]
acs: ["AC-06", "AC-11", "AC-13", "AC-18"]
files_hint: ["apps/api/src/modules/broadcasts/infra/recipient-repo.ts", "apps/api/src/modules/broadcasts/infra/recipient-repo.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T15 — Build the broadcasts recipient repository: the launch insert by unnest with positions, the conditional claim, outcome writes, back to waiting, stale in-flight resolution, settling waiting recipients, totals, the report page, the next waiting recipient and the duplicate sets, with isolation tests

## Place in the sequence

- **Blocked by:** T3 — Promote migrations 03–08 (the conversations (workspace_id, id) key, broadcasts, broadcast_audience_tags, broadcast_group_contacts, broadcast_recipients, broadcast_items), regenerate DB types and add the broadcast fixtures · **Blocks:** T17 — Add the broadcasts reads: the list with each draft's audience size, one broadcast as a draft with its breakdown for the current bot or as a launched broadcast with its frozen audience and totals, the recipients page, and itemDetails for the inbox thread, T19 — Add the launch confirmation read, which is also the pre-check: owner only, a working bot, a non-empty text, at most 10 000, at least one reachable contact and the 10-per-24-hours cap, answering the trimmed text, version, breakdown and fingerprint, T21 — Add stop and the settling transaction: a business owner stops a sending broadcast (waiting → stopped), an abort fails the waiting recipients with text_refused or bot_stopped, a finish marks sent, and every ending queues the 48-hour blocked-share measure, T23 — Add duplicate: any member copies any broadcast into a new draft named "Copy of …" within 80, a draft with its audience, a launched one as the same tags, all recipients or only the recipients it did not reach once ended · **Wave:** 3 — after T3.
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to follow a launched broadcast's progress and see for each recipient whether it was delivered, failed (and why) or could not arrive because they blocked the bot
> **So that** I know how many customers it really reached and whom it did not
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It stores the frozen recipient list and each recipient's single claim and outcome, which is what makes a broadcast at most once per recipient and its report honest.

## Inlined context

> **Chosen:** Option 1. The claim commits before the Telegram call, so no recipient can be sent twice: a recipient that is not `waiting` is never claimed again, and one left `sending` by a crash becomes not confirmed. […]
>
> — `adr/0007 §Decision outcome, ADR-0007, abridged` · full text: [ADR-0007](../adr/0007-send-through-a-per-workspace-pg-boss-chain-that-claims-each-recipient-before-its-send.md)

> **Chosen:** Option 1. A row-level race decides each recipient exactly once: either the claim wins (the send was already decided and finishes) or the settle wins (it is never claimed). That gives "no new send after the stop" at the commit, far inside 2 s, with no polling.
>
> — `adr/0009 §Decision outcome, ADR-0009, abridged` · full text: [ADR-0009](../adr/0009-end-stop-or-abort-a-broadcast-by-settling-every-waiting-recipient-in-one-transaction.md)

> 6. **Recipients have a `position`** (1…n, unique per broadcast) in the fingerprint's order (by contact id). It is the send order and the report's keyset (sequences flag). Turns between broadcasts are the sender's in-memory round-robin, not a column.
> 7. **`claimed_at` is the current attempt's claim time.** A rate limit puts a recipient back to `waiting` with `claimed_at` NULL. A not confirmed recipient keeps it, and its item sits there (AC-16).
>
> — `data-model.md §Assumptions, 6–7, verbatim` · full text: [data-model.md](../data-model.md)

> - **The launch inserts up to 10 000 recipients with app-generated UUIDv7 ids**: use one `INSERT … SELECT … FROM unnest($ids, $contact_ids, $positions, $user_ids)`, not 10 000 statements (measured above at ~300 ms with a join).
> - **Recipient position** = rank of the contact id in the sorted reachable set, the same sort as the fingerprint (ADR-0006), so the fingerprint and the positions come from one ordered read.
>
> — `_audit/data-model-2026-10-23.md §Code-level findings, verbatim` · full text: [audit](../_audit/data-model-2026-10-23.md)

> "only recipients it did not reach" (outcomes `failed` with reason `bot_stopped`, `text_refused` or `telegram_error`, plus `stopped`, plus `not_confirmed` only when the request carries `include_not_confirmed`)
>
> — `sad.md §4, Supporting choices, Duplicates, abridged` · full text: [sad.md](../sad.md)

> **Aggregate root:** `broadcasts`. Inserted only by the launch; never inserted or deleted afterwards (spec §6 frozen recipients).
>
> — `data-model.md §Entities, broadcast_recipients, verbatim` · full text: [data-model.md](../data-model.md)

> **Claim:** one recipient row (conditional update). **Outcome:** recipient row → broadcast item insert […] → signal.
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
| `id` | uuid | PK (UUIDv7, generated by the launch) | written at launch |
| `workspace_id`, `broadcast_id` | uuid | NOT NULL; composite FK → `broadcasts` | written at launch |
| `contact_id` | uuid | composite FK → `contacts`; UNIQUE `(workspace_id, broadcast_id, contact_id)` | written at launch |
| `position` | integer | `>= 1`; UNIQUE `(workspace_id, broadcast_id, position)` | written at launch |
| `telegram_user_id` | bigint | NOT NULL | written at launch |
| `state` | text | `CHECK IN ('waiting','sending','delivered','blocked','failed','not_confirmed','stopped')` | claim / outcome / settle |
| `failure_reason` | text | `CHECK IN ('account_gone','chat_not_found','telegram_error','text_refused','bot_stopped')`; non-null ⇔ `failed` | outcome / settle |
| `claimed_at` | timestamptz | non-null for `sending` / `delivered` / `not_confirmed`; NULL for `waiting` / `stopped` | claim / back to waiting |
| `outcome_at` | timestamptz | NULL ⇔ `waiting` / `sending` | outcome / settle |
| `telegram_message_id` | bigint | non-null ⇔ `delivered` | outcome |

Indexes used: `broadcast_recipients_pkey`, `_broadcast_contact_key`, `_broadcast_position_key`, `_state_position_idx (workspace_id, broadcast_id, state, position)`. Table promoted by T3.

— `data-model.md §Entities, broadcast_recipients + §Indexes, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface (the repository behind `broadcasts/app/ports.ts`; its totals and page back `getBroadcast` / `listBroadcastRecipients` in T17).

## Acceptance criteria

### AC-06 — happy path

> **Given** a business owner of "Acme Flowers" with the draft "Spring prices" whose audience would reach 36 contacts, and a working bot
> **When** they choose to launch it
> **Then** a confirmation shows the exact text as the customer will see it, the number of contacts it will be sent to (36), how many are left out because they blocked the bot or never wrote to the current bot (2), and a warning that customers who did not expect the message can block or report the bot, which can limit the bot for support too; on confirmation the recipient list is fixed to exactly the 36 contacts counted in the confirmation, the broadcast becomes "sending" for every member, records who launched it and when, and sending starts; if between opening the confirmation and confirming it the text, the audience or the set of contacts it would reach changed (even if their number is the same), nothing is launched and the owner is shown the current version and number to confirm again; choosing launch twice, or two business owners launching the same draft at the same moment, launches it once and sends each recipient one message
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — happy path

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 36 recipients, 1 of whom has since blocked the bot and 1 of whom deleted their Telegram account
> **When** a business owner or an operator opens it while it sends and after it ends
> **Then** the page shows the text, the audience as it was defined, who launched it and when, and the delivery report: totals of waiting, delivered, blocked the bot and failed, which change live without reloading, and each recipient with their outcome and time (failed with a plain reason such as "account no longer exists" or "not confirmed — Telegram did not answer, not sent again"); the recipient who blocked the bot is shown as blocked and the contact is marked as having blocked the bot (a recipient already marked as blocked when their turn comes is not sent it and gets that outcome; one who unblocked before their turn is sent it); a send Telegram refuses for any reason other than a rate limit or a block ends that recipient as failed with its reason and is not tried again; when every recipient has an outcome the broadcast becomes "sent" with its finish time; if the service restarts while sending, sending continues with the recipients still waiting, no recipient who already has an outcome is sent the broadcast again, and a send that was in flight when the service stopped ends as "not confirmed"; a recipient whose send got no answer from Telegram is never sent it again automatically
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — happy path

> **Given** "Acme Flowers" with a draft "Wholesale catch-up" (a group of 14 contacts) and the sent broadcast "Spring prices" (tag audience; 33 delivered, 1 blocked the bot, 2 failed because the bot stopped working)
> **When** an operator duplicates the draft, and duplicates "Spring prices" choosing first "all recipients" and then "only recipients it did not reach"
> **Then** each duplicate is a new draft named "Copy of …" (shortened to fit 80 characters) with the same text, listed for every member, its author being the member who duplicated it, and the original is unchanged; the copy of the draft has the same group of 14 contacts; the copy of "Spring prices" with "all recipients" has a broadcast group of its 36 recipients, the one who blocked the bot counted as unreachable; "only recipients it did not reach" is offered once a broadcast has ended, and gives a group of the 2 who failed: it copies recipients who failed for a reason a new attempt can fix (the bot stopped working, Telegram refused the text, a Telegram error, stopped before their turn) and those marked "not confirmed" only after a warning that they may have received it, while recipients who were delivered, who blocked the bot or whose account no longer exists are not copied; a tag audience can also be duplicated as the same tags, evaluated again at the copy's launch; the copy is then edited and launched like any draft
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — error

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 3 000 recipients, 1 200 of whom already have an outcome
> **When** a business owner chooses to stop it and confirms; or an operator looks for a way to stop it; or the owner chooses stop at the moment the last recipient gets an outcome
> **Then** after the owner confirms (the confirmation says how many recipients are still waiting and that a stop cannot be undone), no new send of it starts; a send already in flight finishes and its outcome is recorded as usual; every recipient still waiting is marked "not sent — stopped" and the broadcast becomes "stopped" for every member, with who stopped it and when, and the report keeps every outcome recorded before; nothing of it is ever sent later; the stopped broadcast stays read-only and can be duplicated, its stopped recipients included in "only recipients it did not reach" (AC-13); an operator sees no stop action and cannot stop it in any other way; a stop that arrives after every recipient has an outcome changes nothing and the broadcast stays "sent"
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Failing integration tests first, each method also run with a foreign workspace id (isolation) — `apps/api/src/modules/broadcasts/infra/recipient-repo.int.test.ts`
- [ ] `insertAll(ws, broadcastId, rows[{ id, contactId, position, telegramUserId }], tx)` in one `INSERT … SELECT … FROM unnest(…)` — `apps/api/src/modules/broadcasts/infra/recipient-repo.ts`
- [ ] `claim(ws, id, at)` = `UPDATE … SET state = 'sending', claimed_at = $at WHERE id = $1 AND workspace_id = $ws AND state = 'waiting'` → claimed or not — same file
- [ ] `recordOutcome(ws, id, { state, reason?, at, messageId? }, tx)` only from `sending` (or from `waiting` for a blocked-at-turn outcome); `backToWaiting(ws, id, tx)` clearing `claimed_at` — same file
- [ ] `resolveStaleInFlight(ws, broadcastIds, at, tx)` → `sending` → `not_confirmed` keeping `claimed_at`, returning `(id, contact_id, claimed_at)` for the items — same file
- [ ] `settleWaiting(ws, broadcastId, { state: 'stopped' } | { state: 'failed', reason }, at, tx)` → count — same file
- [ ] Reads: `totals(ws, broadcastId)` grouped by state, `page(ws, broadcastId, { after?, state? }, 50)` by position, `nextWaiting(ws, broadcastId)` lowest position, `hasWaitingOrInFlight`, `allContactIds`, `notReachedContactIds(ws, broadcastId, includeNotConfirmed)`, `deliveredContactIds` for the blocked share — same file
- [ ] Tests: 10 000 rows inserted in one statement; two concurrent claims → exactly one wins; settle touches only `waiting`; did-not-reach set excludes `delivered`, `blocked`, `account_gone`, `chat_not_found`

## Edge cases

| Case | Behaviour |
|---|---|
| claim of a row not `waiting` (settled, already sent) | no update → never sent again (AC-11, AC-18) |
| two claimers race | exactly one gets the row |
| rate limit after the claim | back to `waiting`, `claimed_at` NULL (data-model assumption 7) |
| row left `sending` by a dead link | `not_confirmed`, keeps `claimed_at` (AC-11, AC-16) |
| stop while some rows are `sending` | only `waiting` rows become `stopped`; in-flight ones record their own outcome (AC-18) |
| `failed` without a reason | refused by the CHECK |
| "did not reach" with `include_not_confirmed` false | `not_confirmed` rows left out (AC-13) |

## Definition of Done

- [ ] Integration tests prove 10 000 recipients insert in one unnest statement with positions 1…n, the claim updates a waiting row only once under two concurrent claimers, an outcome sets its state, reason, time and message id, a rate-limited recipient returns to waiting with claimed_at cleared, sending rows become not_confirmed keeping claimed_at, settling turns only waiting rows into stopped or failed with the reason, totals group by state, the page follows position with an optional state filter, the next waiting recipient is the lowest position, the "did not reach" set holds exactly the fixable reasons plus stopped (plus not_confirmed when asked), and every method is scoped by workspace.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
