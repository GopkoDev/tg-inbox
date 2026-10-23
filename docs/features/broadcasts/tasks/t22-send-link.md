---
id: T22
title: "Add one link of the sending chain: resolve stale in-flight recipients as not confirmed with their items, serve the sending broadcasts in turns with at most 8 sends in flight for at most 20 s, check the block at each turn, claim before the send, record each outcome with its broadcast item and a coalesced report signal, abort or finish, and decide the successor"
layer: "app"
deps: ["T6", "T13", "T21"]
blocks: ["T24"]
acs: ["AC-08", "AC-11", "AC-12", "AC-14", "AC-15", "AC-16", "AC-17"]
files_hint: ["apps/api/src/modules/broadcasts/app/send-link.ts", "apps/api/src/modules/broadcasts/app/send-link.test.ts", "apps/api/src/modules/broadcasts/app/send-link.int.test.ts", "apps/api/src/modules/broadcasts/infra/signals.ts", "apps/api/src/modules/broadcasts/app/ports.ts", "apps/api/src/modules/broadcasts/app/fakes.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T22 — Add one link of the sending chain: resolve stale in-flight recipients as not confirmed with their items, serve the sending broadcasts in turns with at most 8 sends in flight for at most 20 s, check the block at each turn, claim before the send, record each outcome with its broadcast item and a coalesced report signal, abort or finish, and decide the successor

## Place in the sequence

- **Blocked by:** T6 — Add the broadcasts domain for sending and copies: recipient states and failure reasons, the bots answer → outcome map with its abort kinds, the fixable set, the pace constants and the round-robin turn picker, and the duplicate audience choices, T13 — Add broadcast items to conversations: recordBroadcastItem in the outcome transaction without touching any conversation column, the thread kind broadcast in the keyset order, one-item reads and conversation.changed with item type broadcast, T21 — Add stop and the settling transaction: a business owner stops a sending broadcast (waiting → stopped), an abort fails the waiting recipients with text_refused or bot_stopped, a finish marks sent, and every ending queues the 48-hour blocked-share measure · **Blocks:** T24 — Add the broadcasts queues and workers: broadcasts.send (stately per workspace, retry 3, expire 60 s, 16 links per instance) with its dead letter that restarts the chain 60 s later, and broadcasts.measure-blocked-share logging the 48-hour blocked share · **Wave:** 6 — after T6, T13, T21.
- **Lane:** shares `apps/api/src/modules/broadcasts/infra/signals.ts`, `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T16; shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T17; shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T18; shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T19; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T20; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T21; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T23 — serialized.

## Why (user story)

> **As an** End customer
> **I want** to get the business's broadcast once, in my chat with its bot, as the text the business wrote
> **So that** I read one message, not duplicates, and see nothing about other customers or the team
>
> — `spec.md §4, US-08, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to follow a launched broadcast's progress and see for each recipient whether it was delivered, failed (and why) or could not arrive because they blocked the bot
> **So that** I know how many customers it really reached and whom it did not
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It is the engine that gets each recipient the broadcast once, in turns with other broadcasts, below the bot's limit, and writes an honest outcome and thread item for each.

## Inlined context

> A `429` puts the recipient back to waiting and ends the link with its successor delayed to the pause end. The `bots` answers `text_refused`, `bot_unavailable` and `bot_changed` abort the broadcast (flow 4's settling transaction, ADR-0009): waiting recipients fail with reason `text_refused` ("Telegram refused the text") or `bot_stopped` ("the bot stopped working", for both bot answers). A recipient left `sending` by a dead link becomes not confirmed **and** gets its broadcast item at its claim time in the same transaction (AC-16). Replies never pass through this loop.
>
> — `sad.md §6, Critical flow 2, verbatim` · full text: [sad.md](../sad.md)

> Each turn first re-checks the recipient's block mark for the Telegram bot the broadcast was launched with: a contact blocked now gets "blocked the bot" and no send, and one who unblocked is sent it (AC-11, AC-14). Otherwise the recipient is claimed with a conditional single-row update (`waiting → sending`) that commits before the Telegram call. […] Telegram's answer decides the outcome (ADR-0009). Accepted means delivered, with a broadcast item at that time (AC-16). Blocked means "blocked the bot", and the contact is marked (AC-14). A deleted account or an unknown chat fails with that reason. No answer means not confirmed, with an item at the claim time, never sent again (AC-11, AC-16). A rate limit, or the pause seen by `bots`, puts the recipient back to waiting. A refused text or a lost bot aborts the broadcast (flow 13, AC-12). Any other error fails only this recipient. […] Outcomes, items and report signals are written in the outcome transaction.
>
> — `sad.md §6, flow 12, abridged` · full text: [sad.md](../sad.md)

> It first finds the workspace's sending broadcasts and any recipient still `sending`. Because only one link is active, such a recipient was left by a dead link, so it becomes "not confirmed" with its broadcast item at its claim time (AC-11, AC-16). The link then runs for at most 20 s with at most 8 sends in flight. It picks the lowest waiting position of each sending broadcast in turn, oldest launch first, so two broadcasts both move on (AC-15). It waits for the sends in flight, ends the broadcasts with nothing left (flow 13), and queues its successor in its last transaction while anything still sends, delayed to the send pause end when the bot is paused.
>
> — `sad.md §6, flow 14, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. The claim commits before the Telegram call, so no recipient can be sent twice: a recipient that is not `waiting` is never claimed again, and one left `sending` by a crash becomes not confirmed. `stately` per workspace keeps exactly one active link (one sender per bot) and lets the active link enqueue its successor. Because each link is enqueued in a transaction that also writes progress, and pg-boss retries and the dead-letter handler re-enqueue, every sending broadcast always has a link queued without any read across workspaces: **no new tenancy exception**. A 20 s link plus a 10 s send timeout stays well inside the 60 s expire, so a timed-out predecessor cannot still be sending when its successor starts.
>
> — `adr/0007-send-through-a-per-workspace-pg-boss-chain-that-claims-each-recipient-before-its-send.md §Decision outcome, ADR-0007, verbatim` · full text: [ADR-0007](../adr/0007-send-through-a-per-workspace-pg-boss-chain-that-claims-each-recipient-before-its-send.md)

> **Chosen:** Option 1. With one active sender per workspace (ADR-0007), an in-process pacer is exact for that bot; 40 ms start spacing caps any 1 s window at 25. Eight in flight cover a Telegram round trip of up to 320 ms at full pace, so 1 000 recipients take about 40 s and 10 000 about 7 minutes. Replies keep their own path. The pause and the bot identity are checked inside `bots` before each call, so a rate limit from any sender pauses broadcasts, and a replaced bot is never used for an old broadcast.
>
> — `adr/0008-pace-broadcasts-at-25-per-second-per-bot-in-turns-and-wait-for-the-send-pause.md §Decision outcome, ADR-0008, verbatim` · full text: [ADR-0008](../adr/0008-pace-broadcasts-at-25-per-second-per-bot-in-turns-and-wait-for-the-send-pause.md)

> **Chosen:** Option 1. The thread stays one ordered query in its owner. The item is written in the same transaction as the recipient's outcome, so the report and the thread never disagree. It has its own kind, so no existing rule about messages or replies (unread, waiting, reopen, pings) sees it.
>
> — `adr/0010-store-broadcast-items-as-a-conversations-thread-entry-that-never-touches-conversation-state.md §Decision outcome, ADR-0010, verbatim` · full text: [ADR-0010](../adr/0010-store-broadcast-items-as-a-conversations-thread-entry-that-never-touches-conversation-state.md)

> **Claim:** one recipient row (conditional update). **Outcome:** recipient row → broadcast item insert (foreign-key `KEY SHARE` on the conversation and broadcast rows, compatible with `NO KEY UPDATE`) → signal.
>
> — `sad.md §8, Lock order, abridged` · full text: [sad.md](../sad.md)

> 3. **`report` is coalesced in memory per broadcast** to at most one per second by the one active link of the workspace (ADR-0011): an outcome transaction publishes it only when at least 1 s has passed since the last `report` for that broadcast; the finishing (or aborting) transaction always publishes `status`. A stale-in-flight resolution at a link's start publishes `report` once.
>
> — `contracts/events.md §Assumptions, 3, verbatim` · full text: [events.md](../contracts/events.md)

> 7. **`claimed_at` is the current attempt's claim time.** A rate limit puts a recipient back to `waiting` with `claimed_at` NULL. A not confirmed recipient keeps it, and its item sits there (AC-16).
>
> — `data-model.md §Assumptions, 7, verbatim` · full text: [data-model.md](../data-model.md)

> **While sending**, the broadcast keeps the reply rule: it sends while the bot is `connected` or `taken_over` and ends at once on `needs_token`, a disconnect or a different Telegram bot (AC-12).
>
> — `sad.md §1, Assumptions, abridged` · full text: [sad.md](../sad.md)

> **Hard rule (Tenancy):** every repository method takes `workspaceId`; each repository has a cross-workspace isolation test. The sender job carries its workspace id; `sendBroadcastMessage` takes the workspace id and the expected Telegram bot id. **No new tenancy exception** (the six stay six)
>
> **Hard rule (Logging):** pino structured logs. Never the broadcast text, contact names, usernames, chat ids or the token; ids, counts, states and reasons only.
>
> — `sad.md §8, Tenancy and Logging, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Writes, through T15 and `conversations.recordBroadcastItem` (T13):

| Table | Columns | Rule |
|---|---|---|
| `broadcast_recipients` | `state` `waiting → sending` (claim, `claimed_at`); then `delivered` (+ `telegram_message_id`) / `blocked` / `failed` + `failure_reason` (`account_gone`, `chat_not_found`, `telegram_error`) / `not_confirmed` (keeps `claimed_at`) / back to `waiting` (`claimed_at` NULL); `outcome_at` | the claim is `UPDATE … SET state = 'sending' WHERE id = $1 AND state = 'waiting'` |
| `broadcast_items` | one per broadcast and conversation, `state` `delivered` / `not_confirmed`, `position_at` (answer time / claim time) | `broadcast_items_broadcast_conversation_key` |

— `data-model.md §Entities, broadcast_recipients / broadcast_items, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface. The link runs from the `broadcasts.send { workspace_id }` job (T24) and produces, inside its transactions:

- `broadcast.changed { change: report }` (≤ 1 per broadcast per second; once after a stale-in-flight resolution) and `{ change: status }` on finish or abort (through T21);
- `conversation.changed { item: { type: broadcast, id }, change: created }` per item (through T13);
- `contact.changed { change: reach }` for a send refused as blocked (through `bots` → `contacts`, T12 / T7);
- the successor `broadcasts.send` link while any broadcast of the workspace still sends, `startAfter` the send-pause end when paused; the `broadcast.link` log line at its end.

— `contracts/events.md §Job: broadcasts.send and §Channel: realtime signals, abridged` · full text: [events.md](../contracts/events.md)

## Acceptance criteria

### AC-08 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, open, create, edit, duplicate, delete or launch a broadcast of "Acme Flowers", see its delivery report, or add a contact of "Acme Flowers" to a group of another workspace (or a contact of another workspace to a group of "Acme Flowers")
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the broadcast or the contact exists; a deactivated member gets the access-removed notice and a member deactivated while on the confirmation launches nothing; someone not signed in is asked to sign in first; a broadcast's audience, recipients and report only ever hold contacts of its own workspace, and the bot of one workspace never sends another workspace's broadcast
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

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

### AC-14 — cross-context

> **Given** a contact "Olena K." of "Acme Flowers"
> **When** she blocks the business bot in Telegram, or a broadcast or reply to her is refused because she blocked it; and later she unblocks the bot, or writes to it again
> **Then** after the block her profile says she has blocked the bot and since when, the Contacts list marks her row, every draft that includes her counts her as unreachable, and a launch leaves her out; blocking the bot creates no customer message, does not open her conversation, does not change any unread count and triggers no ping; after she unblocks the bot or writes again the mark is gone and drafts count her as reachable again; the recipient list of a broadcast already launched is not changed by either event, and if she is still waiting in a sending broadcast, her mark at her turn decides whether she is sent it (AC-11); a member's own Telegram account linked for pings is never a contact and never a recipient
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — cross-context

> **Given** "Acme Flowers" launches a broadcast to 3 000 contacts while operators keep answering customers, and another broadcast of the workspace is already sending
> **When** operators send replies during the broadcast, and Telegram answers the bot with a rate limit
> **Then** replies go out without waiting for the broadcasts to finish — a reply sent during a broadcast reaches the customer as fast as on a quiet day (§6); the bot's broadcast sending together stays below Telegram's per-bot limit with room left for replies, pings and the bot's own answers; two broadcasts sending at the same time take turns, so neither waits for the other to finish; on a rate-limit answer to any of the bot's sends the broadcasts pause for the time Telegram asked (the bot's send pause, as for pings) and then continue where they stopped, without skipping or doubling any recipient, while replies keep going as before; a broadcast of one workspace never slows the replies, pings or broadcasts of another workspace
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — cross-context

> **Given** "Olena K.", whose conversation is closed, unassigned and not waiting for a reply, received the broadcast "Spring prices"
> **When** an operator opens her conversation in the inbox, and then she answers the broadcast in Telegram
> **Then** the thread shows the broadcast at the time it was delivered as a broadcast item — its text, its name and the business owner who launched it (still named if that owner was deactivated since) — distinct from the team's replies; a recipient whose send ended "not confirmed" also gets the item, marked "not confirmed" and placed at the time the send was made; receiving it did not reopen the conversation, did not change its assignee, its "waiting for a reply" marker, any unread or attention count, and triggered no ping; her answer is captured as a customer message as before: it reopens the conversation and counts for unread, "waiting for a reply" and pings like any message; a recipient whose broadcast failed for any other reason, was stopped before their turn, or who was left out gets no broadcast item
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — happy path

> **Given** an end customer who wrote to the bot of "Acme Flowers" and is a recipient of "Spring prices"
> **When** the broadcast is sent
> **Then** they receive exactly one message from the business bot in their private chat with it, with the text exactly as the owner confirmed it (spaces and line breaks at its ends were removed when it was saved), shown as plain text (nothing in it is turned into formatting); the message names no member and shows nothing about other recipients, the audience or the workspace's tags
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Add `BotsApi.sendBroadcastMessage({ workspaceId, telegramBotId, chatId, text })`, `ContactsApi.isBlocked(ws, contactId, botId)`, `ConversationsApi.recordBroadcastItem(tx, …)`, `jobs.enqueueSendLink(tx, ws, startAfter?)` to the ports and fakes (a scriptable fake bot) — `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts`
- [ ] Per-broadcast 1 s `report` coalescer (in memory) — `apps/api/src/modules/broadcasts/infra/signals.ts`
- [ ] RED: unit tests with fakes — order and turns, blocked at the turn, every answer → outcome (T6 map), back to waiting on rate limit / pause, abort, 8 in flight, the 20 s stop, successor decision — `apps/api/src/modules/broadcasts/app/send-link.test.ts`
- [ ] `runSendLink(ws, deadline)`: stale `sending` → `not_confirmed` + items at `claimed_at`; round-robin over `sending` broadcasts oldest launch first; per recipient: block check → claim (own committed tx) → send → outcome tx (recipient + item + coalesced signal) → abort / finish via T21; successor in the last tx — `apps/api/src/modules/broadcasts/app/send-link.ts`
- [ ] Integration tests against the fake Bot API: two broadcasts alternate; a never-answering send → `not_confirmed`, one send recorded, never resent; a link killed between claim and outcome, then the next link → `not_confirmed` with the item at the claim time; a 429 → recipient waiting, successor at the pause end; a text refusal → abort with `text_refused`; a recipient blocked before its turn → `blocked`, no send — `apps/api/src/modules/broadcasts/app/send-link.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| recipient blocked by the time of their turn | `blocked`, no send; unblocked before the turn → sent (AC-11, AC-14) |
| Telegram answers 403 blocked | `blocked`, contact marked through `bots` (AC-14) |
| deleted account / unknown chat / other error | `failed` with `account_gone` / `chat_not_found` / `telegram_error`, never retried (AC-11) |
| no answer within the send timeout | `not_confirmed` with its item at the claim time, never resent (AC-11, AC-16) |
| 429 from any sender, or the pause seen by `bots` | back to `waiting`, successor at the pause end, no skip or double (AC-15) |
| Telegram refuses the text | abort: waiting → `failed text_refused`, broadcast `sent` (AC-12) |
| bot `needs_token`, disconnected or a different Telegram bot | abort with `bot_stopped`; nothing sent later by any bot (AC-12) |
| a recipient stopped or aborted before its claim | never claimed (AC-18) |
| the link dies mid-send | next link resolves the `sending` row as `not_confirmed` (AC-11) |

## Definition of Done

- [ ] Unit tests with fakes and integration tests against the fake Bot API prove a link sends each waiting recipient at most once in position order, two sending broadcasts alternate, a recipient blocked at its turn gets blocked with no send, a delivered or not-confirmed outcome writes its broadcast item in the outcome transaction, a rate limit or pause returns the recipient to waiting and delays the successor to the pause end, a refused text or a lost bot aborts through the settling transaction, a recipient left sending by a killed link becomes not confirmed with its item at the claim time and is never resent, report signals are at most one per broadcast per second, and the link stops claiming after 20 s and asks for a successor while anything still sends. Failed, stopped and blocked recipients get no broadcast item (test plan).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
