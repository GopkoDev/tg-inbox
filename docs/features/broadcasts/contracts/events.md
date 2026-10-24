---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-23"
feature_size: L
---

# Events — broadcasts

This is the async contract for the flows drawn in `sad.md` §6. It is **derived** from the sequences: every frame, signal, job and inbound update here maps to a publish, enqueue or deliver message in a §6 diagram (seeded flows 1–4, flows 5–19). It is a **delta** over [shared-inbox `events.md`](../../shared-inbox/contracts/events.md), [assignment-statuses `events.md`](../../assignment-statuses/contracts/events.md), [operator-notifications `events.md`](../../operator-notifications/contracts/events.md) and [contacts `events.md`](../../contacts/contracts/events.md). Every channel, frame, close code, signal and queue not named here is unchanged and stays defined there.

The feature adds ([ADR-0007](../adr/0007-send-through-a-per-workspace-pg-boss-chain-that-claims-each-recipient-before-its-send.md), [ADR-0011](../adr/0011-push-broadcast-changes-as-id-only-signals-coalesced-to-once-per-second-and-page-the-report.md), [ADR-0003](../adr/0003-learn-blocks-from-my-chat-member-updates-and-refused-sends-in-bots-and-re-register-outdated-webhooks-in-the-health-check.md)):

- **Live socket:** one new server → client frame, `broadcast.changed`, and two widened frames: `contact.changed` gains `change: "reach"`, `conversation.changed` gains `item.type: "broadcast"`.
- **Realtime signals:** the same three, published inside the writing transaction.
- **pg-boss:** three queues — `broadcasts.send` (the per-workspace sending chain), its dead letter `broadcasts.send-dlq`, and `broadcasts.measure-blocked-share`.
- **Inbound Telegram updates:** `my_chat_member` for private chats (blocked / unblocked), classified by `bots` before the inbound interceptor and capture.
- **Log events:** `broadcast.blocked_share` (the spec §7 KPI) and the per-broadcast and per-link metrics of sad.md §7.

As before, no frame, signal or job payload carries content: ids and a change kind only. No broadcast text, contact name, username or chat id travels on the bus, the socket or the job queue (sad.md §8 *Logging*, *Events*).

## Assumptions (autonomous run 2026-10-23)

Each can be vetoed at review.

1. **`broadcast.changed` goes to every socket of the workspace.** Both roles see every broadcast and report (spec §1), so it is not account-scoped. The hub forwards it like `tags.changed`.
2. **One `change` value per transaction**, chosen by what the transaction did: `draft` (create, field or audience save, a duplicate's new draft), `group` (a group add or remove that wrote a row), `status` (launch, stop, finish, abort), `report` (an outcome, coalesced), `deleted` (a draft delete). A transaction that wrote nothing publishes nothing (an `unchanged` add, remove or stop, a refused request).
3. **`report` is coalesced in memory per broadcast** to at most one per second by the one active link of the workspace (ADR-0011): an outcome transaction publishes it only when at least 1 s has passed since the last `report` for that broadcast; the finishing (or aborting) transaction always publishes `status`. A stale-in-flight resolution at a link's start publishes `report` once.
4. **`contact.changed { change: "reach" }` is published only when a mark actually changed**: a fact older than the reach row's `changed_at`, a block of a contact already blocked, or an unblock of one not blocked publishes nothing. Capture's "wrote" that clears an older block publishes it; a first "wrote" without a block does not (no visible change).
5. **`conversation.changed` for a broadcast item is `change: "created"` only**: an item is never edited. The inbox list and the attention store ignore it (ADR-0010); only a tab with that conversation open refetches it.
6. **The send chain's payload is the workspace id only.** The link finds its work (the sending broadcasts and their waiting recipients); the queue's `singletonKey` makes it one link per workspace across instances.

## Channel: live socket (`GET /api/workspaces/{workspaceId}/inbox/live`) — changed

The producer, the opener (the workspace frame on every page, operator-notifications ADR-0002), the heartbeat, the re-check, the at-most-once delivery, the `presence` client frame and the close codes are unchanged.

### Frame: `broadcast.changed` (v1) — server → client, added

```json
{
  "type": "broadcast.changed",
  "v": 1,
  "workspace_id": "<uuid — broadcasts.workspace_id>",
  "broadcast_id": "<uuid — broadcasts.id>",
  "change": "draft | group | status | report | deleted"
}
```

- **Required fields:** `type`, `v`, `workspace_id`, `broadcast_id`, `change`.
- **Delivered to:** every socket of `workspace_id`.
- **Origin:** seeded flow 1 "publish broadcast.changed"; seeded flow 2 "publish broadcast.changed at most once per second"; seeded flow 4 "publish broadcast.changed status"; flow 5 "broadcast changed, ids only"; flow 6 "publish broadcast changed draft"; flow 7; flow 8 "publish broadcast changed group"; flow 9 "publish broadcast changed deleted"; flow 10 "publish broadcast changed status"; flow 11 "broadcast changed report or status, at most once per second per broadcast"; flow 12 "broadcast changed report"; flow 13 "publish broadcast changed status"; flow 14 "broadcast changed report"; flow 15 "publish broadcast changed draft for the copy".
- **Panel reaction:**
  - drop a frame of another workspace;
  - the Broadcasts list (SCR-24) re-reads `listBroadcasts` on any change (one fetch in flight; a frame during a fetch schedules one more);
  - an open broadcast page (SCR-28) of `broadcast_id` re-reads `getBroadcast` and its current `listBroadcastRecipients` page on `report` and `status`, one fetch at a time (flow 11);
  - an open draft editor (SCR-25) of `broadcast_id`: on `status` it re-reads `getBroadcast` and switches to the read-only page (a teammate launched it); on `deleted` it shows the not-found card; on `draft` / `group` from a teammate it does **not** refetch (counts are not pushed live, ux-flows) — the next save answers with the current draft or `BROADCAST_DRAFT_CHANGED`;
  - the group picker and the dialogs ignore it.

### Frame: `contact.changed` (v1) — changed

```json
{ "type": "contact.changed", "v": 1, "workspace_id": "<uuid>", "contact_id": "<uuid — contacts.id>", "change": "tags | reach" }
```

- **Changed:** `change` gains `"reach"` — the contact's blocked mark for a Telegram bot changed (blocked, unblocked, or cleared by a new message). `"tags"` is unchanged (contacts events.md).
- **Origin:** seeded flow 3 "contact.changed change reach"; flow 12 "contact changed reach" (a send refused as blocked); flow 16 "contact changed reach, commit".
- **Panel reaction** (flow 16): the Contacts list (SCR-18) re-reads its current page when the contact is on it (this one change is live, unlike tags, because the marker is the list's only live field — see assumption 7 of the api-sync-report); an open profile (SCR-19) of `contact_id` re-reads `getContact`; an open draft editor does not refetch (counts are not live). The mark is per Telegram bot, and reads answer for the current bot, so a mark of an old bot changes nothing visible.

### Frame: `conversation.changed` (v1) — changed

```json
{
  "type": "conversation.changed",
  "v": 1,
  "workspace_id": "<uuid>",
  "conversation_id": "<uuid>",
  "item": { "type": "broadcast", "id": "<uuid — broadcast_items.id>" },
  "change": "created"
}
```

- **Changed:** `item.type` gains `"broadcast"`, only with `change: "created"` (assumption 5).
- **Origin:** seeded flow 2 "recordBroadcastItem when delivered or not confirmed"; flow 12 "conversation changed, item type broadcast"; flow 14 "conversation changed per item" (stale in-flight); flow 18 "conversation changed, item type broadcast, created".
- **Panel reaction** (flow 18): a tab with that conversation open re-reads `getThreadBroadcastItem` and shows the item; the inbox list (`features/inbox`) and the attention store (`features/attention/store.ts`) **ignore** a frame whose `item.type` is `broadcast` — no list refetch, no attention refetch (ADR-0010). Never `markConversationRead`.
- **Old bundles:** a tab opened before the deploy parses `LiveFrame` without these values, so the frames fail `safeParse` and are ignored (the existing "unknown → ignore" rule). Such a tab shows a broadcast or a mark change only after its next read; accepted for the deploy window.

## Channel: realtime signals (Postgres `NOTIFY realtime`) — added signals

Delivery (at-most-once, gap → `resync`), the 1000-byte cap and zod validation in `apps/api/src/platform/realtime.ts` are unchanged.

| Signal | Payload | Dispatched to | Producers (all inside the writing transaction) | Origin (sad.md §6) |
|---|---|---|---|---|
| `broadcast.changed` v1 | `workspace_id`, `broadcast_id`, `change` | every socket of `workspace_id`, as the frame above | `createBroadcast`, `saveBroadcastFields`, `saveBroadcastAudience`, `duplicateBroadcast` (`draft`); `addBroadcastGroupContact` / `removeBroadcastGroupContact` / `addBroadcastGroupMatching` when a row was written (`group`); `launchBroadcast` with `launched`, `stopBroadcast` with `stopped`, the send link's finish and abort (`status`); the send link's outcome transactions, coalesced, and its stale-in-flight resolution (`report`); `deleteBroadcast` (`deleted`) | seeded 1, 2, 4; flows 5–15 |
| `contact.changed` v1 | `workspace_id`, `contact_id`, `change: "reach"` | every socket of `workspace_id` | `contacts.recordBlockChange` from `bots` (a `my_chat_member` update, a reply or broadcast send refused as blocked) and capture's `upsertFromProfile` when it clears a block — only when a mark changed (assumption 4) | seeded 3; flows 12, 16 |
| `conversation.changed` v1 | as before, `item.type: "broadcast"`, `change: "created"` | every socket of `workspace_id` | `conversations.recordBroadcastItem`, in the recipient's outcome transaction (delivered or not confirmed) and in the stale-in-flight resolution | seeded 2; flows 12, 14, 18 |
| `contact.changed` `tags`, `tags.changed`, `bot.changed`, `membership.deactivated`, `telegram_link.changed` | unchanged | unchanged | unchanged | — |

- **Not signalled:** every refusal (`BROADCAST_*`, `TAG_NOT_FOUND`, `OWNER_ONLY`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`) and every `unchanged` answer. The transaction rolls back or writes nothing.
- **Size:** at most three ids and a short string, well under the cap.

## Channel: pg-boss queues — added

Created and registered by `buildApp()`; workers in `apps/api/src/modules/broadcasts/infra/jobs.ts` (sad.md §7). Payloads are ids only.

### Job: `broadcasts.send` (v1)

```json
{ "workspace_id": "<uuid — the workspace whose sending broadcasts this link serves>" }
```

- **Producer:** `launchBroadcast` (the first link, enqueued with `jobDb(tx)` inside the launch transaction); each link (its successor, in its last transaction, while a broadcast of the workspace still sends — delayed with `startAfter` to the bot's send pause end when paused); the dead-letter handler (a fresh link 60 s later).
- **Consumer:** the `broadcasts.send` worker — one link of at most 20 s: resolve recipients left `sending` by a dead link as `not_confirmed` (with their broadcast items at the claim time), then serve the sending broadcasts round-robin (oldest launch first), at most 8 sends in flight, each claimed (`waiting → sending`, committed) before `bots.sendBroadcastMessage`; record each outcome; finish or abort broadcasts; enqueue the successor (seeded flow 2, flows 12–14, 19).
- **Policy:** `stately`, `singletonKey` = `workspace_id` (one active link per workspace across instances), retry limit 3 with back-off, expire 60 s, dead letter `broadcasts.send-dlq`. Worker concurrency 16 links per instance.
- **Idempotency:** the link carries no state. A redelivered or retried link finds the same waiting recipients; a recipient that is not `waiting` is never claimed again (the conditional single-row claim is the at-most-once key, ADR-0007), and a recipient left `sending` is resolved `not_confirmed`, never resent.
- **Origin:** seeded flow 1 "enqueue first broadcasts.send link"; seeded flow 2; flow 10 "commit with the first link queued"; flow 14.

### Job: `broadcasts.send-dlq` (v1)

```json
{ "workspace_id": "<uuid>" }
```

- **Producer:** pg-boss, after 3 failed attempts of a `broadcasts.send` link.
- **Consumer:** the dead-letter handler — logs an error (workspace id only) and enqueues a fresh `broadcasts.send` link of the workspace with `startAfter` 60 s, so the chain resumes without any cross-workspace read (no new tenancy exception, ADR-0007).
- **Origin:** flow 14 "route the link to the dead-letter queue … queues a fresh link of W 60 s later".
- **Alert:** any job on this queue (sad.md §7).

### Job: `broadcasts.measure-blocked-share` (v1)

```json
{ "workspace_id": "<uuid>", "broadcast_id": "<uuid>" }
```

- **Producer:** the transaction that ends a broadcast (finish, abort or stop), `startAfter` 48 h, `singletonKey` = `broadcast_id` (one per broadcast).
- **Consumer:** `broadcasts/app/blocked-share.ts` — counts the broadcast's delivered recipients whose contact is now blocked for the launch Telegram bot and logs `broadcast.blocked_share` (below). No panel surface.
- **Policy:** retry limit 2; no dead letter (a missed measurement is a missed log line).
- **Origin:** flow 13 "queue the blocked-share measure for A 48 h later, one per broadcast"; sad.md §4 supporting choices.

## Inbound Telegram update: `my_chat_member` — added

- **Producer:** Telegram, through `POST /api/telegram/webhook/{botId}` (secret checked before the body is parsed), now that `allowed_updates` names `my_chat_member`. Bots connected before this feature get it after their next health check re-registers the webhook (flow 17).
- **Consumer:** `bots.classifyUpdate` → a `reach` decision for a private chat (`new_chat_member.status` `kicked` → blocked, `member` → unblocked) → `contacts.recordBlockChange(workspaceId, telegramBotId, telegramUserId, blocked, at = date)`. Classified before the inbound interceptor and capture: never a message, conversation, unread, attention change or ping.
- **Ordering:** none from Telegram; the reach row's `changed_at` makes the newest fact win (ADR-0002).
- **Delivery:** at-least-once (Telegram redelivers on `500`); applying the same fact twice changes nothing.
- **Origin:** seeded flow 3; flow 16; flow 17.

## Log events (structured logs, not on the bus)

| Event | Fields | Producer | Consumer |
|---|---|---|---|
| `broadcast.blocked_share` | `workspace_id`, `broadcast_id`, `delivered_count`, `blocked_since_count`, `share` | `broadcasts.measure-blocked-share`, 48 h after the broadcast ended | team monitoring: alert when `share` > 0.05 (spec §7, OQ-1) |
| `broadcast.launched` | `workspace_id`, `broadcast_id`, `recipient_count`, `blocked_count`, `never_wrote_count` | `launchBroadcast`, after commit | metrics (sad.md §7) |
| `broadcast.ended` | `workspace_id`, `broadcast_id`, `end_reason`, counts by state and reason, launch-to-finish ms | finish / abort / stop transaction, after commit | metrics; "Duplicates sent" integrity query (spec §7) |
| `broadcast.link` | `workspace_id`, sends, sends per second, in-flight peak, time paused, stale in-flight resolved | each link, at its end | metrics; alert on stale in-flight resolutions and a link waiting more than 20 s (sad.md §7, §11) |

Ids, counts, states and reasons only — never the text, a name or a chat id.

## Idempotency & retry

- **Socket frames:** at-most-once. A lost `broadcast.changed` costs a refetch on the next frame, `resync` or reload; no frame carries state.
- **Signals:** exist only if their transaction committed.
- **HTTP writes:** idempotent by state under the broadcast row lock — a second launch answers `already_launched`, a second stop `unchanged`, a repeated group add or remove `unchanged`, a repeated delete `404`. No `Idempotency-Key` (api-sync-report.md *Deviations*).
- **Jobs:** `broadcasts.send` retries 3 times with back-off, then the dead-letter handler restarts the chain; per recipient there is no retry except a rate-limited recipient going back to `waiting` (nothing was sent). `broadcasts.measure-blocked-share` retries 2 times.

## Schema registry

- Socket frames: `LiveFrame` in `packages/shared/src/inbox.ts` gains `BroadcastChangedFrame` (`change: z.enum(['draft','group','status','report','deleted'])`); `ContactChangedFrame.change` becomes `z.enum(['tags','reach'])`; `ConversationChangedFrame.item.type` gains `'broadcast'`, with a refine that a broadcast item is `created` only (as `activity`). All non-strict like the existing frames.
- Signals: `realtimeSignalSchema` in `apps/api/src/platform/realtime.ts` gains `broadcast.changed` and the widened enums. The hub (`modules/inbox/infra/hub.ts`) maps each to its frame for every socket of the workspace.
- Publishers: `modules/broadcasts/infra/signals.ts` (with the 1 s coalescing), `modules/contacts` reach writes, `modules/conversations` `recordBroadcastItem`.
- Job payloads: zod schemas next to the workers in `modules/broadcasts/infra/jobs.ts`.
- Validator: zod 4.
