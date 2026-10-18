---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: M
---

# Events — shared-inbox

This is the async contract for the flows drawn in `sad.md` §6. It is **derived** from the sequences. Every event here maps to a publish, push or enqueue message in a §6 diagram. The feature has three kinds of async work:

- **Live socket frames (flows 2, 8, 10).** These go from the API to each open inbox tab over `openLiveSocket` ([`openapi.yaml`](openapi.yaml)). This is the only async surface the web panel consumes ([ADR-0002](../adr/0002-push-change-signals-over-a-per-tab-workspace-bound-websocket-and-refetch-through-the-reads.md)).
- **Realtime signals (all flows that write).** These are Postgres `NOTIFY` messages published inside the writing transaction and fanned out to every API instance ([ADR-0003](../adr/0003-fan-out-live-signals-through-postgres-listen-notify-published-in-the-writing-transaction.md)). They are internal to the API, and the hub turns them into socket frames.
- **Reply delivery (flows 1, 6, 7, 9).** This is the pg-boss queue `inbox.deliver-replies` and its dead letter ([ADR-0004](../adr/0004-send-replies-at-most-once-through-a-per-conversation-delivery-queue-with-an-in-flight-mark.md)).

Inbound Telegram updates stay the `receiveTelegramUpdate` operation of bot-connection. They are not repeated here, but capture and edit now publish the `conversation.changed` signal below.

None of the three ever carries a message text, a reply text, a caption, a name, a file reference or the bot token. Every payload is ids, kinds and times only (sad.md §8 *Logging*, *Events*).

## Channel: live socket (`GET /api/workspaces/{workspaceId}/inbox/live`)

- **Producer:** the `inbox` hub (`modules/inbox/infra/hub.ts`). It forwards realtime signals to the sockets of the signal's workspace.
- **Consumers:** the web panel. One socket per tab is opened by `apps/web/src/shared/api/realtime.ts` and feeds `features/inbox/store.ts`.
- **Delivery:** at-most-once and best effort. A lost frame costs a refetch, never data. The panel re-reads the first list page and the open thread after every (re)connect and on `resync`.
- **Ordering:** none guaranteed across conversations. A frame is a hint to re-read, so its order does not matter.
- **Direction:** server → client only. The client sends no data frames, and the server ignores any it receives.
- **Heartbeat:** the server sends a WebSocket ping every 25 s. A proxy idle timeout above 30 s is enough (sad.md §7).
- **Frame format:** one JSON text frame per signal. Each frame has a `type`, a version `v` and the `workspace_id`. The panel drops a frame whose `workspace_id` is not the tab's current workspace (AC-09, AC-18) and ignores unknown types and fields.

### Frame: `conversation.changed` (v1)

```json
{
  "type": "conversation.changed",
  "v": 1,
  "workspace_id": "<uuid — conversations.workspace_id>",
  "conversation_id": "<uuid — conversations.id>",
  "item": { "type": "message | reply", "id": "<uuid — messages.id | replies.id>" },
  "change": "created | edited | state | read"
}
```

- **Required fields:** `type`, `v`, `workspace_id`, `conversation_id`, `item`, `change`. `item` is null only for `change: read`.
- **Origin:** sad.md §6 flow 2 "signal conversation changed with message id"; flow 1 "signal reply created / reply state changed"; flow 5 "read signal for this member's own sockets"; flow 10 "conversation-changed signal, change edited / created"; flow 9 "reply-state signal".
- **Panel reaction:**

| `change` | `item.type` | Panel re-reads | Spec |
|---|---|---|---|
| `created` | `message` | `getConversation` (the row moves to the top and the unread count grows). If the thread is open, also `getThreadMessage`, then `markConversationRead` with its `received_at` when the tab is visible | AC-15, AC-01 |
| `created` | `reply` | `getThreadReply` if the thread is open. The row is unchanged until the reply is "sent" | AC-15 |
| `edited` | `message` | `getThreadMessage` if open. `getConversation` when it is the row's last item. The unread count is unchanged | AC-15 |
| `state` | `reply` | `getThreadReply` if open, and `getConversation` (the "sent" state moves the row and clears the "waiting" marker) | AC-06, AC-10…AC-13 |
| `read` | — | `getConversation`. This frame is sent only to the sockets of the member who read, so their other tabs update the count | AC-03 |

A late redelivery arrives as `created`/`message`, and the panel places it by `sent_at` (AC-15).

### Frame: `bot.changed` (v1)

```json
{ "type": "bot.changed", "v": 1, "workspace_id": "<uuid — bots.workspace_id>" }
```

- **Origin:** sad.md §6 flow 8 "push bot changed to every open socket of the workspace".
- **Panel reaction:** `getInboxBotStatus`. The reply box is enabled or disabled, and the "not receiving" notice is shown or hidden, without a reload (AC-13, AC-14).

### Frame: `resync` (v1)

```json
{ "type": "resync", "v": 1, "workspace_id": "<uuid>" }
```

- **Origin:** sad.md §11 / ADR-0003. After a reconnect of its `LISTEN` connection, an instance tells every socket that signals may have been missed.
- **Panel reaction:** the same as a socket reconnect. It re-reads the first list page, the open thread (latest page) and the bot status.

### Close codes

| Code | Meaning | Panel reaction | Spec |
|---|---|---|---|
| `4403` | Access removed. The membership was deactivated (the signal or the 5 s re-check) | No reconnect. The next action shows the access-removed landing (SCR-07) | AC-09 |
| `4401` | The session ended or expired (the 5 s re-check) | No reconnect. The next action leads to sign-in (SCR-09) | AC-08 |
| `1001` | The server is going away (restart, deploy) | Reconnect with backoff, then resync | — |
| `1000` | Closed by the panel (workspace switch, tab closed) | — | AC-09 |

The hub closes a member's sockets of a workspace at once on `membership.deactivated`. Independently, it re-checks every open socket every 5 s (session valid, membership active) in one query per workspace. The 5 s bound therefore holds even when the signal is lost (spec §6 access revocation).

## Channel: realtime signals (Postgres `NOTIFY realtime`)

- **Producer:** `platform/realtime.ts` `publish(trx, signal)`, called inside the writing transaction by:
  - `conversations` (capture, edit, reply create, reply state, read mark);
  - `bots` (state transitions);
  - `workspaces` (deactivation).
- **Consumers:** the realtime listener of every API instance (one dedicated `pg` connection, outside the Kysely pool), which hands each signal to the `inbox` hub.
- **Delivery:** at-most-once. A signal exists only if its transaction committed. A signal published while the listener is reconnecting is lost, and the listener answers the gap with `resync` frames.
- **Ordering:** commit order per instance. No consumer relies on it.
- **Payload limit:** Postgres caps a `NOTIFY` payload below 8000 bytes. A signal is a few hundred bytes of ids.
- **Validation:** a zod schema in `platform/realtime.ts`. The listener drops a payload that fails it and logs its type only.

| Signal | Payload | Dispatched to | Origin (sad.md §6) |
|---|---|---|---|
| `conversation.changed` v1 | `workspace_id`, `conversation_id`, `item` (`type`, `id`) or null, `change`, plus `account_id` when `change` is `read` | every socket of `workspace_id`. A `read` signal goes only to the sockets of `account_id` | flows 1, 2, 5, 6, 7, 9, 10 |
| `bot.changed` v1 | `workspace_id` | every socket of `workspace_id` | flow 8 |
| `membership.deactivated` v1 | `workspace_id`, `account_id` | not forwarded. The hub closes that account's sockets of that workspace with `4403` | flow 2 |

- **Backwards-compat policy:** additive only. A new optional field is fine. Removing or renaming a field is a new version (`v: 2`). The listener ignores unknown fields, and the panel ignores unknown frame types.

## Channel: pg-boss (`DATABASE_URL`, schema `pgboss`)

- **Producer:** the `inbox` module. `sendReply` and `resendReply` enqueue the job inside the reply's own transaction (pg-boss `send` with the caller's database executor), so a committed reply always has a job. The drain enqueues its own delayed back-off.
- **Consumers:** the `inbox` module only (`modules/inbox/infra/jobs.ts`), with a local concurrency of 2 (sad.md §7).
- **Delivery:** at-least-once (pg-boss). At-most-once *sending* to Telegram comes from the attempt log, not from the queue (see below).
- **Ordering:** per conversation, through `singletonKey = conversation_id` under the `stately` policy. At most one drain runs and one waits per conversation, and other conversations are not held up (AC-12).

## Event: `inbox.deliver-replies`

```json
{
  "workspace_id": "<uuid — conversations.workspace_id>",
  "conversation_id": "<uuid — conversations.id>"
}
```

- **Required fields:** `workspace_id`, `conversation_id`. The payload is validated with a zod schema in `modules/inbox/infra/jobs.ts` (`DeliverRepliesJob`), because it never crosses the HTTP boundary. It carries no reply text and no token.
- **Origin:** sad.md §6 flow 1 "store the reply, its member-initiated attempt and the drain job in one transaction"; flow 7 "enqueue the drain job"; flow 9 (the drain itself).
- **Options:** policy `stately`, `singletonKey = conversation_id`, `retryLimit = 3` (re-runs exist for crashes only), `expireInSeconds = 60`, queue polling interval 0.5 s (the reply-latency target, sad.md §11). A Telegram back-off is a **new** job with `startAfter = retry_after` (or the default back-off). It is never a pg-boss retry.
- **Work** (flow 9). It reads by `(workspace_id, conversation_id)`.
  1. Finds this conversation's attempt still in flight (started, no outcome). If it started more than 10 s ago, the attempt becomes `unknown` and its reply `not_confirmed`, and it is never retried on its own (AC-11).
  2. Takes the pending replies (`state = 'sending'`) oldest position first. For each one:
     - Pre-check: the author is still an active member → otherwise `not_delivered` / `author_access_removed` (AC-09). The bot can carry replies → otherwise `not_delivered` / `bot_not_working` (AC-13). The attempt is `skipped`.
     - Waits until at least 1 s has passed since the last start in this chat. Commits the attempt's `started_at` (in flight). Takes the member's unstarted attempt, or inserts a `retry` attempt for an automatic retry.
     - Calls `bots` *send text* (`sendMessage`, plain text, 10 s timeout), then records the outcome and the reply state in one transaction with a `conversation.changed` / `state` signal:

| Gateway outcome | Attempt `outcome` | Reply | Drain continues? |
|---|---|---|---|
| accepted | `accepted` | `sent`, `sent_at`, `telegram_message_id`. The conversation's `last_reply_sent_at` / `last_activity_at` are raised | yes |
| 403 blocked / deactivated account, 400 chat not found | `refused` | `not_delivered` with `customer_blocked` / `customer_account_gone` / `chat_not_found` (AC-10) | yes |
| 401 bot unauthorized | `bot_unauthorized` | `not_delivered` / `bot_not_working` (AC-13) | yes |
| 429 (`retry_after`), 5xx, connection refused before the request was written, **within** 5 min of `position_at` | `not_accepted` | stays `sending` | **no**: enqueue a delayed drain and stop, so later replies wait (AC-12) |
| the same, **after** 5 min | `not_accepted` | `not_delivered` / `telegram_not_accepted` (AC-12) | yes |
| timeout, or a reset after the request was written | `unknown` | `not_confirmed` (AC-11) | yes |

- **Idempotency:** a re-run (crash, expiry) first resolves any stale in-flight attempt as `not_confirmed` (step 1), so no attempt is ever sent twice. A duplicate job for the same conversation is absorbed by `singletonKey`. A drain with no pending replies is a no-op.
- **Retry:** pg-boss re-runs the job up to 3 times, only when the process died or the job expired after 60 s. Telegram refusals are handled by the delayed new job above, for up to 5 minutes from the reply's `position_at`.
- **Dead-letter:** after 3 failed runs the job goes to `inbox.deliver-replies-dlq`, and an alert is raised (sad.md §7). The dead-letter handler marks:
  - this conversation's in-flight attempts `unknown` (their replies become `not_confirmed`);
  - its never-attempted `sending` replies `not_delivered` / `delivery_interrupted` (never sent, so "Try again" is safe).

  Each of these writes publishes a `state` signal. **Pending design confirmation** — sad.md §6 flagged this handler for `design`, see api-sync-report.md OQ-2.

## Event: `inbox.deliver-replies-dlq`

```json
{
  "workspace_id": "<uuid>",
  "conversation_id": "<uuid>"
}
```

- **Origin:** sad.md §6 flow 9 "route the job to the dead-letter queue and alert".
- **Producer:** pg-boss (`deadLetter` option of `inbox.deliver-replies`). **Consumer:** the `inbox` dead-letter handler above.
- **Retry:** pg-boss default (the handler's writes are idempotent: it touches only attempts still unfinished and replies still `sending`).

## Schema registry

- Registry: there is no separate registry. Socket frames are zod schemas in `packages/shared/src/inbox.ts` (`LiveFrame`), shared by the hub and `shared/api/realtime.ts`. Realtime signals are zod schemas in `apps/api/src/platform/realtime.ts`. Job payloads are zod schemas in `apps/api/src/modules/inbox/infra/jobs.ts`.
- Validator: zod 4 (the repo's validator).
