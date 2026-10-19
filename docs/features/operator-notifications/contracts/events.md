---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-19"
feature_size: M
---

# Events — operator-notifications

This is the async contract for the flows drawn in `sad.md` §6. It is **derived** from the sequences: every frame, signal and job here maps to a push, publish or enqueue message in a §6 diagram. It is a **delta** over [shared-inbox `events.md`](../../shared-inbox/contracts/events.md) and [assignment-statuses `events.md`](../../assignment-statuses/contracts/events.md). Every channel, frame, close code, signal and queue not named here is unchanged and stays defined there.

The feature adds:

- **Live socket:** one server → client frame, `telegram_link.changed`, delivered only to the sockets of the account it concerns ([ADR-0010](../adr/0010-signal-telegram-link-changes-on-an-account-scoped-frame-delivered-only-to-that-members-sockets.md)). One client → server frame, `presence`, the first frame the server reads ([ADR-0002](../adr/0002-track-presence-as-per-tab-leases-in-postgres-refreshed-by-the-workspace-live-socket.md)). Existing frames get new consumers (the attention store, the desktop notifier, Settings — Notifications).
- **Realtime signals:** one signal, `telegram_link.changed { workspace_id, account_id }`.
- **pg-boss:** three queues, `notifications.schedule-pings` (cron), `notifications.send-pings` (the per-workspace sweep and send) and `notifications.send-bot-message` (the bot's answers in a member's chat), plus the dead letter `notifications.send-bot-message-dlq` ([ADR-0005](../adr/0005-decide-pings-in-a-per-workspace-sweep-every-20-s-with-a-per-period-ledger-written-before-the-send.md), [ADR-0006](../adr/0006-pace-pings-below-a-per-bot-share-of-the-telegram-limit-and-pause-them-on-any-rate-limit-answer.md), sad.md §7).
- **Inbound Telegram updates:** the contract of bot-connection's `receiveTelegramUpdate` is unchanged, but every private update now passes the inbound interceptor before capture ([ADR-0003](../adr/0003-intercept-connect-link-starts-and-linked-members-messages-in-bots-before-capture-through-a-port.md)).

As before, no frame, signal or job payload carries a name, a message or ping text, a connect token or its hash, or a bot token: ids, kinds and times only (sad.md §8 *Logging*, *Events*, *Jobs*). The one exception is the Telegram user id in two answer kinds of `notifications.send-bot-message` (data-model assumption 3), which the security review must accept.

## Assumptions (autonomous run 2026-10-19)

Each can be vetoed at review.

1. **`presence` wire field is `on_screen`** (snake_case like every other frame field and the `tab_presences.on_screen` column). sad.md writes it `presence { onScreen }`; that was descriptive.
2. **The `telegram_link.changed` frame carries no `account_id`.** It only reaches the sockets of that account, so the frame needs only the workspace id. This matches the `read` precedent, where the signal carries `account_id` and the frame does not.
3. **`notifications.send-pings` re-enqueues itself** (a chain link with `startAfter` 20 s, or the end of the bot's send pause) and the minute cron is the backstop for a broken chain. This is how sad.md §7 says "a failed run is replaced by the next chain link or by the cron".
4. **The dead letter of the answer job is named `notifications.send-bot-message-dlq`**, after `inbox.deliver-replies-dlq`. It has no handler: the link state in the panel is already right, and only the chat answer is lost (flow 10).
5. **`cannot_connect` carries a `reason`** (`telegram_linked_to_teammate` | `member_linked_elsewhere`) so the text can say why (AC-06).
6. **The lease is registered when the socket opens, with `on_screen = false`, and the opening `presence` frame sets it.** sad.md flow 7 draws the frame and the registration as one step (`opened(…, onScreen)`); registering on open means a tab that never sends the frame (an old bundle, a lost frame) still counts as connected but not on screen, the safe direction: it can only make a member away sooner, never present when they are not. `tasks` may instead hold the registration until the first frame; the contract is the same either way.

## Channel: live socket (`GET /api/workspaces/{workspaceId}/inbox/live`) — changed

The producer, the heartbeat (ping every 25 s), the 5 s re-check, the at-most-once delivery and the close codes are unchanged (shared-inbox events.md). Changed:

- **Opener:** the workspace frame (SCR-15), on every page of the workspace, one socket per tab, shared by the inbox, attention and notifications stores (ADR-0002).
- **Direction:** server → client **and** client → server. The client sends only `presence`. The server reads only `presence` and ignores anything else without closing the socket.
- **Lifecycle side effects:** open → a presence lease for this connection (assumption 6). Pong → the lease is extended. A clean close, including `4403` / `4401` when access ends → the lease is deleted. A server-initiated `1001` (deploy, restart) does **not** delete it: the tab reconnects to another instance with a new lease, and the old one keeps counting until it lapses, so a restart never makes an on-screen member look away. A dead connection stops counting once its lease passes, at most 50 s after the last pong (flow 7).

### Frame: `presence` (v1) — client → server, added

```json
{ "type": "presence", "v": 1, "on_screen": true }
```

- **Required fields:** `type`, `v`, `on_screen` (boolean: Page Visibility `visible`, i.e. the selected tab of a window that is not minimised).
- **When sent:** once right after the socket opens, and on every `visibilitychange`.
- **Server handling** (flow 7):
  - parsed with zod; a frame that fails (unknown type, extra or wrong fields, over the existing 1024-byte inbound cap `LIVE_MAX_INBOUND_BYTES`) is ignored;
  - at most one write per second per socket: a frame outside a window is written at once (leading edge, so a reconnected tab's opening frame is not held back), frames inside it collapse into one trailing write with the last value;
  - `on_screen: false` → `tab_presences.on_screen = false`; `last_on_screen_at = now` **only on a real on → off transition** (the lease was on screen). An off frame on a lease that was never on screen (a tab that opened or reconnected hidden) keeps `last_on_screen_at` NULL, so it counts away at once; a repeated off frame keeps the time the tab left;
  - `on_screen: true` → `on_screen = true`. If this member got a ping in this workspace within the last 15 min, that ping's `opened_at` is set (spec §7 "ping → panel" KPI). The same happens when the first frame after open says `true`.
  - every write is scoped by the socket's workspace id and connection id, so a frame affects only its own member's lease (sad.md §8 *Untrusted content*).
- **Away for W** = no lease of this member with `live_until > now` and (`on_screen` or `last_on_screen_at > now − 10 min`). That gives the spec §6 freshness: away ≤ 60 s after a lost tab, ≤ 10 min + 60 s after a hidden one.
- **Origin:** sad.md §6 flow 7 "presence frame with on screen true or false, sent when the connection opens"; seeded flow 3 "presence frame, not on screen"; flow 14 "the frame opens its live connection, on screen"; §8 *Events*.

### Frame: `telegram_link.changed` (v1) — server → client, added

```json
{ "type": "telegram_link.changed", "v": 1, "workspace_id": "<uuid — telegram_links.workspace_id>" }
```

- **Required fields:** `type`, `v`, `workspace_id`.
- **Delivered to:** only the sockets of the signal's `account_id` in that workspace (the hub's existing account filter, as for `read`). No teammate's tab learns about a member's link.
- **Origin:** seeded flow 2 "telegram link changed for this account, in the transaction"; seeded flow 1 "link reachable again / link not reachable, account-scoped signal in the outcome transaction"; flows 9, 15, 16 and 18.
- **Panel reaction:** Settings — Notifications (SCR-16) and an open connect dialog (SCR-17) re-read `getNotificationSettings`. The dialog turns "Connected" by itself after the Start (AC-04). SCR-16 shows "Not reachable", "Not connected" after a removal, and Connect Telegram again while the bot is ready (AC-06, AC-10). Other pages ignore it. Settings — Team does **not** follow it: the owner's mark is read when Team opens (flow 15).

### Existing frames — new consumers

| Frame | New consumer | Re-reads | Spec |
|---|---|---|---|
| `conversation.changed` (`created` / `message`, `created` / `activity`, `read`) | attention store (workspace frame) | `getAttentionCount`, debounced 300 ms | AC-01 |
| `conversation.changed` (`created` / `message` only) | desktop notifier | the row it already re-reads (`getConversation`); it posts a candidate to the service worker only when the opt-in and permission are on and the row is open and the caller's or unassigned. Edits, replies and activity entries never post (flow 6) | AC-02 |
| `bot.changed` | Settings — Notifications | `getNotificationSettings` ("Pings paused", whether a connect link is offered) | AC-10, AC-13 |
| `resync` | attention store, Settings — Notifications | `getAttentionCount`, `getNotificationSettings` | AC-01, AC-04 |
| `membership.deactivated` (close `4403`) | unchanged | — the access-removed landing; the close deletes the tab's presence lease | AC-12 |

- **Old bundles:** a tab opened before the deploy parses `LiveFrame` without `telegram_link.changed`, so the frame fails `safeParse` and is ignored (the existing "unknown → ignore" rule). Such a tab sends no `presence` frame, so its lease stays `on_screen = false` (assumption 6) and the member counts away from that tab. Pings may then reach a member who is looking at an old tab, until it reloads; that is accepted for the deploy window.

## Channel: realtime signals (Postgres `NOTIFY realtime`) — added signal

Delivery (at-most-once, gap → `resync`), the 1000-byte cap and zod validation in `apps/api/src/platform/realtime.ts` are unchanged.

| Signal | Payload | Dispatched to | Producers (all inside the writing transaction) | Origin (sad.md §6) |
|---|---|---|---|---|
| `telegram_link.changed` v1 | `workspace_id`, `account_id` | the sockets of `account_id` in `workspace_id`, as the frame above | **redeem** (a link inserted); **disconnect** (`removed_reason = member`); **deactivation port** (`deactivated`, next to `membership.deactivated`); **bot-connected hook** (`bot_replaced`, one signal per affected account); **ping outcome transaction** when `blocked_at` is set (Telegram answered "blocked") or cleared (a ping accepted while it was set) | seeded flows 1, 2; flows 9, 15, 16, 18 |
| `conversation.changed`, `bot.changed`, `membership.deactivated` | unchanged | unchanged | unchanged | — |

- **Not signalled:** a refused redeem (link expired, cannot connect, already connected) changes no link and publishes nothing. Only its bot answer is enqueued.
- **Size:** two ids, well under the cap.

## Channel: pg-boss (`DATABASE_URL`, schema `pgboss`) — added queues

- **Producer and consumer:** the `notifications` module (`modules/notifications/infra/jobs.ts`), registered by `buildApp()`.
- **Payloads:** zod schemas in `jobs.ts`, ids and kinds only. Every job a use case decides is enqueued in that use case's transaction through `jobDb(tx)` (shared-inbox ADR-0004 precedent).
- **At-most-once sends:** the ping ledger (`pings` + `ping_items`) is committed before the Telegram call, as with the reply drain's in-flight mark. Answers are not deduplicated beyond the job id (flow 10 accepts a repeat after a timeout).

## Event: `notifications.schedule-pings`

```json
{}
```

- **Producer:** the pg-boss cron schedule, every minute.
- **Work:** reads *workspaces with a live Telegram link* (`SELECT DISTINCT workspace_id FROM telegram_links WHERE removed_at IS NULL`, the **sixth controlled tenancy exception**, sad.md §8, ADR-0005). It returns workspace ids only and sends one `notifications.send-pings` job per workspace. The `singletonKey` absorbs a job for a workspace whose chain is alive.
- **Retry:** none needed. The next minute's run is the retry.
- **Origin:** sad.md §7 "`notifications.schedule-pings` (cron every minute)"; ADR-0005 (cron backstop).

## Event: `notifications.send-pings`

```json
{ "workspace_id": "<uuid — workspaces.id>" }
```

- **Required fields:** `workspace_id`.
- **Producer:** the job itself (the next chain link) and `notifications.schedule-pings` (the backstop).
- **Options:** policy `stately`, `singletonKey = workspace_id` (at most one sweep running and one next link waiting per workspace across instances; `exclusive` is not used because it refuses the chain's own next link while the sweep is active), `retryLimit = 0`, `expireInSeconds = 60`. A failed run is replaced by the next chain link or by the cron (sad.md §7).
- **Work** (seeded flow 1, flow 13), every read scoped by `workspace_id`:
  1. `bots.pingReadiness(workspaceId)`. Not connected or needs a token → nothing sent, nothing queued, next link in 20 s. Send-paused until T → next link after T. Taken over counts as able to send.
  2. Drop expired presence leases. Read the live links (with `blocked_at`), the presence rows, `conversations.waitingForPings(workspaceId, { accountIds })` (linked members and assignees), the ledger items for these periods and each member's last ping.
  3. Due rules per away linked member (flow 13): not in the ledger for this period; not read, unless the period began with a reopen; 5 min for the assignee and for an unassigned conversation; 30 min for the rest of the team, or 5 min when the assignee is away, has not read it and cannot be pinged (no live link, or `blocked_at` set — known before, or found in this sweep).
  4. A member pinged less than 10 min ago waits; the set is combined into the next ping.
  5. Per remaining member, one transaction: share-lock the membership → re-read the due conversations → recompute with fresh presence and link → nothing left or membership not active → no ping. Else insert `pings` (`outcome = sending`) and one `ping_items` row per conversation (`(conversation_id, waiting_since, account_id)` unique; a conflict means another worker won), commit.
  6. `bots.sendMemberMessage({ workspaceId, telegramUserId, text })`, paced at ≤ 10 member messages per second per bot and refused while `send_paused_until` is in the future. Then a short outcome transaction:

| `sendMemberMessage` outcome | Ping row | Link | Signal | Loop |
|---|---|---|---|---|
| `accepted` | `outcome = accepted` | `blocked_at` cleared if set | `telegram_link.changed` if it was set | continues |
| `blocked` (403 "blocked by the user") | `outcome = blocked` — the attempt counts for the period, no retry | `blocked_at = now` if null | `telegram_link.changed` if it was null | continues |
| `rate_limited(retryAfter)` (429) | deleted with its items (`ON DELETE CASCADE`) — the conversations stay due | — | — | **stops**; `bots.send_paused_until = now + retry_after` (later value kept); next link after the pause |
| `bot_unavailable` (401) | deleted with its items | — | `bot.changed` (bots marks `needs_token`) | **stops** |
| `transient` (Telegram answered an error without `retry_after`, or the request was never written: definitely not delivered) | `outcome = failed` — the attempt counts, no retry | — | — | continues |
| `unknown` (timeout or connection lost after the request was written: may have been delivered) | `outcome = failed` — the attempt counts, never retried | — | — | continues |

  The member's send transaction (step 5) takes the membership `FOR SHARE`, then the advisory lock `pings:<workspace>:<account>`, then the link `FOR SHARE`, and only then re-reads the due set and the last ping, all on the transaction's own connection. Two sweeps of one workspace (one past its job expiry and the cron's new one, or two instances) therefore prepare one member one at a time, and the second sees the first's ping and keeps the 10-minute spacing. A sweep starts no member send after 30 s (`SWEEP_SEND_BUDGET_MS`); the rest go in the next link, enqueued at once, so a live sweep always ends inside `expireInSeconds = 60`. The outcome transaction updates only the link the ping went to, and only while it is still live (a link made after a Disconnect during the send is untouched).

  A process that dies between steps 5 and 6 leaves `outcome = sending`, which counts like `failed` (data-model assumption 8): never re-pinged in that period.
  7. Enqueue the next link: `startAfter` 20 s, or the end of the send pause.

- **Ping text** (built in `notifications/domain` from the workspace name, counts and the longest wait in whole minutes; its input has no field for message text, contact names or teammate names; never stored or logged):

| Due set | Text (TG-03) | Link (`PUBLIC_WEB_URL` + …) |
|---|---|---|
| one conversation | "Acme Flowers: 1 customer is waiting for your reply (5 min)" — or "…an unassigned customer is waiting…", "…a teammate's customer is waiting…" | `/w/{workspaceId}/inbox/{conversationId}` |
| all the member's own | "Acme Flowers: 4 customers are waiting for your reply, the longest 12 min" | `/w/{workspaceId}/inbox?assignee=mine` |
| all unassigned | "Acme Flowers: 4 unassigned customers are waiting, the longest 12 min" | `/w/{workspaceId}/inbox?assignee=unassigned` |
| mixed | "Acme Flowers: 4 customers are waiting for a reply (2 yours, 1 unassigned, 1 a teammate's), the longest 12 min" | `/w/{workspaceId}/inbox` (open lens, the default) |

  The link carries no credential. It goes through sign-in and the workspace guard (flow 14, AC-12).
- **Idempotency:** the ledger key `(conversation_id, waiting_since, account_id)` makes "≤ 1 ping per conversation per waiting period per member" hold across instances and restarts. The 10-min spacing is read from `pings_workspace_id_account_id_created_at_idx` inside the send transaction.
- **Retry:** none for a ping. A rolled-out ping (429, bot unavailable) is combined by the next sweep after the pause.
- **Dead-letter:** none. A failed run is logged by code and replaced by the next link or the cron.
- **Origin:** seeded flow 1 (the send), flow 13 (due sets, wording), flow 16 (bot recovery makes conversations due again), flow 17 (replies first at the sending limit); sad.md §7.

## Event: `notifications.send-bot-message`

```json
{
  "workspace_id": "<uuid — workspaces.id>",
  "kind": "connected | already_connected | notifications_off | chat_only_notifications | link_expired | cannot_connect",
  "telegram_link_id": "<uuid — telegram_links.id, for the first four kinds>",
  "telegram_user_id": "<decimal string — the sender's Telegram user id, for link_expired and cannot_connect only>",
  "reason": "telegram_linked_to_teammate | member_linked_elsewhere — cannot_connect only"
}
```

- **Required fields:** `workspace_id`, `kind`, and exactly one recipient: `telegram_link_id` for `connected`, `already_connected`, `notifications_off`, `chat_only_notifications`; `telegram_user_id` (bigint as a decimal string, `^[1-9][0-9]{0,19}$`) for `link_expired` and `cannot_connect`. `reason` is required for `cannot_connect` and absent otherwise. A zod `superRefine` enforces the pairs (data-model assumption 3).
- **Producers** (each in its own deciding transaction):

| Kind | Enqueued by | Answer text (TG-02, from the kind and the workspace name) | Spec |
|---|---|---|---|
| `connected` | redeem, a link inserted (seeded flow 2) | it will notify you about waiting customers of Acme Flowers; to stop, disconnect in the panel | AC-04 |
| `already_connected` | redeem, the member is already linked from this account (the link is used up) | you are already connected | AC-06 |
| `cannot_connect` | redeem, `reason = telegram_linked_to_teammate` / `member_linked_elsewhere` | this Telegram account cannot be connected: "already receives notifications for another member of Acme Flowers" / "you are already connected from another Telegram account — disconnect it in the panel first" | AC-06 |
| `link_expired` | redeem: no such link, expired, used, replaced, or the membership is not active | the link has expired; a new one is in the panel | AC-05 |
| `notifications_off` | `disconnectTelegram` (flow 9) | notifications are off | AC-04 |
| `chat_only_notifications` | the interceptor, a linked sender's update, only when the conditional `last_notice_at` update changed the row (≤ 1 per hour per link) | this chat only sends notifications; replies to customers are written in the panel, with a link to `/w/{workspaceId}/inbox` | AC-11 |

  Deactivation and a different bot enqueue nothing (flows 15, 16).
- **Options:** `retryLimit = 2` with backoff, `expireInSeconds = 30`, `deadLetter = notifications.send-bot-message-dlq` (sad.md §7, flow 10).
- **Work** (flow 10): read the workspace name and `pingReadiness`. Bot not connected or not working → finish without sending. Send-paused → retry after the pause. Else build the text and call `sendMemberMessage` (paced with pings, behind the same pause). Outcomes: `accepted` → done; `blocked` → done, nothing to retry; `rate_limited` → store the pause, retry after it; `transient` (definitely not delivered) → fail the attempt (pg-boss retries); `unknown` (may have been delivered) → done without a retry, logged with outcome `unknown`, so a member never gets the same answer twice. For `notifications_off`, every finish — sent, blocked, bot not working, unknown, or the last failed attempt — clears the removed link's `telegram_user_id` (data-model assumption 3).
- **Refusal throttle:** `link_expired` and `cannot_connect` go to whoever sent the start, so anyone can ask for one. At most one of each kind is queued per (workspace, Telegram user) per one-minute slot (pg-boss `singletonKey = refusal:<workspace>:<telegram user>:<kind>`, `singletonSeconds = 60`, a conditional insert); the extras are consumed silently (the update is still not captured). A flood of fake `/start tgi_…` from one account therefore costs one send a minute and cannot run the bot into Telegram's limit. A `429` still pauses every member send of the bot: Telegram's answer does not say whether the limit was the chat's or the bot's, and ignoring its `retry_after` risks a longer flood wait that would also hold up customer replies; with pings ≤ 1 per member per 10 min and refusals ≤ 1 per user per minute, no single member chat can produce the burst that triggers it.
- **Idempotency:** pg-boss job id; a completed job never runs again. A retry after a timeout may repeat the answer in the chat; answers carry no state, so this is accepted (sad.md §6 assumptions).
- **Dead-letter:** after 3 failed attempts the job goes to `notifications.send-bot-message-dlq`, logged by kind and outcome code. Nothing in the panel depends on the answer. A run-book integrity query catches a member-removed link that still holds a Telegram id an hour later (data-model assumption 3).
- **Origin:** seeded flow 2 "enqueue the answer …"; flows 9, 10, 11.

## Event: `notifications.send-bot-message-dlq`

Same payload as `notifications.send-bot-message`. **Producer:** pg-boss (`deadLetter`). **Consumer:** none; on-call drains it with the run book. Its rows hold a Telegram user id for `link_expired` / `cannot_connect` until pg-boss archives them, part of the retention the security review accepts.

## Inbound Telegram updates (bot-connection `receiveTelegramUpdate`) — behaviour change, contract unchanged

`POST /api/telegram/webhook/{botId}` keeps its request, secret check and answers. Inside `accept-update`, every private message or edit from a human sender now passes `notifications.intercept(…)` first (flow 11, seeded flow 2):

| Update | Outcome | Written | Webhook answer |
|---|---|---|---|
| `/start tgi_<43 chars>` | redeem (seeded flow 2); never captured | the link and/or the connect link's `used_at`, one bot-answer job | `200` |
| anything from a sender with a live link made with this bot (text, media, edit, any start, a campaign start included) | consumed; no contact, conversation, unread, waiting marker or reopen | at most `last_notice_at` and one `chat_only_notifications` job per hour | `200` |
| anything else (no live link, or disconnected since) | captured as before (bot-connection AC-07) | as before | `200` |
| the lookup or a write fails | nothing written | — | not acknowledged, Telegram redelivers |

A consumed update writes nothing a redelivery could repeat except the conditional notice time, so a redelivery is safe.

## Idempotency & retry

- **Socket frames:** at-most-once; a lost `telegram_link.changed` costs a refetch on the next frame, resync or reload. A lost `presence` frame is corrected by the next visibility change; a lost lease extension expires the lease (the safe direction: away).
- **Signals:** exist only if their transaction committed, so a refused redeem or an unchanged Disconnect publishes nothing.
- **Jobs:** see each event above. Pings are at-most-once per conversation per period per member (ledger); answers are at-least-once with a possible repeat.

## Schema registry

- Socket frames: `LiveFrame` in `packages/shared/src/inbox.ts` gains `TelegramLinkChangedFrame`. The client frame `PresenceFrame` is a new zod schema next to it, parsed by the hub and built by `apps/web/src/shared/api/realtime.ts`.
- Signals: `realtimeSignalSchema` in `apps/api/src/platform/realtime.ts` gains `telegram_link.changed`. The hub (`modules/inbox/infra/hub.ts`) maps it to the frame for that account's sockets only.
- Job payloads: zod schemas in `apps/api/src/modules/notifications/infra/jobs.ts` (`SchedulePingsJob`, `SendPingsJob`, `SendBotMessageJob`).
- Validator: zod 4.
