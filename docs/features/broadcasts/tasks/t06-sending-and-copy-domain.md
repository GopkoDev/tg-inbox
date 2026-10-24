---
id: T6
title: "Add the broadcasts domain for sending and copies: recipient states and failure reasons, the bots answer → outcome map with its abort kinds, the fixable set, the pace constants and the round-robin turn picker, and the duplicate audience choices"
layer: "domain"
deps: ["T1"]
blocks: ["T21", "T22", "T23"]
acs: ["AC-11", "AC-12", "AC-13", "AC-15"]
files_hint: ["apps/api/src/modules/broadcasts/domain/recipient.ts", "apps/api/src/modules/broadcasts/domain/recipient.test.ts", "apps/api/src/modules/broadcasts/domain/sending.ts", "apps/api/src/modules/broadcasts/domain/sending.test.ts", "apps/api/src/modules/broadcasts/domain/duplicate.ts", "apps/api/src/modules/broadcasts/domain/duplicate.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T6 — Add the broadcasts domain for sending and copies: recipient states and failure reasons, the bots answer → outcome map with its abort kinds, the fixable set, the pace constants and the round-robin turn picker, and the duplicate audience choices

## Place in the sequence

- **Blocked by:** T1 — Add the shared broadcast text and name rules: trim both ends, 1–4096 UTF-16 code units for the text, 1–80 graphemes for the name, and the "Copy of …" cut · **Blocks:** T21 — Add stop and the settling transaction: a business owner stops a sending broadcast (waiting → stopped), an abort fails the waiting recipients with text_refused or bot_stopped, a finish marks sent, and every ending queues the 48-hour blocked-share measure, T22 — Add one link of the sending chain: resolve stale in-flight recipients as not confirmed with their items, serve the sending broadcasts in turns with at most 8 sends in flight for at most 20 s, check the block at each turn, claim before the send, record each outcome with its broadcast item and a coalesced report signal, abort or finish, and decide the successor, T23 — Add duplicate: any member copies any broadcast into a new draft named "Copy of …" within 80, a draft with its audience, a launched one as the same tags, all recipients or only the recipients it did not reach once ended · **Wave:** 2 — after T1.
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to follow a launched broadcast's progress and see for each recipient whether it was delivered, failed (and why) or could not arrive because they blocked the bot
> **So that** I know how many customers it really reached and whom it did not
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It fixes, without I/O, how each Telegram answer becomes a recipient outcome, how fast and in what turns broadcasts send, and which recipients a copy may take, so the sender and the duplicate apply one honest vocabulary.

## Inlined context

> │             recipient.ts (outcomes + reasons, Telegram answer → outcome map, "fixable" set for duplicates)
> │             sending.ts (25 per second, 8 in flight, 20 s link, round-robin turn, 1 s report coalescing)
> │             duplicate.ts ("Copy of …" within 80 by the shared name rule, audience copy choices)
>
> — `sad.md §5, Internal decomposition, domain, verbatim` · full text: [sad.md](../sad.md)

> Telegram answers map to: `blocked` → outcome blocked; `account_gone` → failed "account no longer exists"; `chat_not_found` → failed "chat not found"; other error answers without `retry_after` → failed "Telegram error"; timeout or lost connection → not confirmed; `429` → back to `waiting` (nothing was sent); a `400` whose description is about the text (too long, empty, cannot be parsed) → `text_refused`, which aborts. … Abort … reason `text_refused` ("Telegram refused the text") or `bot_stopped` ("the bot stopped working", for both `bot_unavailable` and `bot_changed`)
>
> — `adr/0009 §Decision, point 1, abridged` · full text: [ADR-0009](../adr/0009-end-stop-or-abort-a-broadcast-by-settling-every-waiting-recipient-in-one-transaction.md)

> **Chosen:** Option 1. With one active sender per workspace (ADR-0007), an in-process pacer is exact for that bot; 40 ms start spacing caps any 1 s window at 25. Eight in flight cover a Telegram round trip of up to 320 ms at full pace, so 1 000 recipients take about 40 s and 10 000 about 7 minutes.
>
> — `adr/0008 §Decision outcome, ADR-0008, abridged` · full text: [ADR-0008](../adr/0008-pace-broadcasts-at-25-per-second-per-bot-in-turns-and-wait-for-the-send-pause.md)

> It picks the lowest waiting position of each sending broadcast in turn, oldest launch first, so two broadcasts both move on (AC-15).
>
> — `sad.md §6, flow 14, abridged` · full text: [sad.md](../sad.md)

> - **Duplicates** … for a launched broadcast "all recipients" (every recipient row) or "only recipients it did not reach" (outcomes `failed` with reason `bot_stopped`, `text_refused` or `telegram_error`, plus `stopped`, plus `not_confirmed` only when the request carries `include_not_confirmed`), offered only when the broadcast has ended.
>
> — `sad.md §4, Supporting choices, Duplicates, abridged` · full text: [sad.md](../sad.md)

> 13. **Duplicate audiences are named** `same` (a draft source, the default), `same_tags`, `all_recipients`, `not_reached`; a choice that does not fit the source is `400 VALIDATION_ERROR` with `details.field = audience`. "Only recipients it did not reach" while the source still sends is the new `409 BROADCAST_NOT_ENDED` (flag F-2).
>
> — `contracts/api-sync-report.md §Assumptions, 13, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> 3. **`report` is coalesced in memory per broadcast** to at most one per second by the one active link of the workspace (ADR-0011) …
>
> — `contracts/events.md §Assumptions, 3, abridged` · full text: [events.md](../contracts/events.md)

> - A failure "chat not found" … is a recipient-level failure that a new attempt cannot fix. It is not copied by "only recipients it did not reach".
>
> — `sad.md §1, Assumptions, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. (The vocabularies mirror `broadcast_recipients.state` / `failure_reason` and `broadcasts.end_reason` from T3.)

## API contract

> - `RecipientState`: `waiting, sending, delivered, blocked, failed, not_confirmed, stopped`; `RecipientFailureReason`: `account_gone, chat_not_found, telegram_error, text_refused, bot_stopped`; `EndReason`: `completed, text_refused, bot_stopped, stopped`.
> - `BroadcastDuplicate.audience`: `same | same_tags | all_recipients | not_reached`, `include_not_confirmed?: boolean`.
>
> — `contracts/openapi.yaml, schemas RecipientState / RecipientFailureReason / EndReason / BroadcastDuplicate, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

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

### AC-13 — happy path

> **Given** "Acme Flowers" with a draft "Wholesale catch-up" (a group of 14 contacts) and the sent broadcast "Spring prices" (tag audience; 33 delivered, 1 blocked the bot, 2 failed because the bot stopped working)
> **When** an operator duplicates the draft, and duplicates "Spring prices" choosing first "all recipients" and then "only recipients it did not reach"
> **Then** each duplicate is a new draft named "Copy of …" (shortened to fit 80 characters) with the same text, listed for every member, its author being the member who duplicated it, and the original is unchanged; the copy of the draft has the same group of 14 contacts; the copy of "Spring prices" with "all recipients" has a broadcast group of its 36 recipients, the one who blocked the bot counted as unreachable; "only recipients it did not reach" is offered once a broadcast has ended, and gives a group of the 2 who failed: it copies recipients who failed for a reason a new attempt can fix (the bot stopped working, Telegram refused the text, a Telegram error, stopped before their turn) and those marked "not confirmed" only after a warning that they may have received it, while recipients who were delivered, who blocked the bot or whose account no longer exists are not copied; a tag audience can also be duplicated as the same tags, evaluated again at the copy's launch; the copy is then edited and launched like any draft
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — cross-context

> **Given** "Acme Flowers" launches a broadcast to 3 000 contacts while operators keep answering customers, and another broadcast of the workspace is already sending
> **When** operators send replies during the broadcast, and Telegram answers the bot with a rate limit
> **Then** replies go out without waiting for the broadcasts to finish — a reply sent during a broadcast reaches the customer as fast as on a quiet day (§6); the bot's broadcast sending together stays below Telegram's per-bot limit with room left for replies, pings and the bot's own answers; two broadcasts sending at the same time take turns, so neither waits for the other to finish; on a rate-limit answer to any of the bot's sends the broadcasts pause for the time Telegram asked (the bot's send pause, as for pings) and then continue where they stopped, without skipping or doubling any recipient, while replies keep going as before; a broadcast of one workspace never slows the replies, pings or broadcasts of another workspace
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Red: `outcomeOf(answer)` for each `sendBroadcastMessage` answer (`delivered{messageId}`, `blocked`, `account_gone`, `chat_not_found`, `telegram_error`, `no_answer`, `rate_limited{retryAfter}`, `paused{until}`, `text_refused`, `bot_unavailable`, `bot_changed`) → `{ record: state+reason } | { requeue } | { abort: text_refused | bot_stopped }` — `apps/api/src/modules/broadcasts/domain/recipient.test.ts`
- [ ] Red: `FIXABLE_REASONS` = `bot_stopped, text_refused, telegram_error`; `notReachedStates(includeNotConfirmed)` — same file
- [ ] Red: constants `PACE_PER_SECOND = 25`, `START_SPACING_MS = 40`, `MAX_IN_FLIGHT = 8`, `LINK_MS = 20_000`, `SEND_TIMEOUT_MS = 10_000`, `REPORT_COALESCE_MS = 1_000`; `nextTurn(sendingByLaunch, lastServed)` round-robin oldest launch first; `ReportCoalescer.shouldPublish(broadcastId, now)` — `apps/api/src/modules/broadcasts/domain/sending.test.ts`
- [ ] Red: `checkDuplicateChoice(sourceStatus, audienceKind, choice)` — `same` only for a draft, `same_tags` only for a launched tag audience, `all_recipients` for launched, `not_reached` only when ended else `not_ended` — `apps/api/src/modules/broadcasts/domain/duplicate.test.ts`
- [ ] Green: `recipient.ts`, `sending.ts`, `duplicate.ts` (pure)

## Edge cases

| Case | Behaviour |
|---|---|
| a `429` answer | back to `waiting`, nothing recorded; the link delays its successor to the pause end (AC-15) |
| `bot_changed` (another Telegram bot connected) | abort with `bot_stopped` for every waiting recipient (AC-12) |
| an unknown `400` not about the text | `chat_not_found` / `telegram_error` for that recipient only (sad §11 risk) |
| one sending broadcast | `nextTurn` keeps serving it; with two they alternate (AC-15) |
| `not_reached` on a `sending` source | `not_ended` → `409 BROADCAST_NOT_ENDED` |
| `not_confirmed` recipients without `include_not_confirmed` | not copied (AC-13) |

## Definition of Done

- [ ] Domain unit tests prove every sendBroadcastMessage answer maps to its outcome (delivered, blocked, failed with account_gone, chat_not_found or telegram_error, not_confirmed, back to waiting for a rate limit or a pause, abort with text_refused or bot_stopped for text_refused, bot_unavailable and bot_changed), that the fixable set is exactly bot_stopped, text_refused, telegram_error plus stopped (and not_confirmed only when asked), that the turn picker serves sending broadcasts oldest launch first one recipient each in turn, that the constants are 25 per second (40 ms), 8 in flight, a 20 s link and 1 s report coalescing, and that each duplicate audience choice is accepted only for the source it fits.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
