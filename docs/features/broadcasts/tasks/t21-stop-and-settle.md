---
id: T21
title: "Add stop and the settling transaction: a business owner stops a sending broadcast (waiting → stopped), an abort fails the waiting recipients with text_refused or bot_stopped, a finish marks sent, and every ending queues the 48-hour blocked-share measure"
layer: "app"
deps: ["T6", "T15", "T16"]
blocks: ["T22"]
acs: ["AC-11", "AC-12", "AC-18"]
files_hint: ["apps/api/src/modules/broadcasts/app/stop.ts", "apps/api/src/modules/broadcasts/app/stop.test.ts", "apps/api/src/modules/broadcasts/app/stop.int.test.ts", "apps/api/src/modules/broadcasts/app/settle.ts", "apps/api/src/modules/broadcasts/app/settle.test.ts", "apps/api/src/modules/broadcasts/app/ports.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T21 — Add stop and the settling transaction: a business owner stops a sending broadcast (waiting → stopped), an abort fails the waiting recipients with text_refused or bot_stopped, a finish marks sent, and every ending queues the 48-hour blocked-share measure

## Place in the sequence

- **Blocked by:** T6 — Add the broadcasts domain for sending and copies: recipient states and failure reasons, the bots answer → outcome map with its abort kinds, the fixable set, the pace constants and the round-robin turn picker, and the duplicate audience choices, T15 — Build the broadcasts recipient repository: the launch insert by unnest with positions, the conditional claim, outcome writes, back to waiting, stale in-flight resolution, settling waiting recipients, totals, the report page, the next waiting recipient and the duplicate sets, with isolation tests, T16 — Add the broadcasts draft use cases: ports, the broadcast.changed publisher, create, save name and text against the version, save the tag audience or switch the kind against the confirmed group size, and delete by the author or a business owner · **Blocks:** T22 — Add one link of the sending chain: resolve stale in-flight recipients as not confirmed with their items, serve the sending broadcasts in turns with at most 8 sends in flight for at most 20 s, check the block at each turn, claim before the send, record each outcome with its broadcast item and a coalesced report signal, abort or finish, and decide the successor · **Wave:** 5 — after T6, T15, T16.
- **Lane:** shares `apps/api/src/modules/broadcasts/app/ports.ts` with T16; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T17; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T18; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T19; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T20; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T22; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T23 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to follow a launched broadcast's progress and see for each recipient whether it was delivered, failed (and why) or could not arrive because they blocked the bot
> **So that** I know how many customers it really reached and whom it did not
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It gives a business owner the brake for a sending broadcast and gives every broadcast an honest end — stopped, aborted with a plain reason, or sent — in one transaction that no new send can slip past.

## Inlined context

> The claim is a conditional single-row update (`waiting → sending`), so the stop's commit is the moment after which no send of that broadcast can start (spec §6: 0 sends started more than 2 s after the stop).
>
> — `sad.md §6, Critical flow 4, verbatim` · full text: [sad.md](../sad.md)

> Under the broadcast row lock (ADR-0009), a refused text fails every waiting recipient with "Telegram refused the text", and a bot that is not working, disconnected or replaced (both `bots` answers) fails them with "the bot stopped working". Either way the broadcast becomes "sent" with its finish time and end reason, in one bulk update (AC-12). A broadcast with nothing waiting and nothing in flight becomes "sent" (AC-11). A broadcast that was stopped meanwhile is left alone. An ending queues the 48-hour blocked-share measurement and signals every tab. Sends already in flight finish and record their outcome.
>
> — `sad.md §6, flow 13, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. A row-level race decides each recipient exactly once: either the claim wins (the send was already decided and finishes) or the settle wins (it is never claimed). That gives "no new send after the stop" at the commit, far inside 2 s, with no polling. Telegram's answer decides whether a failure belongs to one recipient or to the text, so a bad chat never ends a broadcast and a refused text never fails thousands one by one.
>
> — `adr/0009-end-stop-or-abort-a-broadcast-by-settling-every-waiting-recipient-in-one-transaction.md §Decision outcome, ADR-0009, verbatim` · full text: [ADR-0009](../adr/0009-end-stop-or-abort-a-broadcast-by-settling-every-waiting-recipient-in-one-transaction.md)

> **Stop / delete by an owner:** memberships `FOR SHARE` → broadcast row. **Draft and group writes, abort, finish:** broadcast row `FOR NO KEY UPDATE` → its tag / group / recipient rows.
>
> — `sad.md §8, Lock order, abridged` · full text: [sad.md](../sad.md)

> 9. **`end_reason`** (`completed`, `text_refused`, `bot_stopped`, `stopped`) is stored, so the report and the run book tell a finished broadcast from an aborted one. `ended_at` is set for `sent` and for `stopped`. A stopped broadcast's in-flight sends still record their outcomes after `ended_at`.
>
> — `data-model.md §Assumptions, 9, verbatim` · full text: [data-model.md](../data-model.md)

> - **Producer:** the transaction that ends a broadcast (finish, abort or stop), `startAfter` 48 h, `singletonKey` = `broadcast_id` (one per broadcast).
>
> — `contracts/events.md §Job: broadcasts.measure-blocked-share, abridged` · full text: [events.md](../contracts/events.md)

> | `broadcast.ended` | `workspace_id`, `broadcast_id`, `end_reason`, counts by state and reason, launch-to-finish ms | finish / abort / stop transaction, after commit | metrics; "Duplicates sent" integrity query (spec §7) |
>
> — `contracts/events.md §Log events, verbatim` · full text: [events.md](../contracts/events.md)

> | Stop takes effect | 0 sends of a broadcast started more than 2 s after its stop was confirmed (AC-18) | send timing log against the stop time; integration test stopping mid-send against the fake Telegram |
>
> — `spec.md §6, NFR, verbatim` · full text: [spec.md](../spec.md)

> **Hard rule (Authorization):** Roles: any active member lists, reads, creates, edits, duplicates, adds to / removes from groups; the draft author or a business owner deletes a draft; only a business owner launches and stops, re-checked under `workspaces.lockActiveMembers` (`FOR SHARE`) inside the action's transaction. Foreign ids answer 404 (`NotFoundError`) with no hint
>
> — `sad.md §8, Authentication / authorization, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Writes, through T14 / T15:

| Table | Columns | Rule |
|---|---|---|
| `broadcast_recipients` | `state` `waiting` → `stopped` (stop) or `failed` + `failure_reason` `text_refused` / `bot_stopped` (abort); `outcome_at` | only `waiting` rows; `sending` rows are left to finish |
| `broadcasts` | `status` `sent` / `stopped`, `ended_at`, `end_reason`, `stopped_at`, `stopped_by_account_id`, `last_changed_*` | `stopped_*` ⇔ `stopped`; `end_reason = 'stopped'` ⇔ status stopped |

— `data-model.md §Entities, broadcasts / broadcast_recipients, abridged` · full text: [data-model.md](../data-model.md)

## API contract

- `POST …/broadcasts/{broadcastId}/stop` → `200 BroadcastStopped { outcome: stopped | unchanged, broadcast }` · `403 ACCESS_REMOVED` / `403 OWNER_ONLY` · `404`. `unchanged` when nothing is waiting, it already ended or stopped, or it is a draft.
- Internal (settle, used by T22): `abort(ws, broadcastId, reason: text_refused | bot_stopped)` and `finishIfDone(ws, broadcastId)`.
- Every ending, in its transaction: `broadcast.changed { change: status }` and `broadcasts.measure-blocked-share { workspace_id, broadcast_id }` (`startAfter` 48 h, `singletonKey` = broadcast id); after commit the `broadcast.ended` log line.

— `contracts/openapi.yaml, operationId stopBroadcast, abridged`; `contracts/events.md §pg-boss queues, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-11 — happy path

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 36 recipients, 1 of whom has since blocked the bot and 1 of whom deleted their Telegram account
> **When** a business owner or an operator opens it while it sends and after it ends
> **Then** the page shows the text, the audience as it was defined, who launched it and when, and the delivery report: totals of waiting, delivered, blocked the bot and failed, which change live without reloading, and each recipient with their outcome and time (failed with a plain reason such as "account no longer exists" or "not confirmed — Telegram did not answer, not sent again"); the recipient who blocked the bot is shown as blocked and the contact is marked as having blocked the bot (a recipient already marked as blocked when their turn comes is not sent it and gets that outcome; one who unblocked before their turn is sent it); a send Telegram refuses for any reason other than a rate limit or a block ends that recipient as failed with its reason and is not tried again; when every recipient has an outcome the broadcast becomes "sent" with its finish time; if the service restarts while sending, sending continues with the recipients still waiting, no recipient who already has an outcome is sent the broadcast again, and a send that was in flight when the service stopped ends as "not confirmed"; a recipient whose send got no answer from Telegram is never sent it again automatically
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — error

> **Given** the broadcast "Spring prices" of "Acme Flowers" while it is sending
> **When** Telegram refuses the text itself, or the bot stops working (its token is revoked) or is disconnected or replaced by another bot
> **Then** sending ends at once: every recipient still waiting is marked failed with the plain reason ("Telegram refused the text" or "the bot stopped working"), the broadcast becomes "sent" with the report showing who got it before that, and nothing of it is sent later when the bot works again or by a newly connected bot; the owner can duplicate it, fix the text or the bot, and launch the copy to the recipients it did not reach (AC-13)
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — error

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 3 000 recipients, 1 200 of whom already have an outcome
> **When** a business owner chooses to stop it and confirms; or an operator looks for a way to stop it; or the owner chooses stop at the moment the last recipient gets an outcome
> **Then** after the owner confirms (the confirmation says how many recipients are still waiting and that a stop cannot be undone), no new send of it starts; a send already in flight finishes and its outcome is recorded as usual; every recipient still waiting is marked "not sent — stopped" and the broadcast becomes "stopped" for every member, with who stopped it and when, and the report keeps every outcome recorded before; nothing of it is ever sent later; the stopped broadcast stays read-only and can be duplicated, its stopped recipients included in "only recipients it did not reach" (AC-13); an operator sees no stop action and cannot stop it in any other way; a stop that arrives after every recipient has an outcome changes nothing and the broadcast stays "sent"
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [x] Add `jobs.enqueueBlockedShare(tx, ws, broadcastId, startAfter)` to the ports — `apps/api/src/modules/broadcasts/app/ports.ts`
- [x] RED: unit tests for settle (stop, abort per reason, finish only with nothing waiting or sending, a stopped broadcast left alone) — `apps/api/src/modules/broadcasts/app/settle.test.ts`
- [x] `settle.ts`: `stopWaiting`, `abort`, `finishIfDone` under the broadcast row lock, using T6's end reasons, signal + job in the transaction, log after commit — `apps/api/src/modules/broadcasts/app/settle.ts`
- [x] RED: unit tests for `stopBroadcast` (operator, deactivated owner, unchanged cases) — `apps/api/src/modules/broadcasts/app/stop.test.ts`
- [x] `stopBroadcast`: memberships `FOR SHARE` → row → `stopWaiting` — `apps/api/src/modules/broadcasts/app/stop.ts`
- [x] Integration tests: a claim racing the stop (either the claim or the settle wins, never both); 1 200 settled + rest stopped on the AC-18 seed; stop after the last outcome → `unchanged`, status `sent`; one measure job per broadcast — `apps/api/src/modules/broadcasts/app/stop.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| operator calls stop | `403 OWNER_ONLY`, nothing changes (AC-18) |
| stop arrives after every recipient has an outcome | `200 unchanged`, status `sent` (AC-18) |
| a send in flight at the stop | finishes and records its outcome after `ended_at` (AC-18) |
| claim and stop race on one recipient | exactly one wins; a settled recipient is never claimed (ADR-0009) |
| abort while a stop already committed | the stopped broadcast is left alone |
| abort with `bot_unavailable` or `bot_changed` | waiting recipients fail with `bot_stopped` (AC-12) |
| a second stop | `200 unchanged`, no second signal or job |

## Definition of Done

- [x] Unit and integration tests prove a stop by an operator is OWNER_ONLY, a stop by an owner marks every waiting recipient stopped and the broadcast stopped with who and when in one transaction while sending recipients keep their claim, a stop after the last outcome answers unchanged, an abort marks the waiting recipients failed with the plain reason and the broadcast sent with its end reason, a finish with nothing waiting or in flight marks it sent with completed, a stopped broadcast is never finished or aborted afterwards, and each ending publishes broadcast.changed status and queues broadcasts.measure-blocked-share 48 h later with the broadcast id as singleton key.
- [x] every Hard Rule inlined above still holds
- [x] lint + vet clean (`pnpm lint`)

## Implementation notes

- `implement` (T21): `createSettle` (`broadcasts/app/settle.ts`): `endInTx(tx, lockedRow, { kind: 'stop', actorAccountId } | { kind: 'abort', reason })`, `abort(ws, id, reason)`, `finishIfDone(ws, id)`, `logEnded(row, endReason)`. Each ending, in its transaction: settle waiting recipients in one update (`settleWaiting`), `markStopped` / `markSent`, `broadcast.changed { change: status }`, `jobs.enqueueBlockedShare(tx, ws, id, at + 48 h)`; after commit the `broadcast.ended` log (ids, end reason, totals by state, launch-to-finish ms — no text, no names). A row that is not `sending` (stopped meanwhile, ended, draft, foreign) is left alone.
- `implement` (T21): `createStopBroadcast` (`app/stop.ts`): `OWNER_ONLY` by role → in one transaction `lockActiveMembers` (`FOR SHARE`; not active → `ACCESS_REMOVED`) → row `FOR NO KEY UPDATE` (404) → `endInTx(stop)`. Nothing waiting answers `unchanged` and then runs `finishIfDone`, so a stop after the last outcome leaves the broadcast `sent` / `completed`; a broadcast with only in-flight sends stays `sending` (the chain finishes it). The answer's `broadcast` comes from a new `BroadcastView` port. **Hand-off → T26:** bind `views.broadcastView = reads.getBroadcast`; the route passes the guard's role.
- `implement` (T21): new ports `BroadcastJobs` (`enqueueBlockedShare`), `BroadcastView`, `BroadcastLogger`; `BroadcastRepo.markStopped` / `markSent` added to T14's repository (`infra/broadcast-repo.ts`, outside files_hint; RED `TypeError: repo.markStopped is not a function`, isolation + "only a sending broadcast" test in `broadcast-repo.int.test.ts`). **Hand-off → T24:** implement `BroadcastJobs` over pg-boss (`broadcasts.measure-blocked-share`, `startAfter`, `singletonKey` = broadcast id); the integration test here records the enqueue (exactly one per broadcast across stop + later abort / finish), the pg-boss singleton is T24's.
- `implement` (T21): last change is set only by a stop (the owner); finish and abort keep the last change.
- `implement` (T21): RED `Cannot find module './settle.js'` for both unit files (GOOD red); integration written after GREEN, green on first run (claim-vs-stop race over 5 rounds: exactly one side wins).
- `implement` (T21): gate — full `pnpm test` green (297 files, 4146 tests); `pnpm lint` clean.
