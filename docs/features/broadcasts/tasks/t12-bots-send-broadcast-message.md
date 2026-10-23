---
id: T12
title: "Add bots.sendBroadcastMessage and launchReadiness: a per-bot broadcast pacer at 40 ms start slots, refusal while the send pause runs, when the bot is not working or is not the launch Telegram bot, plain-text sendMessage, and every Telegram answer classified (blocked recorded in contacts)"
layer: "app"
deps: ["T10"]
blocks: ["T26"]
acs: ["AC-08", "AC-10", "AC-12", "AC-15", "AC-17"]
files_hint: ["apps/api/src/modules/bots/app/send-broadcast-message.ts", "apps/api/src/modules/bots/app/send-broadcast-message.test.ts", "apps/api/src/modules/bots/app/send-broadcast-message.int.test.ts", "apps/api/src/modules/bots/app/launch-readiness.ts", "apps/api/src/modules/bots/app/pacer.ts", "apps/api/src/modules/bots/app/ports.ts", "apps/api/src/modules/bots/infra/telegram-gateway.ts", "apps/api/src/test/fake-telegram.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T12 — Add bots.sendBroadcastMessage and launchReadiness: a per-bot broadcast pacer at 40 ms start slots, refusal while the send pause runs, when the bot is not working or is not the launch Telegram bot, plain-text sendMessage, and every Telegram answer classified (blocked recorded in contacts)

## Place in the sequence

- **Blocked by:** T10 — Learn blocks in bots: allowed_updates gains my_chat_member, the classifier turns a private kicked / member update into a reach decision handled before the interceptor and capture, and a reply refused as blocked records the block · **Blocks:** T26 — Register the broadcasts routes (registerBroadcasts): the seventeen operations with their zod schemas, the owner-only launch confirmation, launch and stop, the masked picker search, and the wiring in buildDeps (contacts ⇄ bots late-bound ports, broadcasts after team, inbox given itemDetails) and buildApp · **Wave:** 5 — after T10.
- **Lane:** shares `apps/api/src/modules/bots/app/ports.ts`, `apps/api/src/modules/bots/infra/telegram-gateway.ts`, `apps/api/src/test/fake-telegram.ts` with T10; shares `apps/api/src/modules/bots/infra/telegram-gateway.ts` with T11 — serialized.

## Why (user story)

> **As an** Operator
> **I want** my replies to go out without waiting behind a broadcast, and to see the broadcast in a customer's conversation when they answer it
> **So that** support works as usual and I understand what the customer is answering
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

> **As an** End customer
> **I want** to get the business's broadcast once, in my chat with its bot, as the text the business wrote
> **So that** I read one message, not duplicates, and see nothing about other customers or the team
>
> — `spec.md §4, US-08, verbatim` · full text: [spec.md](../spec.md)

It is the only path a broadcast takes to Telegram: one plain-text message per recipient, through the workspace's own bot, paced below the limit and always yielding to replies and the send pause.

## Inlined context

> **Broadcasts are paced at 25 per second per bot in turns, wait for the bot's send pause, and go out through a dedicated `bots.sendBroadcastMessage`.** The sender keeps at most 8 sends in flight. Each send takes the next start slot of a per-bot pacer in `bots` (40 ms apart, so any 1 s window holds at most 25). […] `sendBroadcastMessage` refuses without calling Telegram while the bot's send pause runs, when the bot is not `connected` / `taken_over`, or when the workspace's bot is no longer the Telegram bot the broadcast was launched with. Replies keep `sendText`, which neither waits for the pacer nor for the pause (AC-15, §6 pace, reply latency).
>
> — `sad.md §4, choice 8, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. With one active sender per workspace (ADR-0007), an in-process pacer is exact for that bot; 40 ms start spacing caps any 1 s window at 25. […] The pause and the bot identity are checked inside `bots` before each call, so a rate limit from any sender pauses broadcasts, and a replaced bot is never used for an old broadcast.
>
> — `adr/0008 §Decision outcome, ADR-0008, abridged` · full text: [ADR-0008](../adr/0008-pace-broadcasts-at-25-per-second-per-bot-in-turns-and-wait-for-the-send-pause.md)

> "A working bot" for a **launch** means the bot row's state is `connected`. `needs_token` (not working), `disconnected` / no row (no bot) and `taken_over` […] refuse a launch with the way to the bot settings. **While sending**, the broadcast keeps the reply rule: it sends while the bot is `connected` or `taken_over` and ends at once on `needs_token`, a disconnect or a different Telegram bot (AC-12).
>
> — `sad.md §1, Assumptions, working bot, abridged` · full text: [sad.md](../sad.md)

> | bots | `sendBroadcastMessage({ workspaceId, telegramBotId, chatId, text })`, `launchReadiness(workspaceId)` (state + Telegram bot id) | broadcasts | ADR-0008, AC-10 |
>
> — `sad.md §5, App-layer additions, verbatim` · full text: [sad.md](../sad.md)

> `bots` checks that the workspace's bot is still the same Telegram bot and working, that no send pause runs, and takes a pacer slot. The send is scoped by the workspace, so one workspace's bot never sends another's broadcast (AC-08). The customer gets one plain-text message with the trimmed text, with no formatting and nothing about other recipients (AC-17). […] Blocked means "blocked the bot", and the contact is marked (AC-14). A deleted account or an unknown chat fails with that reason. No answer means not confirmed […]. A rate limit, or the pause seen by `bots`, puts the recipient back to waiting. A refused text or a lost bot aborts the broadcast (flow 13, AC-12). Any other error fails only this recipient.
>
> — `sad.md §6, Flow 12, prose, abridged` · full text: [sad.md](../sad.md)

> A user who blocked the bot gets `403` ("bot was blocked by the user"); a deleted account gets `403` ("user is deactivated").
>
> — `sad.md §2, Technical, Telegram, abridged` · full text: [sad.md](../sad.md)

> | Telling a refused text from a refused chat relies on Telegram's `400` description; an unknown `400` aborts the whole broadcast | Medium | classify "chat not found" / "user not found" / "PEER_ID_INVALID" as recipient-level; log the code and a description class (never the text); review the class list with pilot data | Backend |
>
> — `sad.md §11, Risks, verbatim` · full text: [sad.md](../sad.md)

> | Text and names | one shared rule in `packages/shared/src/broadcast-text.ts` […]. Sent with no `parse_mode` (plain text, AC-17), link previews at Telegram's default. Shown as plain text everywhere | ADR-0012 |
>
> — `sad.md §8, Text and names, abridged` · full text: [sad.md](../sad.md)

> A 20 s link plus a 10 s send timeout stays well inside the 60 s expire, so a timed-out predecessor cannot still be sending when its successor starts.
>
> — `adr/0007 §Decision outcome, ADR-0007, abridged` · full text: [ADR-0007](../adr/0007-send-through-a-per-workspace-pg-boss-chain-that-claims-each-recipient-before-its-send.md)

> | Tenancy | every new table has a non-null `workspace_id` and composite foreign keys `(workspace_id, …)` to `contacts`, `memberships`, `broadcasts` and `conversations`; every repository method takes `workspaceId`; each repository has a cross-workspace isolation test. The sender job carries its workspace id; `sendBroadcastMessage` takes the workspace id and the expected Telegram bot id. **No new tenancy exception** (the six stay six) | CLAUDE.md; ADR-0007 |
>
> — `sad.md §8, Tenancy, verbatim` · full text: [sad.md](../sad.md)

> | Logging | pino structured logs. Never the broadcast text, contact names, usernames, chat ids or the token; ids, counts, states and reasons only. The group picker's search text is masked in request logs, like the Contacts search | CLAUDE.md, contacts SAD §8, here |
>
> — `sad.md §8, Logging, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (reads the bot row's `state`, Telegram bot id and `send_paused_until`; writes `send_paused_until` on a `429` — the existing column, as `sendText` and `sendMemberMessage` do).

## API contract

Internal — no API surface (an app-layer call used by the `broadcasts.send` link, T22, through the `BotsApi` port bound in T26).

## Acceptance criteria

### AC-08 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, open, create, edit, duplicate, delete or launch a broadcast of "Acme Flowers", see its delivery report, or add a contact of "Acme Flowers" to a group of another workspace (or a contact of another workspace to a group of "Acme Flowers")
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the broadcast or the contact exists; a deactivated member gets the access-removed notice and a member deactivated while on the confirmation launches nothing; someone not signed in is asked to sign in first; a broadcast's audience, recipients and report only ever hold contacts of its own workspace, and the bot of one workspace never sends another workspace's broadcast
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — cross-context

> **Given** a business owner of "Acme Flowers" about to launch a draft
> **When** the workspace has no bot connected, or its bot is not working (the token was revoked), or the workspace connected a different bot since some of the audience last wrote
> **Then** with no bot or a bot that is not working, launch is refused, the draft stays a draft, and the owner is told why and offered the way to the bot settings; contacts who have never written to the bot connected now cannot be reached by it, so they are left out at launch and counted apart in the draft and the confirmation ("never wrote to the current bot"), and blocked marks learned with the old bot do not apply to the new one; reconnecting the same Telegram bot is not a change of bot, so its blocked marks and who wrote to it stay; drafts can be created, edited and duplicated while the bot is missing or not working
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — error

> **Given** the broadcast "Spring prices" of "Acme Flowers" while it is sending
> **When** Telegram refuses the text itself, or the bot stops working (its token is revoked) or is disconnected or replaced by another bot
> **Then** sending ends at once: every recipient still waiting is marked failed with the plain reason ("Telegram refused the text" or "the bot stopped working"), the broadcast becomes "sent" with the report showing who got it before that, and nothing of it is sent later when the bot works again or by a newly connected bot; the owner can duplicate it, fix the text or the bot, and launch the copy to the recipients it did not reach (AC-13)
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — cross-context

> **Given** "Acme Flowers" launches a broadcast to 3 000 contacts while operators keep answering customers, and another broadcast of the workspace is already sending
> **When** operators send replies during the broadcast, and Telegram answers the bot with a rate limit
> **Then** replies go out without waiting for the broadcasts to finish — a reply sent during a broadcast reaches the customer as fast as on a quiet day (§6); the bot's broadcast sending together stays below Telegram's per-bot limit with room left for replies, pings and the bot's own answers; two broadcasts sending at the same time take turns, so neither waits for the other to finish; on a rate-limit answer to any of the bot's sends the broadcasts pause for the time Telegram asked (the bot's send pause, as for pings) and then continue where they stopped, without skipping or doubling any recipient, while replies keep going as before; a broadcast of one workspace never slows the replies, pings or broadcasts of another workspace
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — happy path

> **Given** an end customer who wrote to the bot of "Acme Flowers" and is a recipient of "Spring prices"
> **When** the broadcast is sent
> **Then** they receive exactly one message from the business bot in their private chat with it, with the text exactly as the owner confirmed it (spaces and line breaks at its ends were removed when it was saved), shown as plain text (nothing in it is turned into formatting); the message names no member and shows nothing about other recipients, the audience or the workspace's tags
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Failing unit tests first with the fakes: every answer of the union below, the pause and identity refusals without a Telegram call, the 40 ms spacing with a fake clock — `apps/api/src/modules/bots/app/send-broadcast-message.test.ts`
- [ ] `launchReadiness(workspaceId)` → `{ state, telegramBotId } | null` (no row) — `apps/api/src/modules/bots/app/launch-readiness.ts`
- [ ] `sendBroadcastMessage({ workspaceId, telegramBotId, chatId, text })` answering `delivered { messageId, at }` · `blocked` · `account_gone` · `chat_not_found` · `text_refused` · `telegram_error` · `rate_limited { retryAfter }` · `paused { until }` · `bot_unavailable` · `bot_changed` · `not_confirmed` — `apps/api/src/modules/bots/app/send-broadcast-message.ts`, types in `apps/api/src/modules/bots/app/ports.ts`
- [ ] Order inside: load the workspace's bot row → `bot_unavailable` unless `connected` / `taken_over` → `bot_changed` if its Telegram id ≠ `telegramBotId` → `paused` if `send_paused_until` is ahead → pacer slot → `sendMessage` with no `parse_mode`, timeout `SEND_TIMEOUT` (10 s) — same file
- [ ] A second pacer instance keyed by bot at 25 per second (`createPacer({ perSecond: 25 })`), separate from the member-message pacer; `sendText` never uses it — `apps/api/src/modules/bots/app/pacer.ts`
- [ ] Gateway: classify the `sendMessage` answer for broadcasts (`429` → store the pause, `403` blocked / deactivated, `400` chat-not-found class vs text class, `401` → `markNeedsToken` + `bot_unavailable`, timeout after write → `not_confirmed`) — `apps/api/src/modules/bots/infra/telegram-gateway.ts`
- [ ] `blocked` also calls the `ContactsReach` port (T10) with `blocked: true, at: clock.now()`
- [ ] Fake Bot API: per-call scripted answers and delays, and a send log with timestamps per bot for the pace assertion — `apps/api/src/test/fake-telegram.ts`
- [ ] Integration test: two workspaces' bots never cross; `sendText` during a full-pace burst is not delayed; a scripted `429` sets `send_paused_until` and the next broadcast send answers `paused` with no Telegram call — `apps/api/src/modules/bots/app/send-broadcast-message.int.test.ts`
- [ ] Manual (not a CI gate): send a 4096-UTF-16-unit emoji-heavy text through a real test bot to confirm Telegram's count (sad.md §11)

## Edge cases

| Case | Behaviour |
|---|---|
| `send_paused_until` ahead (from a reply, ping or broadcast `429`) | `paused { until }`, no Telegram call; replies unaffected (AC-15) |
| bot `needs_token` / disconnected / no row | `bot_unavailable`, no call (AC-12) |
| bot `taken_over` | still sends (reply rule, sad §1) |
| workspace now has a different Telegram bot | `bot_changed`, no call (AC-10, AC-12) |
| `429 retry_after` | pause stored, `rate_limited` — nothing was sent (AC-15) |
| `403` blocked | `blocked` + block recorded (AC-14) |
| `403` user is deactivated | `account_gone` (not blocked) |
| `400` chat not found / user not found / PEER_ID_INVALID | `chat_not_found` (recipient-level) |
| `400` about the text (e.g. too long, empty) | `text_refused` (aborts the broadcast in T22) (AC-12) |
| other error answer | `telegram_error` (that recipient only) |
| no answer within 10 s / connection lost after write | `not_confirmed`, never retried (AC-11) |
| the text | sent exactly as given, no `parse_mode` (AC-17) |

## Definition of Done

- [ ] Unit and fake-Bot-API integration tests prove launchReadiness answers the bot state and Telegram bot id, sendBroadcastMessage sends the exact text with no parse_mode to the user's chat through the workspace's own bot, refuses without a Telegram call while send_paused_until is ahead, for a needs_token or disconnected bot and for another Telegram bot, spaces sends at least 40 ms apart per bot (no 1 s window above 25) while sendText is never delayed by it, stores the send pause on a 429, maps 403 blocked / deactivated, 400 chat-not-found and text refusals, other errors and a 10 s timeout to their answers, and records a blocked answer through contacts.recordBlockChange.
- [ ] A test proves no log line or error of this path carries the text, the chat id or the token (ids, outcome and description class only).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
