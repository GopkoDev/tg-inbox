---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-19"
feature_size: "M"
target_surfaces: [backend-service, web-frontend]
---

# Software Architecture Document — operator-notifications

## 1. Introduction and goals

**Intent.** operator-notifications tells a workspace's members about customers who need them, in two tiers. **On the web**, every workspace page shows the member's **attention count** in the tab title and next to Inbox. A browser where the member turned it on shows a **desktop notification** for a new customer message in a conversation that is theirs or unassigned, while no tab of that workspace in that browser is in focus. **Away from the web**, the workspace's own business bot sends a **ping** to the member's personal Telegram. The member creates that **Telegram link** once, from the panel, through a single-use **connect link**. Pings follow the waiting-period rules of the spec: due 5 minutes after the wait began, to the assignee, or to every away linked member for an unassigned conversation. The rest of the team is reached at 30 minutes, or at 5 minutes when the assignee cannot be pinged. Pings are combined to at most one per member per workspace per 10 minutes and at most one per conversation per waiting period. Every condition is checked again at send time, and a ping never carries customer text or a contact name. The design is built around three failures named by the spec: **a forgotten customer**, **a flooded or leaked notification channel**, and **"present" that is not true**. Two smaller changes come with it. Capture now skips linked members and connect-link starts. Each member's presence on the web becomes a server-side fact that every API instance can read.

**Top-3 quality goals (1-liners; full scenarios in §10):**

1. **Timely, never flooding.** A due ping is accepted by Telegram within the spec's timeliness target. Pings respect the per-member and per-period caps exactly, even across restarts, several API instances and a bot that recovers.
2. **No leak, no capture.** No ping reaches anyone who is not an active member at send time. No ping carries customer text or a contact name. A connect link works once, for 10 minutes, for one membership. Nothing a linked member or a connect-link start sends becomes a contact or a conversation.
3. **Truthful presence and a live panel.** "Away from the web" turns true within the spec's freshness targets, and only then. The attention count and the desktop notification follow captured messages within the live-update target. Customer replies keep their latency target while pings are being sent.

**Stakeholders.**

| Role | Interest | Sign-off owner? |
|---|---|---|
| Operator | Sees the attention count, turns on desktop notifications, connects and disconnects Telegram, gets pinged when away | No |
| Business owner | Same as an operator. Also sees on Settings — Team which members have Telegram pings on or off, and fixes the bot when it blocks connecting | No |
| End customer | Is noticed within minutes. Their conversation list (the team's inbox) never fills with the team's own notification chats | No |
| Tech Lead | SAD approval | Yes |
| Security Lead | Security review of the new external channel, the account-linking flow and the new personal data (spec §6.1: review required) | Yes |

**Assumptions (autonomous run 2026-10-19)**, each can be vetoed at review:

- Depth = medium, size M and route `standard` (from `.size` / `.route`). The pipeline made every per-section decision itself, choosing the recommended option each time. Each decision is recorded in the section it belongs to.
- `docs/architecture-map.md` records `reflects_commit: 0cbaa35` and says "greenfield-bootstrap", but its module rows already describe the shipped inbox and assignment-statuses. A fresh explorer scan of HEAD `d2ec727` confirmed the code facts used here (§3 brownfield note).
- Wire shapes in this SAD (routes, frame fields, error codes) show intent only, and `api` fixes the names. Table and column names are indicative, and `data-model` fixes them.
- "The bot is not working" (spec AC-10, AC-13) means the bot row's state is `needs_token`. "Not connected" means no row or `disconnected`. "Taken over" means `taken_over`, which can still send (shared-inbox AC-14) but receives no Start, so it offers no connect link.
- The 20 s sweep period, the 50 s presence lease, the 10 pings per second budget and the one-hour notice spacing are design constants, not spec numbers. They sit in `notifications/domain` and are chosen so that the spec §6 targets hold (§10).

**Decision overrides:** none.

**Critic pass (autonomous run 2026-10-19):** six findings, all resolved as amendments (Accept amendment):
- the redeem now share-locks the membership before the connect-link row, the deactivation order, and §8 states why the lock orders are deadlock-free;
- the 5-minute team reach requires the assignee to be away, to have not read the waiting message and to be unpingable (AC-09);
- `bot_unavailable` is rolled out of the ledger like `429`, and `transient` counts;
- the post-send outcome transaction publishes `telegram_link.changed` in both directions;
- `opened_at` is also set when a tab comes back on screen;
- every presence call carries the workspace id.

## 2. Constraints

**Technical.**
- TypeScript ~6.0 (strict) on Node.js 26 in a pnpm workspaces monorepo: repo [ADR-0001](../../adr/0001-use-a-typescript-pnpm-monorepo-on-node-26.md)
- Backend: Fastify 5 with `fastify-type-provider-zod` and zod 4, `@fastify/websocket` for the live socket `GET /api/workspaces/:workspaceId/inbox/live` (ping every 25 s, membership re-validated every 5 s, inbound frames limited to 1024 bytes and **never read today**). grammY's `Api` through `telegramApi()` and the `bots` gateway is the only Telegram client. pg-boss 12 runs on the main database (policies `exclusive` / `stately`, `singletonKey`, `startAfter`, cron by the minute, `jobDb(tx)` to enqueue inside a Kysely transaction).
- Datastore: PostgreSQL 16 via Kysely 0.29, reversible migrations through kysely-ctl, types generated into `db.types.gen.ts`: repo [ADR-0004](../../adr/0004-use-postgres-with-kysely-reversible-migrations-and-workspace-scoped-tenancy.md). READ COMMITTED throughout. Row locks and transaction-level advisory locks (`hashtextextended('<key>', 0)`) are the existing serialisation tools.
- Architecture: a modular monolith with layers `domain → app → infra → http`, in one process: repo [ADR-0002](../../adr/0002-organize-the-backend-as-a-modular-monolith-with-layered-modules.md). Module dependencies are one-way: `inbox → {conversations, contacts, bots, workspaces}`, `bots → conversations → contacts`, `bots → contacts`. A module reaches a module that depends on it only through a port that it declares and `buildDeps()` fills. The precedent is `workspaces.onMembershipDeactivated`, filled with `conversations.unassignDeactivatedMember`.
- Live updates: `platform/realtime` `publish(trx, signal)` sends `pg_notify` inside the writing transaction. The payload holds ids only, is at most 1000 bytes and is zod-validated. Every API instance LISTENs on one dedicated connection, and the `inbox` hub (in memory, per instance) dispatches to the sockets of the workspace. `read` frames already go only to the same account's sockets: shared-inbox [ADR-0002](../shared-inbox/adr/0002-push-change-signals-over-a-per-tab-workspace-bound-websocket-and-refetch-through-the-reads.md), [ADR-0003](../shared-inbox/adr/0003-fan-out-live-signals-through-postgres-listen-notify-published-in-the-writing-transaction.md).
- Telegram: the business bot is an ordinary bot that customers write to in a private chat. Replies are `sendMessage` to the customer's chat. A member's private chat with the same bot has chat id = the member's Telegram user id. A deep link `https://t.me/<bot username>?start=<payload>` delivers `/start <payload>` as a private message. The payload is at most 64 characters from `A–Z a–z 0–9 _ -`. Telegram allows roughly 30 messages per second per bot and 1 per second per chat, and answers `429` with `retry_after` above that. A user who blocked the bot gets `403`.
- Frontend: React 19 + Vite SPA with Tailwind + shadcn/ui, Zustand stores per feature and React Router (`/w/:workspaceId/…`). Today the live socket is opened by the inbox store only. The web code has no `document.title`, `Notification`, focus or `BroadcastChannel` code and no service worker.

**Organisational.**
- Effort budget: size M, a separate epic of 5–15 PRs over 1–2 sprints (`.size`), route `standard`.
- Deadline: none in the spec. Pilots of 3+ operators are about to rely on the inbox for whole working days (spec §1).
- Team composition: not stated. The pipeline assumes one backend + frontend implementer working through `tasks.json`.

**Conventions.**
- [`CLAUDE.md`](../../../CLAUDE.md) and [`docs/architecture-map.md`](../../architecture-map.md) §Conventions are binding. Each module exposes `register<Module>(app, deps)`. Only `buildDeps()` constructs dependencies and only `buildApp()` registers modules and workers. Imports flow inward. Other modules are reached only through their app layer, never through their tables.
- IDs are UUIDv7 from `newId()`. Telegram ids (user id, bot id) are `bigint` columns, never primary keys.
- Errors are `AppError` subclasses (`NotFoundError`, `ConflictError`, `TooManyRequestsError`, …), with codes declared in `packages/shared/src/errors.ts` and returned in the single envelope.
- Every tenant-owned table has a non-null `workspace_id`, and every repository method takes `workspaceId`. Each repository gets a cross-workspace isolation test. This design adds **one** controlled tenancy exception to the five that exist (§8, [ADR-0005](adr/0005-decide-pings-in-a-per-workspace-sweep-every-20-s-with-a-per-period-ledger-written-before-the-send.md)). That is the "change to the SAD" CLAUDE.md asks for.
- Async work goes through pg-boss queues named `<module>.<job>`, with workers in `modules/<m>/infra/jobs.ts`, registered by `buildApp()`. A job is enqueued in the writing transaction when it follows a write.
- Bot tokens stay inside `bots`. Nothing in this feature sees, logs or returns a token.
- No triggers or stored procedures. Migrations are reversible: expand, then migrate, then contract.
- UI composes shadcn/ui primitives from `apps/web/src/shared/ui`, Tailwind only, per `docs/design-system.md` (desktop-first, usable at ≥ 360 px).

**Regulatory / external.**
- Data classification is confidential (spec §6.1).
- New personal data: each member's linked Telegram account (Telegram user id and display name, shown only to that member), the record of pings (to whom, for which conversations, when, with what outcome) and per-tab presence (which member has which workspace open and whether it is on screen). No new end-customer data.
- Retention: presence rows live only as long as their tab's connection, plus at most one lease. A removed Telegram link keeps its row with the reason and the times for the §7 KPIs, but its Telegram id and display name are cleared at removal. Pings are kept like messages. Removal is by hand on request (§11).
- The web panel's service worker is used only for notifications. It caches nothing and intercepts no request (ADR-0009).
- No compliance regime is named. A security review is required before release (spec §6.1).

## 3. Context and scope

tg-inbox is a shared Telegram inbox for small businesses. With shared-inbox and assignment-statuses, a workspace's team reads, owns, answers and closes its customers' conversations in one web inbox. This feature reaches members who are not looking at the inbox. In the browser it uses the tab title, the navigation and the operating system's notifications. Outside the browser it uses the member's personal Telegram, through the workspace's own business bot. It reacts to the inbound events that already exist: a customer message captured from the bot's webhook, a reply marked sent, an assignment or status change, a deactivation and a bot connected or replaced. It adds two new inbound events. A member presses Start on a connect link in Telegram. A linked member writes to the bot.

The trust boundary moves in two places. **First, the business bot's private chats now carry two kinds of people.** End customers are captured as before. Linked members and anyone who opens a connect link are never captured. Their messages are handled by the notifications rules before capture and never reach `conversations`. **Second, workspace activity now leaves the panel's sign-in boundary.** A ping lands in a personal messenger and on a lock screen, so it carries only the workspace name, counts, the longest wait and a panel link. That link goes back through the panel's sign-in and membership checks. Presence comes from the browser and is therefore untrusted. A tab that lies about being on screen can only make its own member look present, so that member misses pings but nobody else is affected (§11).

<!-- brownfield: HEAD d2ec727 (explorer scan, 2026-10-19) — modules auth, workspaces (guard, activeMembersAmong, lockActiveMembers, team.deactivateMembership calling the single onMembershipDeactivated port filled with conversations.unassignDeactivatedMember in deps.ts:137-144), bots (webhook POST /api/telegram/webhook/:botId, accept-update.ts classifies message / edited_message from private human senders and calls conversations.captureInbound / applyEdit; no /start special case, so a /start <payload> is captured today as a customer message; sendText = plain sendMessage by the bot to a chat id, states connected | taken_over allowed; no per-bot send budget; a different bot can be connected only after the old row is deleted, decidePaste in bots/domain/connection.ts), conversations (capture tx: contact upsert → conversation upsert → message insertOnce → raiseReceived under the row lock with reopen; read marks raise a per-member arrival watermark and publish conversation.changed change=read with account_id; unread per row computed in list-queries.ts as received_at > GREATEST(read_through_at, active_since); waiting derived, no waiting-since column), inbox (hub in memory per instance: Map<socket, {workspaceId, accountId, sessionId}>, read frames only to the same account, membership.deactivated closes with 4403, ping 25 s, revalidate 5 s; LIVE_MAX_INBOUND_BYTES 1024, client frames never read; queues inbox.deliver-replies stately + DLQ); platform/realtime pg_notify in tx, one LISTEN client per instance with onGap resync; pg-boss 12 queues bots.schedule-health-checks (cron) and bots.check-health (exclusive per bot); web: openLiveSocket in shared/api/realtime.ts used by features/inbox/store.ts only, visibilityState used only for read marks, no title / Notification / focus / BroadcastChannel / service worker; fake-telegram.ts scripts sendMessage answers, no inbound-update injection helper -->

**External systems (in / out):**

| Actor or system | Type | Interaction |
|---|---|---|
| Operator | Person | Sees the attention count and desktop notifications. Connects and disconnects Telegram in Settings — Notifications. Opens a connect link in Telegram. Receives pings and follows their panel link |
| Business owner | Person | Everything an operator does. Sees "Telegram pings on / off" per member in Settings — Team. Deactivating a member (existing) now also removes their link |
| End customer | Person | Writes to the business bot (unchanged). Is never told about pings |
| Telegram Bot API | System (external) | In: webhook updates (unchanged), now including connect-link starts and linked members' messages, which are not captured. Out: `sendMessage` to members' private chats for pings and bot answers, in addition to replies. Its rate limit is shared with replies |
| Browser and operating system | System (external) | Page Visibility and focus state of each tab, the notification permission prompt, desktop notifications shown through the panel's service worker |

**C4 Context (L1):**

```mermaid
C4Context
    title operator-notifications — System Context

    Person(operator, "Operator", "Watches the attention count, gets desktop notifications and pings, links Telegram")
    Person(owner, "Business owner", "Same as an operator, sees who has pings on, deactivates members")
    Person(customer, "End customer", "Writes to the business bot in Telegram")

    System(tginbox, "tg-inbox", "Shared inbox that tracks member presence and notifies members about waiting customers")

    System_Ext(telegram, "Telegram Bot API", "Webhook delivery of updates, sendMessage to customers and to linked members")
    System_Ext(browser, "Browser and operating system", "Tab visibility and focus, notification permission, desktop notifications")

    Rel(operator, tginbox, "Reads the count, manages the Telegram link, opens ping links", "HTTPS, WebSocket")
    Rel(owner, tginbox, "Same as an operator, Team view", "HTTPS, WebSocket")
    Rel(customer, telegram, "Writes to the business bot", "Telegram app")
    Rel(operator, telegram, "Presses Start on a connect link, receives pings", "Telegram app")
    Rel(telegram, tginbox, "Pushes customer messages, connect-link starts, linked members' messages", "HTTPS webhook")
    Rel(tginbox, telegram, "Sends replies, pings and bot answers", "HTTPS Bot API")
    Rel(tginbox, browser, "Reports tab presence, shows desktop notifications", "Page Visibility, Notifications API, service worker")
```

## 4. Solution strategy

**Target surfaces:** `backend-service` and `web-frontend`. The backend gets a new `notifications` module with its own tables, routes, jobs and ports. It also gets a capture interception in `bots`, a waiting-period start and an attention-count query in `conversations`, a second deactivation handler, and presence frames on the existing live socket in `inbox`. The frontend extends the existing SPA in four places: the workspace frame's count, Settings — Notifications with the connect dialog, the Team mark, and desktop notifications through a service worker. The ping scheduler is a set of pg-boss jobs inside the same API process, like the reply drain and the bot health checks. So no separate `worker` surface is declared, which follows the shared-inbox and bot-connection precedent. The member's Telegram chat (TG-01…TG-03) is the bot's output, not a surface we build a UI for. This surface split is recorded with the module decision in [ADR-0001](adr/0001-add-a-notifications-module-that-owns-telegram-links-presence-and-pings-and-is-reached-through-ports.md).

**UI architecture (web-frontend):** client-side SPA, already fixed by repo ADR-0001. No new UI ADR is needed for the delivery model. Three structural changes follow from the backend decisions:
- **The live socket moves from the inbox store to the workspace frame.** The attention count must follow the member onto Contacts and Settings (AC-01), and presence counts any workspace page (spec §1 D1). So the frame (SCR-15) opens one live connection per tab per workspace, through `openLiveSocket`. It hands frames to subscribers: the inbox store, the attention store, the notifications settings store and the desktop notifier. The inbox store stops opening its own socket. This is part of [ADR-0002](adr/0002-track-presence-as-per-tab-leases-in-postgres-refreshed-by-the-workspace-live-socket.md).
- **Stores:** a small attention store per workspace (count, refetched on frames, ADR-0008) and `features/notifications/store.ts` for SCR-16 / SCR-17 (link state, bot readiness, connect link, desktop opt-in). The desktop opt-in is a per-browser flag in `localStorage`, keyed by account and workspace. It is a per-viewer convenience, read in try/catch, and is off when storage is unavailable.
- **Routes:** Settings — Notifications is a new settings page under `/w/:workspaceId/settings/notifications`, open to both roles. The connect dialog (SCR-17) is a shadcn `Dialog` over it. Ping links land on existing inbox addresses (`/w/:workspaceId/inbox/:conversationId` or the inbox with the `mine` / `unassigned` / open lens parameters). `screens` picks the primitives. The scannable code is drawn client-side from the link, so no image is served.

**Top strategic choices (the seeds for ADRs):**

1. **A new `notifications` module owns Telegram links, connect links, presence and pings. It calls `conversations`, `workspaces` and `bots`, and they reach it only through ports.** Static edges: `notifications → {conversations, workspaces, bots}` and `inbox → notifications` (the hub reports presence). There are two runtime edges through ports that `buildDeps()` fills. `bots` declares an **inbound interceptor** (choice 3) and a **bot-connected hook**. `workspaces` keeps one `onMembershipDeactivated` port, which `buildDeps()` now fills with a composition of `conversations.unassignDeactivatedMember` and `notifications.removeLinkOnDeactivation`. The graph stays acyclic. `bots` stays the only module that talks to Telegram, and `inbox` keeps owning no tables (goals 1 and 2): [ADR-0001](adr/0001-add-a-notifications-module-that-owns-telegram-links-presence-and-pings-and-is-reached-through-ports.md).
2. **Presence is a per-tab lease row in Postgres, refreshed by the workspace live socket.**
   - When a tab's socket opens, the hub registers it with `notifications.presence`. The row holds the workspace, the account, a tab connection id, `live_until`, `on_screen` and `last_on_screen_at`.
   - Every pong the server receives (every 25 s) moves `live_until` to now + 50 s. A dead connection therefore stops counting at most 50 s after its last pong, which is within the spec's 60 s.
   - The client sends one small frame `{ type: 'presence', onScreen }` when the socket opens and on every `visibilitychange`. This is the first client frame the socket reads, within the existing 1024-byte limit. `document.visibilityState === 'visible'` is exactly "the selected tab of a window that is not minimised". A covered window may still report visible, which is the spec's safe direction. When a tab leaves the screen, the server stamps `last_on_screen_at = now`.
   - A clean close deletes the row. A crash leaves it to expire.
   - A member is **away** for a workspace when no row of theirs has `live_until > now` and (`on_screen` or `last_on_screen_at > now − 10 min`).
   - Every API instance and every job reads the same rows, so the answer is correct with any number of instances and survives restarts (goal 3): [ADR-0002](adr/0002-track-presence-as-per-tab-leases-in-postgres-refreshed-by-the-workspace-live-socket.md).
3. **Capture is intercepted in `bots`, before `conversations`, through a port `notifications` fills.** `bots/app/accept-update.ts` classifies an update as today. Then, for every private message or edit from a human sender, it asks `inboundInterceptor.intercept({ workspaceId, telegramBotId, from, kind, text })` before it calls `captureInbound` or `applyEdit`. The answer is `pass` (capture as before) or `consumed`. `notifications` answers `consumed` in two cases:
   - the text is `/start tgi_<token>`, a connect-link start (choice 4), whether or not the sender is linked;
   - the sender's Telegram user id has a live link in this workspace, made with this bot (any message, edit or start, campaign links included, AC-11).

   A consumed update creates no contact and no conversation, and changes no unread count, waiting marker or status. The lookup is one indexed read per private update, scoped by the workspace id that the webhook's bot already gives. A sender without a link, and a start through a business's own campaign link, pass through unchanged (bot-connection AC-07) (goal 2): [ADR-0003](adr/0003-intercept-connect-link-starts-and-linked-members-messages-in-bots-before-capture-through-a-port.md).
4. **Connect links are random single-use tokens. Only their SHA-256 hash is stored, and they are redeemed through the bot's start payload.**
   - **Issue.** "Connect Telegram" creates 32 random bytes and shows `https://t.me/<bot username>?start=tgi_<base64url token>` (47 characters of payload, within Telegram's 64). The server stores the hash, the membership, the creation time and the expiry (+10 min). Creating a link marks the member's previous unused link replaced.
   - **Limit.** At most 5 links per 10 minutes per member, counted from the stored rows under `connect-links:<ws>:<account>` (AC-13).
   - **Redeem.** Redemption runs in one transaction:
     - the link row is found by `(workspace_id, token_hash)` with a plain read, which gives its membership;
     - the membership is share-locked (`workspaces.lockActiveMembers`) and must be active. It is locked **before** the connect-link row, the same order as deactivation (§8), so the two cannot deadlock;
     - the connect-link row is then locked `FOR UPDATE` and re-checked: it must be unused, unexpired and not replaced;
     - the two uniqueness rules are checked: one live link per membership, one live link per Telegram user per workspace. Partial unique indexes back them up;
     - the link row is written and the connect link is marked used;
     - an account-scoped signal is published (choice 7), and the bot's answer is enqueued.

     Every refusal still uses the link up and answers in the chat (AC-05, AC-06).
   - **Binding.** A link records the bot's **Telegram bot id**. A token rotation keeps it. When a different bot is connected, the `bots` hook removes it in the connect transaction (AC-10, "connecting a different bot removes every link made with the old one").

   (goal 2): [ADR-0004](adr/0004-issue-connect-links-as-random-single-use-tokens-stored-as-hashes-and-redeemed-through-the-start-payload.md).
5. **Pings are decided by a sweep per workspace every 20 s, against a per-period ledger written before the send.**
   - **The jobs.** `notifications.send-pings` (policy `exclusive`, `singletonKey` = workspace id) re-enqueues itself 20 s later while the workspace has a live link. A cron `notifications.schedule-pings` runs every minute. It is a backstop that starts a chain for every workspace with a live link, and the singleton key drops duplicates.
   - **One run, step by step:**
     - reads the bot's readiness from `bots` and skips while the bot is not working, so nothing is queued (AC-10);
     - deletes the workspace's expired presence rows;
     - reads the live links, the away members and the open waiting conversations with their read state from `conversations` (choice 6);
     - computes each member's **due set** in `notifications/domain`: 5 min for the assignee or for everyone on an unassigned conversation, 30 min for the team, or 5 min for the team when the assignee is away, has not read the waiting message and cannot be pinged (no link, or a link that is "Not reachable"). An assignee who is present or has read the message can be reached, so the team waits for 30 min (AC-09). The assignee's presence and read state are therefore read whether or not they have a link; never a conversation already in the member's ledger for its current waiting period; never one the member has read, unless the period began with a reopen.
   - **The send, per member** whose last ping is at least 10 minutes old:
     - a transaction share-locks the membership and recomputes that member's due set from fresh reads: still open, still waiting, still unread, member still away, link still live;
     - it writes one `pings` row and one `ping_items` row per conversation (unique per member, conversation and waiting-period start), then commits;
     - only then does it call `bots`.

     The send-time re-check of the spec therefore runs at most milliseconds before the Telegram call, and the ledger makes "at most once per conversation per waiting period" hold across instances and restarts. Due conversations that wait for the member's next allowed moment are combined into that ping.
   - **The trigger is a sweep, not a timer per conversation.** Six events can make a conversation due: the 5- and 30-minute marks, a member becoming away, a reassignment or unassignment, a link becoming unreachable and a bot recovering. A sweep catches all of them without a hook in each module that causes them.
   - **Tenancy.** One new controlled exception: *workspaces with a live Telegram link*, read only by the cron backstop.

   (goals 1 and 2): [ADR-0005](adr/0005-decide-pings-in-a-per-workspace-sweep-every-20-s-with-a-per-period-ledger-written-before-the-send.md).

**Supporting choices:**

- **Pings stay below a share of the bot's Telegram budget and pause on any rate-limit answer, so replies always go first (AC-10, §6 reply delivery).** Pings and bot answers go out through a new `bots.sendMemberMessage`, never through `sendText`. A workspace's sends are serialised by its singleton job and paced at 10 per second at most, a third of Telegram's roughly 30 per second per bot. Any `429` on this bot, from a reply or from a ping, stores `send_paused_until` on the bot row. `sendMemberMessage` refuses while that time is in the future, and the reply path never consults it. A ping refused or answered with `429` is rolled out of the ledger, because Telegram did not accept it. Its conversations stay due and are combined into the next run after the pause. `bot_unavailable` (the bot stopped working, or its token is gone, between readiness and send) is rolled out the same way, so its conversations become due again once the bot works (AC-10). `403` (the member blocked the bot) maps to `blocked`: the attempt counts for its conversations (AC-10) and the link turns "Not reachable". `transient` (a timeout or network failure after the request may have reached Telegram) is recorded as `failed` and counts, which is the at-most-once rule (§11). Each outcome is written in a short transaction after the send. When it changes the link's reachability, in either direction, that transaction publishes `telegram_link.changed`. This is an ADR: [ADR-0006](adr/0006-pace-pings-below-a-per-bot-share-of-the-telegram-limit-and-pause-them-on-any-rate-limit-answer.md).
- **`conversations` records when the current waiting period began, in the transactions that start and end it (AC-07, AC-08).**
  - New columns on `conversations`: `waiting_since` and `waiting_started_by` (`message` / `reopen`).
  - Capture sets them when a customer message arrives in a conversation that is not waiting (`message`, at its arrival time).
  - A reply marked sent and a close clear them.
  - A reopen while the customer is still waiting sets them to the reopen time (`reopen`): a member reopen over an unanswered message, or a reply that ends not delivered or not confirmed.
  - A reassignment does not touch them, so the clock does not restart.
  - `notifications` reads them through `conversations.waitingForPings(workspaceId, …)`. That read returns, per open waiting conversation, the assignee, the period start, the start kind, the arrival of the message that began the wait, and whether each given member's watermark has passed it.

  This is an ADR: [ADR-0007](adr/0007-record-the-waiting-period-start-on-the-conversation-in-the-writing-transactions.md).
- **The attention count is computed by the server and refetched on frames (AC-01).** `conversations.attentionCount(workspaceId, accountId, activeSince)` counts open conversations that are assigned to the member or unassigned and have a customer arrival after the member's unread floor. It reuses the list's unread predicate and the lens indexes. `inbox` serves it under `GET …/inbox/attention`. The frame's attention store refetches it, debounced by 300 ms, on four triggers: every `conversation.changed` with a message, an activity or a `read` change of this account, `membership.deactivated`, and `resync`. A client-side count could not see conversations outside the loaded page. This is an ADR: [ADR-0008](adr/0008-serve-the-attention-count-from-a-conversations-query-refetched-on-change-signals.md).
- **Desktop notifications go through a service worker that is used only for notifications (AC-02, AC-03).**
  - **Registration.** The SPA registers `/notifications-sw.js` (scope `/`) only after the member turns desktop notifications on. Permission is asked only on that click.
  - **The tab's part.** On a `conversation.changed` frame with a created message, each tab of the workspace refetches the row, as it already does. If the conversation is the member's or unassigned and open, and the frame was not an edit, the tab posts `{ workspaceId, conversationId, messageId, contact name, url }` to the worker.
  - **The worker's part.** It calls `clients.matchAll({ type: 'window', includeUncontrolled: true })`. If any client of that workspace is `focused`, it shows nothing. Otherwise it shows the notification, with `tag` = workspace + conversation, so further messages replace it, and keeps a short dedupe of message ids, so several tabs produce one notification.
  - **The click.** The worker focuses the first matching client, which `matchAll` orders by most recent focus, and asks it to open the conversation. With no such client it opens the conversation's address.

  This is an ADR: [ADR-0009](adr/0009-show-desktop-notifications-through-a-notifications-only-service-worker-that-checks-focus-and-picks-the-tab.md).
- **Link state reaches the member's own tabs through a new account-scoped signal.** `telegram_link.changed { workspace_id, account_id }` is published in every transaction that creates, removes or changes the reachability of a link. The hub delivers it only to that account's sockets, as it already does for `read`. SCR-16 and SCR-17 refetch the link state, so "Connected" appears without a reload (AC-04). "Pings paused" comes from the existing `bot.changed`. This is an ADR: [ADR-0010](adr/0010-signal-telegram-link-changes-on-an-account-scoped-frame-delivered-only-to-that-members-sockets.md).
- **Bot answers in the member's chat are jobs, inline.** `notifications.send-bot-message` (payload: workspace id, Telegram user id, answer kind; text built at send time from the kind and the workspace name) is enqueued in the transaction that decides the answer. The kinds are: connected, link expired, cannot connect (two reasons), already connected, notifications off, "this chat only sends notifications". The webhook request therefore never waits on Telegram. The "only sends notifications" answer is limited to one per hour per link by a conditional update of `last_notice_at` (AC-11). These sends go through `sendMemberMessage` and its pause. Below the ADR gate: it is the reply-drain pattern inside one module.
- **Ping text, inline.** `notifications/domain/ping-text.ts` builds the text from the workspace name, the count split into the member's own, unassigned and a teammate's, the longest wait in whole minutes and the link: one conversation, the `mine` lens, the `unassigned` lens or the open lens (AC-07, AC-08, AC-09). Its input type has no field for message text, contact names or teammate names, so the NFR "0 pings containing customer message text or a contact name" holds by construction, and a unit test asserts it.
- **Persistence:** the single PostgreSQL 16 store. No cache, no Redis, no new datastore. Two new pg-boss queues plus the cron.

Each later tactical decision traces to one of these. Contradictions go to §11.

## 5. Building block view

The backend keeps the modular monolith (`domain → app → infra → http`) and adds one module, `notifications` ([ADR-0001](adr/0001-add-a-notifications-module-that-owns-telegram-links-presence-and-pings-and-is-reached-through-ports.md)). The pieces divide up as follows:
- **`notifications`** owns Telegram links, connect links, presence leases and the ping ledger. It holds the due rules and the ping text in its domain, the use cases (connect, redeem, disconnect, intercept, presence, sweep, send) in its app layer, the repositories and the two workers in infra, and the Settings — Notifications and Team routes in http.
- **`bots`** declares two ports: the inbound interceptor and the bot-connected hook. It gains `sendMemberMessage`, with the pause and a `blocked` outcome, and `pingReadiness`.
- **`conversations`** gains the waiting-period columns and the reads `waitingForPings` and `attentionCount`.
- **`inbox`** reads presence frames on the live socket and reports socket lifecycle to `notifications`. It also serves the attention route and delivers the account-scoped frame.
- **`workspaces`** is unchanged, apart from the composed deactivation port that `buildDeps()` builds.

Static graph after the change: `inbox → {conversations, contacts, bots, workspaces, notifications}`, `notifications → {conversations, workspaces, bots}`, `bots → conversations → contacts`, `bots → contacts`. It is acyclic. Runtime edges through ports: `bots ⇢ notifications` (interceptor, bot-connected hook) and `workspaces ⇢ {conversations, notifications}` (deactivation). Construction order in `buildDeps()`: contacts → conversations → bots core (gateway, repos, `sendMemberMessage`) → notifications → the ports that `bots` and `team` take → team. The precedent for a port filled after its target exists is assignment-statuses' `team` port.

**Table ownership** (names indicative, `data-model` fixes them):

| Module | Tables (new or changed) | Tenancy |
|---|---|---|
| `notifications` | **`telegram_links`**: id, workspace_id, account_id, telegram_user_id (bigint, cleared at removal), telegram_bot_id (bigint), display name (cleared at removal), linked_at, reachable (`ok` / `blocked`), last_notice_at, removed_at, removed_reason (`member` / `deactivated` / `bot_replaced`). Partial unique indexes on live rows: `(workspace_id, account_id)` and `(workspace_id, telegram_user_id)`. **`connect_links`**: id, workspace_id, account_id, token_hash (unique per workspace), created_at, expires_at, used_at, replaced_at. **`tab_presences`**: id (the socket's connection id), workspace_id, account_id, live_until, on_screen, last_on_screen_at, opened_at. **`pings`**: id, workspace_id, account_id, link id, created_at, outcome (`sending` / `accepted` / `blocked` / `failed`), opened_at (for the §7 KPI). **`ping_items`**: ping_id, workspace_id, account_id, conversation_id, waiting_since, unique `(workspace_id, account_id, conversation_id, waiting_since)` | Tenant-owned, non-null `workspace_id`, every repository method takes `workspaceId`. One controlled exception (§8) |
| `conversations` | `conversations` **+** `waiting_since` (nullable timestamptz), `waiting_started_by` (nullable, `message` / `reopen`), backfilled from the current waiting marker | unchanged |
| `bots` | `bots` **+** `send_paused_until` (nullable timestamptz) | unchanged |
| `inbox`, `workspaces`, `contacts` | none | — |

`telegram_links.account_id` references `memberships (workspace_id, account_id)` through a composite FK. Like the assignee FK of assignment-statuses, this is a cross-module constraint only. No module queries through it. There is no FK to `bots`, because a disconnected bot row with no conversations is deleted (bot-connection). The link is bound by the Telegram bot id instead.

**Cross-module app-layer calls (new or changed):**

- `notifications` → `conversations`:
  - `waitingForPings(workspaceId, { conversationIds?, accountIds })`, which returns the open waiting conversations with period start, start kind, assignee and per-member "read the waiting message". Ping links need no read of their own, because they land on the existing inbox reads.
- `notifications` → `workspaces`:
  - `lockActiveMembers(tx, workspaceId, [accountId])` (existing), at redeem and at send;
  - `activeMembers` / the guard (existing);
  - the workspace name, for ping and answer text.
- `notifications` → `bots`:
  - `pingReadiness(workspaceId)`, which returns state, Telegram bot id, username and `send_paused_until`;
  - `sendMemberMessage({ workspaceId, telegramUserId, text })`, which returns `accepted` | `blocked` | `rate_limited(retryAfter)` | `bot_unavailable` | `transient`.
- `inbox` (hub) → `notifications.presence`: `opened(workspaceId, accountId, connectionId, onScreen)`, `alive(workspaceId, connectionId)` on pong, `screen(workspaceId, connectionId, onScreen)` on a presence frame, `closed(workspaceId, connectionId)`. The hub already holds each socket's workspace id, so every presence write is scoped by it and no tenancy exception is needed. The member's latest ping within the last 15 min gets its `opened_at` set when a tab of that workspace opens **or comes back on screen** (`opened` with `onScreen`, or `screen` turning true). This covers a member who returns to a tab that was already open (§7 KPI).
- `inbox` → `conversations.attentionCount` (new route).
- `bots` ⇢ (port) `notifications.intercept(…)` in `accept-update`, and `notifications.onBotConnected(tx, { workspaceId, telegramBotId })` in the paste-token connect transaction.
- `workspaces` ⇢ (port) `notifications.removeLinkOnDeactivation(tx, { workspaceId, accountId, at })`, called after `conversations.unassignDeactivatedMember` in the same transaction. It also marks the member's unused connect links replaced.

**Internal decomposition:**

```
apps/api/src/
├── modules/notifications/                    (new)
│   ├── domain/       due rules (5 / 30 min, unpingable assignee, read-holds-back unless reopen,
│   │                   per-period once, 10-min spacing), ping text builder (no customer text by type),
│   │                   presence predicate (lease + on screen within 10 min), connect-link rules
│   │                   (single use, 10 min, 5 per 10 min, start payload format), answer kinds, constants
│   ├── app/          connect (issue / limit), redeem, disconnect, intercept (port impl), presence
│   │                   (opened / alive / screen / closed), sweep + send per member, bot-connected and
│   │                   deactivation handlers, my notification state, team on/off read;
│   │                   ports: conversations, workspaces, bots, signals, jobs, clock, random
│   ├── infra/        telegram-link, connect-link, presence, ping repositories; jobs.ts
│   │                   (notifications.schedule-pings cron, notifications.send-pings,
│   │                   notifications.send-bot-message); signals
│   └── http/         routes under /api/workspaces/:workspaceId/notifications/… (my state, create
│                       connect link, remove link, team on/off for owners)
├── modules/bots/
│   ├── app/          accept-update calls the inbound interceptor port; paste-token calls the
│   │                   bot-connected port inside its connect transaction; sendMemberMessage;
│   │                   pingReadiness; any 429 stores send_paused_until
│   └── infra/        telegram-gateway maps 403 "blocked by the user" to `blocked`
├── modules/conversations/
│   ├── domain/       waiting-period transitions (start by message / reopen, end by sent reply / close)
│   ├── app/          capture / reply-sent / close / reopen maintain the period; waitingForPings;
│   │                   attentionCount
│   └── infra/        queries for both reads (reuse the unread predicate and lens indexes)
├── modules/inbox/
│   ├── infra/hub.ts  reads presence frames, reports open / pong / close; account-scoped delivery
│   │                   of telegram_link.changed
│   └── http/         GET …/inbox/attention
├── platform/realtime.ts   + telegram_link.changed {workspace_id, account_id}
├── platform/config.ts     no new key
└── deps.ts               build order above; composed deactivation port; bots ports filled
apps/web/
├── public/notifications-sw.js      (new) focus check, tag replace, dedupe, click to the MRU tab
└── src/
    ├── shared/api/realtime.ts      + presence frame on open and on visibilitychange
    ├── app/ (workspace frame)      owns the live connection; title "(N) …"; Inbox badge
    ├── features/attention/         store: count, refetch on frames (debounced)
    ├── features/notifications/     store, Settings — Notifications page (SCR-16), connect dialog
    │                                 (SCR-17, link + client-drawn code + expiry), desktop opt-in and
    │                                 permission, notifier (posts to the service worker)
    ├── features/inbox/             subscribes to the frame's connection instead of opening one
    └── features/team (Settings — Team)  "Telegram pings on / off" mark per member
packages/shared/src/  notifications.ts — my state, connect link, team on/off; inbox.ts — attention;
                      LiveFrame + telegram_link.changed; client frame `presence`;
                      errors.ts — CONNECT_LINK_LIMIT_REACHED, TELEGRAM_ALREADY_LINKED,
                      PINGS_NEED_WORKING_BOT (names fixed by `api`)
```

**C4 Container (L2):**

```mermaid
C4Container
    title operator-notifications — Containers

    Person(member, "Operator or Business owner")
    Person(customer, "End customer")

    Container_Boundary(tginbox, "tg-inbox") {
        Container(spa, "Web panel", "React 19, Vite, Zustand, shadcn/ui", "Frame count, Settings - Notifications, connect dialog, Team mark, presence frames")
        Container(sw, "Notifications service worker", "Service Worker API", "Focus check, one notification per browser, click to the most recently focused tab")
        Container(http, "API server", "Node 26, Fastify 5, zod, websocket, pg-boss", "Routes, live socket, webhook ingress, job workers")
        Container(notif, "notifications module", "TypeScript", "Telegram links, connect links, presence leases, due rules, ping ledger, sweep and send jobs")
        Container(inbox, "inbox module", "TypeScript", "Live hub with presence frames, attention route")
        Container(conv, "conversations module", "TypeScript", "Waiting period, attention count, waiting-for-pings read, capture")
        Container(ws, "workspaces module", "TypeScript", "Guard, active-member locks, deactivation port")
        Container(bots, "bots module", "TypeScript, grammY", "Webhook with inbound interceptor, sendMemberMessage with pause, bot-connected hook")
        Container(rt, "realtime platform service", "TypeScript, pg", "Signals published in transactions, LISTEN per instance")
    }

    ContainerDb(db, "Database", "PostgreSQL 16", "Links, connect links, presence, pings, conversations, pg-boss jobs")
    System_Ext(telegram, "Telegram Bot API", "Webhook delivery, sendMessage")

    Rel(member, spa, "Reads the count, connects Telegram", "HTTPS")
    Rel(spa, sw, "Posts notification candidates", "postMessage")
    Rel(sw, spa, "Focuses the tab, opens the conversation", "Clients API")
    Rel(customer, telegram, "Writes to the business bot", "Telegram app")
    Rel(member, telegram, "Starts the connect link, reads pings", "Telegram app")
    Rel(spa, http, "Attention, notification settings, connect links", "JSON over HTTPS, same origin")
    Rel(spa, http, "Presence frames", "WebSocket")
    Rel(http, spa, "Change signals incl. telegram_link.changed", "WebSocket")
    Rel(telegram, http, "Pushes updates", "HTTPS webhook")
    Rel(http, inbox, "Socket lifecycle, attention reads")
    Rel(http, notif, "Settings routes, ping jobs")
    Rel(inbox, notif, "Reports presence")
    Rel(inbox, conv, "Attention count")
    Rel(notif, conv, "Reads waiting conversations and read state")
    Rel(notif, ws, "Locks active memberships, workspace name")
    Rel(notif, bots, "Readiness, sendMemberMessage")
    Rel(bots, notif, "Intercepts inbound, bot connected, through ports")
    Rel(ws, notif, "Removes the link on deactivation, through the port")
    Rel(bots, conv, "Captures what passes the interceptor")
    Rel(bots, telegram, "sendMessage", "HTTPS Bot API")
    Rel(notif, rt, "Publishes telegram_link.changed in transactions")
    Rel(rt, inbox, "Delivers signals to the hub")
    Rel(notif, db, "Reads and writes", "SQL via Kysely, pg-boss")
    Rel(conv, db, "Reads and writes", "SQL via Kysely")
    Rel(rt, db, "NOTIFY and LISTEN", "pg")
```

The module boxes are logical containers inside the one API process (shared-inbox §5 precedent). The service worker is drawn separately because its lifecycle differs from the page's: the browser starts and stops it, and it outlives any one tab. It is part of the `web-frontend` surface, not a new surface. The `bots → notif` and `ws → notif` relations are runtime calls through ports that those modules declare and the composition root fills. They are not imports.

## 6. Runtime view

These are the seeded critical flows. The `sequences` stage extends this section until every spec §5 AC maps to a flow or a branch. Participants are the §5 containers.

**Critical flow 1: A sweep sends one combined ping, re-checked at send time (US-04, US-05 — AC-07, AC-08, AC-09, AC-10)**

```mermaid
sequenceDiagram
    participant Job as notifications send-pings job
    participant Notif as notifications module
    participant Bots as bots module
    participant Conv as conversations module
    participant Ws as workspaces module
    participant Rt as realtime platform service
    participant Tg as Telegram Bot API
    actor Member as Away linked member
    Job->>Notif: run for workspace W
    Notif->>Bots: ping readiness of W
    alt bot not connected or not working
        Bots-->>Notif: not ready
        Notif-->>Job: nothing sent, nothing queued, next run in 20 s
    else paused after a rate-limit answer
        Bots-->>Notif: paused until T
        Notif-->>Job: next run after T
    else ready
        Notif->>Notif: drop expired presence leases, read live links and away members
        Notif->>Conv: open waiting conversations with period start, assignee, and read state for away members and assignees
        Notif->>Notif: due set per member from the rules and the ledger
        loop each member with a due set and no ping in the last 10 min
            Notif->>Notif: open one transaction
            Notif->>Ws: share-lock this membership
            Notif->>Conv: re-read the due conversations
            Notif->>Notif: recompute due set with fresh presence and link
            alt nothing left, or membership not active
                Notif->>Notif: commit nothing, no ping
            else still due
                Notif->>Notif: insert ping and one ledger item per conversation, commit
                Notif->>Bots: send member message with workspace, counts, longest wait, panel link
                Bots->>Tg: sendMessage to the member chat
                alt accepted
                    Tg-->>Bots: ok
                    Bots-->>Notif: accepted
                    Tg-->>Member: ping in the bot chat
                    Notif->>Notif: outcome transaction, mark accepted
                    opt link was Not reachable
                        Notif->>Rt: link reachable again, account-scoped signal in the outcome transaction
                    end
                else member blocked the bot
                    Tg-->>Bots: forbidden
                    Bots-->>Notif: blocked
                    Notif->>Notif: outcome transaction, mark blocked, the attempt counts
                    opt link was reachable
                        Notif->>Rt: link not reachable, account-scoped signal in the outcome transaction
                    end
                else rate limited, or the bot stopped working
                    Tg-->>Bots: too many requests with retry after, or unauthorized
                    Bots->>Bots: store send paused until, or mark the bot needs a token
                    Bots-->>Notif: rate limited or bot unavailable
                    Notif->>Notif: outcome transaction, delete this ping and its items, stop the loop
                else timeout or network failure
                    Bots-->>Notif: transient
                    Notif->>Notif: outcome transaction, mark failed, the attempt counts
                end
            end
        end
        Notif-->>Job: next run in 20 s
    end
```

**Critical flow 2: A connect-link start is redeemed and never captured (US-03, US-06 — AC-04, AC-05, AC-06, AC-11, AC-12)**

```mermaid
sequenceDiagram
    actor Member as Operator in Telegram
    participant Tg as Telegram Bot API
    participant Http as API server
    participant Bots as bots module
    participant Notif as notifications module
    participant Ws as workspaces module
    participant Conv as conversations module
    participant Rt as realtime platform service
    participant Web as Web panel
    Member->>Tg: presses Start on the connect link
    Tg->>Http: webhook update with the start payload
    Http->>Bots: authenticate the bot by its secret, accept the update
    Bots->>Notif: intercept private message from this Telegram user in workspace W
    alt start payload with our prefix
        Notif->>Notif: open one transaction, read the connect link by token hash in W
        alt missing
            Notif->>Notif: enqueue the answer link expired
        else found
            Notif->>Ws: share-lock the link's membership first
            Notif->>Notif: then lock the connect link row and re-check it
            alt expired, used or replaced
                Notif->>Notif: enqueue the answer link expired
            else membership not active
                Notif->>Notif: use the link up, enqueue the answer link expired
            else this Telegram user is linked to a teammate, or the member is linked from another account
                Notif->>Notif: use the link up, enqueue the answer cannot connect with the reason
            else the member is already linked from this account
                Notif->>Notif: use the link up, enqueue the answer already connected
            else free
                Notif->>Notif: insert the Telegram link bound to the bot id, use the link up
                Notif->>Rt: telegram link changed for this account, in the transaction
                Notif->>Notif: enqueue the answer connected and how to stop
            end
        end
        Notif-->>Bots: consumed, commit
    else sender has a live link in W with this bot
        Notif->>Notif: at most one notice per hour, enqueue the answer this chat only sends notifications
        Notif-->>Bots: consumed
    else anyone else
        Notif-->>Bots: pass
        Bots->>Conv: capture as a customer message, as before
    end
    Bots-->>Http: done
    Http-->>Tg: ok
    Rt-->>Web: telegram link changed to this member's tabs only
    Web->>Http: refetch my notification state
    Web-->>Member: Settings shows Connected without a reload
```

**Critical flow 3: Presence and a desktop notification for a new customer message (US-01, US-02 — AC-01, AC-02, and the presence rows of spec §6)**

```mermaid
sequenceDiagram
    actor Member as Operator at the computer
    participant Web as Web panel tab
    participant Sw as Notifications service worker
    participant Http as API server
    participant Inbox as inbox module
    participant Notif as notifications module
    participant Conv as conversations module
    Web->>Http: open the workspace live socket from the frame
    Http->>Inbox: guarded upgrade
    Inbox->>Notif: presence opened for this tab, on screen or not
    loop every 25 s
        Inbox->>Web: keep-alive ping
        Web-->>Inbox: pong
        Inbox->>Notif: alive, lease extended by 50 s
    end
    Member->>Web: switches to another tab or minimises
    Web->>Inbox: presence frame, not on screen
    Inbox->>Notif: screen left, stamp last on screen
    Note over Conv,Inbox: a customer message is captured and its signal reaches the hub
    Inbox->>Web: conversation changed, message created
    Web->>Http: refetch the row and the attention count
    Http->>Conv: row and attention count for this member
    Conv-->>Web: row assigned to me or unassigned, count N
    Web->>Web: title starts with N, Inbox shows N
    Web->>Sw: notification candidate with contact name and conversation
    Sw->>Sw: list window clients of the workspace
    alt a tab of this workspace is in focus
        Sw->>Sw: show nothing
    else none in focus
        Sw->>Sw: show or replace the notification tagged by conversation, once per message
        Member->>Sw: clicks the notification
        Sw->>Web: focus the most recently focused tab of the workspace, open the conversation
    end
    Note over Web,Notif: tab closed, computer asleep or connection lost - the lease expires within 50 s and the member counts away
```

## 7. Deployment view

Nothing changes in the topology. The feature runs in the one Node 26 process (Fastify API, the built web panel and its new static `notifications-sw.js`, webhook ingress, the live socket and the pg-boss workers) against one PostgreSQL 16 database. Added: the queues `notifications.schedule-pings` (cron every minute), `notifications.send-pings` (policy `exclusive`, `singletonKey` = workspace id, no retry: a failed run is replaced by the next chain link or by the cron) and `notifications.send-bot-message` (retry limit 2, expire 30 s). They are created and registered by `buildApp()` and added to the architecture map's queue table. A second replica needs no change. Presence, the ledger and the per-workspace singleton live in Postgres. Signals fan out through `LISTEN/NOTIFY`, and every instance's hub reports its own sockets.

**Configuration added:** none. The constants live in `notifications/domain`: 5 / 30 / 10 minutes, the 10-minute presence window, the 50 s lease, the 20 s sweep, 10 pings per second, 5 connect links per 10 minutes, the 10-minute link expiry and the one-hour notice spacing. The ping's panel links use `PUBLIC_WEB_URL`. The service worker must be served from the origin root with `Content-Type: text/javascript` and `Cache-Control: no-cache`, so that updates take effect.

**Monitoring:**
- Metrics (from structured logs):
  - ping timeliness: due moment (or the member's next allowed moment) to accepted, per ping, with the time spent paused logged separately so it can be excluded (spec §6);
  - sweep duration per workspace, members evaluated, pings sent, dropped at send time (with reason) and rolled back after `429`;
  - capture-to-push latency for message signals (existing), now also to the attention refetch;
  - presence: open leases, lease expiries without a clean close, presence frames per minute;
  - interceptions: connect-link starts by outcome, linked-member messages consumed, notices sent;
  - `sendMemberMessage` outcomes per bot, and `send_paused_until` events with their duration;
  - reply send p95 (existing), watched alongside ping volume.
- Alerts:
  - the existing `/health` uptime check;
  - ping timeliness p95 above 60 s over 15 minutes, excluding paused time;
  - any integrity query below returning a row;
  - the spec §7 fatigue signal: ping → panel within 15 min falling 3 weeks in a row.
- Integrity checks (run-book queries, also asserted in the integration suite):
  - pings whose recipient's membership was not active at `created_at`;
  - more than one ledger item per member, conversation and waiting period (the unique index makes this impossible; the query guards against a dropped index);
  - two pings to one member and workspace less than 10 minutes apart;
  - contacts whose Telegram id equals a live link's Telegram user id in the same workspace (spec §6 "Captured link messages"; an ops join across modules, not a repository read);
  - live links whose Telegram bot id differs from the workspace's current bot.
- KPIs (spec §7) are computed by run-book queries:
  - answered within 15 minutes: waiting periods ended by a sent reply within 15 min, which needs the period start that ADR-0007 now stores;
  - members with a live link;
  - pings with `opened_at` within 15 min;
  - links removed by the member, or turned `blocked`, within 30 days of `linked_at`.
- Tracing: the Fastify request id is in every request log line, and job logs carry the workspace id, the member's account id, the ping id and the outcome code. Nothing logs a token, a Telegram display name, ping text or message text. The Telegram user id is logged only as part of the redeem outcome, at debug level.

**Scaling thresholds:**
- Presence writes: one `UPDATE` per open tab per 25 s. At pilot scale (5–10 workspaces, tens of tabs) that is under 5 writes per second. Above about 2 000 concurrent tabs, batch the lease extension per instance into one statement per tick.
- The sweep reads one workspace's waiting conversations (indexed by `waiting_since`) and its live links every 20 s. That is comfortable up to thousands of waiting conversations per workspace. Beyond that, narrow the read to conversations whose period start crossed a threshold since the last run.
- `ping_items` grows by one row per pinged member per waiting period, comfortable in one table for years at pilot scale.

## 8. Crosscutting concepts

| Concept | Convention | Where defined |
|---|---|---|
| Logging | pino via `platform/logger.ts`. Logs carry ids, kinds and outcome codes. Never logged: tokens, the connect token or its hash, Telegram display names, ping text, message text. Telegram failures are logged by code only (`TelegramUnavailableError` precedent). | `CLAUDE.md` + here |
| Authentication | The session cookie is resolved by `auth` on every route and the socket, unchanged. Ping links carry no credential and go through sign-in (AC-12). | workspace-operators ADR-0002 |
| Authorization | Every notifications route sits under `/api/workspaces/:workspaceId/…` behind the `workspaces` guard, with both roles allowed: another workspace's account gets not found with no hint, a deactivated member gets `ACCESS_REMOVED`, and a signed-out visitor is sent to sign in. A member reads and removes **only their own** link; the routes take no account id. The Team on/off read is `ownerOnly` and returns account ids with a boolean, never a Telegram id or name. A connect link redeems only for the membership it was issued to, re-checked as active under a share lock. Every send share-locks the recipient's membership (0 pings to non-members). | workspace-operators ADR-0003, [ADR-0004](adr/0004-issue-connect-links-as-random-single-use-tokens-stored-as-hashes-and-redeemed-through-the-start-payload.md), [ADR-0005](adr/0005-decide-pings-in-a-per-workspace-sweep-every-20-s-with-a-per-period-ledger-written-before-the-send.md) |
| Tenancy | Every new table carries `workspace_id`, and every repository method takes it. The interceptor and the redeem look up by `(workspace_id, …)`, with the workspace id coming from the authenticated webhook's bot. **New controlled exception (the sixth):** *workspaces with a live Telegram link*, read only by the `notifications.schedule-pings` cron backstop, like *bots due for a health check*. It returns workspace ids only, and every later read in the job is scoped by that id. CLAUDE.md and the architecture map list it after this feature. | `CLAUDE.md`, [ADR-0005](adr/0005-decide-pings-in-a-per-workspace-sweep-every-20-s-with-a-per-period-ledger-written-before-the-send.md) |
| Secrets | Connect tokens: 32 bytes from `crypto.randomBytes`, base64url, shown once, only the SHA-256 hash stored and compared. Bot tokens never leave `bots`. `sendMemberMessage` takes a workspace id, a Telegram user id and text. | [ADR-0004](adr/0004-issue-connect-links-as-random-single-use-tokens-stored-as-hashes-and-redeemed-through-the-start-payload.md), bot-connection ADR-0006 |
| Concurrency | Lock order per path:<br>• **Redeem:** a plain read of the connect link by hash (to learn its membership) → the membership (`FOR SHARE`) → the connect-link row (`FOR UPDATE`, re-checked) → the link insert, with the partial unique indexes as backstop.<br>• **Send:** the membership (`FOR SHARE`) → the ledger inserts (unique) → commit → Telegram → a short outcome transaction (ping row, link reachability, signal).<br>• **Deactivation:** the workspace row `FOR NO KEY UPDATE` → the membership `UPDATE` → the conversations unassign → the link removal and the connect-link replacement. The link removal locks only notifications rows, so it adds no cycle.<br>• **Connect-link issue:** `connect-links:<ws>:<account>` advisory lock → count → mark previous replaced → insert.<br>• **Bot connected:** the bots row write → the link removal, in the paste-token transaction.<br>A send racing a deactivation serialises on the membership lock: either the send commits first and its Telegram call may still follow (accepted, at most milliseconds before the deactivation), or it sees the membership inactive. **Why this is deadlock-free:** every path that touches a membership locks it before any notifications row (redeem, send and deactivation alike), and no path locks a notifications row and then a membership or a conversation row. The outcome transaction locks only notifications rows. | here |
| Error handling | `AppError` subclasses with codes in `packages/shared/src/errors.ts`:<br>• connect-link limit: `TooManyRequestsError`, with the retry time (AC-13);<br>• no working bot: `ConflictError`, with the bot state and whether the caller is an owner (AC-13);<br>• already linked when asking for a link: `ConflictError` (AC-06).<br>Refusals in Telegram are bot answers, not HTTP errors. The webhook always answers 200 after an interception, so Telegram does not redeliver. | `CLAUDE.md` + here |
| ID strategy | UUIDv7 from `newId()` for links, connect links, pings and presence rows. The presence id is generated by the hub per socket. Telegram user and bot ids are `bigint`. | `CLAUDE.md` |
| Time | Server clock (UTC) for every threshold. Waiting is measured from arrival in tg-inbox (`waiting_since`), not from Telegram send time, so a recovering bot's backlog starts fresh clocks instead of instant pings (spec §1 "ping storms"). | [ADR-0007](adr/0007-record-the-waiting-period-start-on-the-conversation-in-the-writing-transactions.md) |
| Events | New `telegram_link.changed { workspace_id, account_id }`, account-scoped in the hub. New client-to-server frame `presence { onScreen }`, the only frame the server reads, parsed with zod and discarded if invalid. `conversation.changed`, `bot.changed` and `membership.deactivated` are unchanged and are now also consumed by the attention store and the desktop notifier. | [ADR-0002](adr/0002-track-presence-as-per-tab-leases-in-postgres-refreshed-by-the-workspace-live-socket.md), [ADR-0010](adr/0010-signal-telegram-link-changes-on-an-account-scoped-frame-delivered-only-to-that-members-sockets.md) |
| Jobs | `notifications.<job>`, zod payloads with ids and kinds only. Each is enqueued in the deciding transaction through `jobDb(tx)`. At-most-once sends: the ledger row is committed before the Telegram call, as with the reply drain's in-flight mark. | shared-inbox ADR-0004, here |
| Rate limiting | Connect links: 5 per 10 minutes per member. Pings: one per 10 minutes per member and workspace, one per conversation per period. Notices: one per hour per link. Sends: 10 per second per bot plus the `429` pause. | §4 |
| Untrusted content | Contact names and message text never reach a ping (by type). Contact names in desktop notifications are passed as the notification title string, which the operating system renders as plain text. Telegram display names are rendered as plain text in SCR-16. Presence frames are untrusted and affect only their own member. | spec §6.1 |
| Internationalisation | UI, pings and bot answers in English, as the rest of the product. Answers are composed from a kind at send time, so a later language choice is one place. | — |
| Observability | See §7. | §7 |

## 9. Architecture decisions

| # | Title | Status | Section |
|---|---|---|---|
| [0001](adr/0001-add-a-notifications-module-that-owns-telegram-links-presence-and-pings-and-is-reached-through-ports.md) | Add a notifications module that owns Telegram links, presence and pings and is reached through ports | Accepted | §4, §5 |
| [0002](adr/0002-track-presence-as-per-tab-leases-in-postgres-refreshed-by-the-workspace-live-socket.md) | Track presence as per-tab leases in Postgres refreshed by the workspace live socket | Accepted | §4, §8 |
| [0003](adr/0003-intercept-connect-link-starts-and-linked-members-messages-in-bots-before-capture-through-a-port.md) | Intercept connect-link starts and linked members' messages in bots before capture through a port | Accepted | §4, §5 |
| [0004](adr/0004-issue-connect-links-as-random-single-use-tokens-stored-as-hashes-and-redeemed-through-the-start-payload.md) | Issue connect links as random single-use tokens stored as hashes and redeemed through the start payload | Accepted | §4, §8 |
| [0005](adr/0005-decide-pings-in-a-per-workspace-sweep-every-20-s-with-a-per-period-ledger-written-before-the-send.md) | Decide pings in a per-workspace sweep every 20 s with a per-period ledger written before the send | Accepted | §4, §8 |
| [0006](adr/0006-pace-pings-below-a-per-bot-share-of-the-telegram-limit-and-pause-them-on-any-rate-limit-answer.md) | Pace pings below a per-bot share of the Telegram limit and pause them on any rate-limit answer | Accepted | §4 |
| [0007](adr/0007-record-the-waiting-period-start-on-the-conversation-in-the-writing-transactions.md) | Record the waiting period start on the conversation in the writing transactions | Accepted | §4, §5 |
| [0008](adr/0008-serve-the-attention-count-from-a-conversations-query-refetched-on-change-signals.md) | Serve the attention count from a conversations query refetched on change signals | Accepted | §4 |
| [0009](adr/0009-show-desktop-notifications-through-a-notifications-only-service-worker-that-checks-focus-and-picks-the-tab.md) | Show desktop notifications through a notifications-only service worker that checks focus and picks the tab | Accepted | §4 |
| [0010](adr/0010-signal-telegram-link-changes-on-an-account-scoped-frame-delivered-only-to-that-members-sockets.md) | Signal Telegram link changes on an account-scoped frame delivered only to that member's sockets | Accepted | §4, §8 |

ADR files live under `docs/features/operator-notifications/adr/NNNN-<title>.md`. Decisions this design builds on:
- repo [`docs/adr/`](../../adr/) 0001, 0002, 0004;
- workspace-operators ADR-0002, 0003;
- bot-connection ADR-0003, 0005, 0006, 0007, 0008;
- shared-inbox ADR-0002, 0003, 0004, 0005, 0007;
- assignment-statuses ADR-0004, 0005.

## 10. Quality requirements

Each top-3 goal from §1 is expanded into a scenario below. Every number is quoted from spec §6.

**QG-1. Timely, never flooding**
- **When:**
  - a customer of a linked, away member's own conversation waits 5 minutes;
  - several conversations become due for one member within 10 minutes;
  - the member becomes away later, or becomes the assignee later;
  - the bot stops working and recovers;
  - two API instances run the jobs.
- **Then:**
  - ping timeliness, due moment (or the member's next allowed moment) to accepted, p95, excluding time at the sending limit: "≤ 60 s";
  - ping volume: "≤ 1 ping per 10 min per member per workspace; ≤ 1 per conversation per waiting period";
  - reply delivery under ping load: "reply send p95 ≤ 2 s, the shared-inbox target, with 50 pings due at once on one bot".
- **How verify:**
  - integration tests against a real Postgres and the fake Bot API, with a controllable clock:
    - (a) due at 5 min: accepted within one sweep;
    - (b) three conversations due within 10 min: one ping, then one combined ping at the next allowed moment, with the counts and the lens link;
    - (c) a member becomes away at 12 min: pinged at the next sweep;
    - (d) reassign at 7 min to an away linked member: due at once; unassign: due for the away members;
    - (e) bot `needs_token` for 20 min, then `connected`: nothing sent while broken, then one combined ping;
    - (f) two workers running `send-pings` for the same workspace concurrently: the ledger holds one item per period;
  - the job timing log feeds the §7 timeliness metric;
  - a load test against the fake Bot API: 50 pings due on one bot while replies are drained, with reply send p95 measured. The fake answers `429` once, and the test asserts that pings pause and replies are not delayed;
  - the daily reconciliation queries from §7 in the run book.

**QG-2. No leak, no capture**
- **When:**
  - a member is deactivated while a ping to them is due;
  - a connect link is replayed, expired, replaced, used by a teammate's Telegram account, or issued to a since-deactivated member;
  - a linked member writes "ok", sends media, edits, or starts the bot through a campaign link;
  - an account of another workspace probes the notifications routes.
- **Then:**
  - pings to non-members: "0 pings reach a Telegram account whose membership is not active at send time";
  - ping content: "0 pings containing customer message text or a contact name";
  - captured link messages: "0 contacts or conversations created from connect-link starts or linked members' messages";
  - connect link: "single use, expires in 10 min, ≤ 5 requests per 10 min per member".
- **How verify:**
  - integration test "deactivate during a due ping → no send", in both lock orders;
  - unit tests on the ping text builder over every set shape (mine, unassigned, mixed, one conversation). The builder's input type has no text or name field, and a review of the template;
  - webhook integration tests that POST recorded update bodies (the fake has no injection helper, so the tests build them), covering every interception case and the redeem outcomes of AC-05 / AC-06, then assert that `contacts` and `conversations` are unchanged;
  - integration tests for link expiry, single use, replacement and the 6th request in 10 minutes (AC-05, AC-13);
  - a cross-workspace isolation test for every new repository method, and route tests with another workspace's account (not found, no hint);
  - the run-book query for contacts that equal a linked member.

**QG-3. Truthful presence and a live panel**
- **When:** a member's last eligible tab closes, its computer sleeps, it loses its connection or it leaves the screen; a customer message is captured while the member has a tab open; the API process restarts.
- **Then:**
  - presence freshness, last eligible tab closes, sleeps or loses its connection → counted away: "≤ 60 s";
  - presence freshness, last eligible tab stays connected but leaves the screen → counted away: "≤ 10 min + 60 s after it left the screen";
  - in-web latency, customer message captured → attention count / desktop notification updated in an open tab, p95: "≤ 3 s (shared-inbox live-update target)";
  - availability: "99.5 % monthly (as shared-inbox §6)".
- **How verify:**
  - integration test with a test socket that stops answering keep-alive pings (simulated dead connection): away within 60 s on the presence predicate. A closed socket: away at once;
  - integration test with a presence frame `onScreen: false`: present at 10 min, away at 10 min + one sweep;
  - server-side timing from capture to push, logged per event, and a CI integration test that asserts the message frame reaches a connected socket and that the attention route returns the new count;
  - web tests (Testing Library): the title and badge update on a frame. The notifier posts a candidate only for mine or unassigned new messages. Service-worker unit tests with mocked `clients` check the focus skip, the tag replacement, the dedupe across two tabs and the click to the first client;
  - the uptime check on the health endpoint.

## 11. Risks and technical debt

| Risk / debt | Severity | Mitigation | Owner |
|---|---|---|---|
| Members keep pings on only if they help. Too many pings, or pings for customers someone else is already handling, lead to unlinks and blocks (spec §7 fatigue KPI). This is a product risk. | Medium | Combining, the per-period ledger and "read holds back" are by design. The §7 KPIs and the fatigue alert. Spec §8 revisits thresholds and quiet hours after 30 days. | Dmytro Hopko |
| A tab that reports itself on screen while nobody looks at it (a covered window, or a modified client) keeps its member "present", so they miss pings. | Low | This is the spec's accepted safe direction. It affects only the member's own pings, and they still get the count and desktop notifications. | Dmytro Hopko |
| Browsers can freeze or discard hidden tabs. A frozen tab's socket may stay up without visibility frames. | Low | A hidden tab counts away 10 minutes after it left the screen regardless of the socket. A discarded tab closes its socket, and the lease expires. | Tech Lead |
| A Telegram call that times out after the ledger committed counts as sent (`failed`), so the member may miss that ping (at-most-once). | Low | Same trade-off as the reply drain's "not confirmed". Logged and counted in the §7 metrics. The 30-minute team reach still applies to the conversation. | Tech Lead |
| A business's own campaign start payload that happens to begin with `tgi_` would be treated as a connect-link start and not captured. | Low | The prefix is distinctive. Document it in the bot settings help. A redeem with an unknown token answers "link expired", so the sender sees why. | Tech Lead |
| The live socket moves from the inbox store to the workspace frame, so every workspace page now holds a socket, and the inbox's live behaviour must not regress. | Medium | One shared connection with subscribers. The inbox store's existing live tests run against the frame-owned connection. Covered in `tasks`. | Tech Lead |
| The socket starts reading client frames for the first time. A malformed or flooding client could load the hub. | Low | Only `presence` is accepted. It is zod-parsed and limited by the existing 1024-byte cap, and at most one write per frame is coalesced per 1 s per socket. Anything else is ignored. | Tech Lead |
| A service worker is new to the repo. A broken worker could keep showing stale notifications, or block a future caching worker on the same scope. | Low | Notifications only, no `fetch` handler, served with `no-cache`, versioned file name in the registration. A kill switch: unregister when the opt-in is off. | Tech Lead |
| `bots/app/accept-update.ts` captures `/start <payload>` as a customer message today. Until this feature ships, connect links must not be issued. | Low | The interceptor and connect routes ship together in one release (task ordering). | Tech Lead |
| `telegram-gateway` does not yet map `403` "blocked by the user" or store a `429` pause. | Low | New mappings in `bots/infra`, with fake Bot API scripts for both. | Tech Lead |
| `onMembershipDeactivated` is a single function today, filled with the unassign. It becomes a composition built in `buildDeps()`. | Low | Composition in `deps.ts`, ordered unassign then link removal. Covered by the deactivation integration test. | Tech Lead |
| The sixth controlled tenancy exception (workspaces with a live link) must be listed in CLAUDE.md and the architecture map. The map's `reflects_commit` and its "greenfield-bootstrap" mode are stale. | Low | Update both in this feature's tasks, including the new queues. | Tech Lead |
| Ping records, removed-link rows (without Telegram id or name) and presence rows are personal data kept by default. | Low | Presence rows are deleted with the connection. Pings are kept like messages. Removal is by hand. Belongs to a later privacy and retention step (shared-inbox §11). | Dmytro Hopko |
| Spec §8: opt-in to the message preview or the contact name in pings? Default now: neither. | Open question | Resolve after 30 days of pilot use (ping → panel KPI). It would be a new input to the text builder, which is typed to exclude them today. | Dmytro Hopko |
| Spec §8: quiet hours or a per-workspace schedule? Default now: none, unlinking is the off switch. | Open question | Resolve after 30 days of pilot use (unlink / block KPI, pings 22:00–08:00). It would be one more condition in the due rules. | Dmytro Hopko |
| Spec §8: are 5 and 30 minutes right, and should owners change them? Default now: fixed. | Open question | Resolve after 30 days of pilot use. The constants are in `notifications/domain`, and a per-workspace setting would replace them. | Dmytro Hopko |

**Accepted debt (acceptable in v1, plan to fix later):**
- At-most-once ping sends: a timeout after commit loses that ping.
- Presence trusts the browser's Page Visibility state, with no activity heartbeat (mouse or keyboard).
- KPIs and integrity checks are run-book queries, not scheduled jobs.
- Desktop notifications need a tab of the workspace open in that browser (spec §3). There is no Web Push.

## 12. Glossary

Terms marked † are not yet in [CONTEXT.md](../../../CONTEXT.md) and are candidates for `/sdd:glossary`.

| Term | Meaning |
|---|---|
| Attention count | Open conversations of a workspace assigned to the member or unassigned, with customer messages unread by that member. Shown in the tab title and next to Inbox. Computed by the server. |
| Away from the web | No tab of the member, on any device, has the workspace open with a live lease and on screen within the last 10 minutes. Only an away member can be pinged. |
| On screen / In focus | On screen: the selected tab of a window that is not minimised (presence). In focus: the selected tab of the window the member works in (desktop notifications only). |
| Telegram link | One membership's opt-in connection to the member's personal Telegram account through the workspace's bot, bound to that bot's Telegram id. Nothing a linked account sends to that bot is captured. |
| Connect link | Single-use, 10-minute link bound to one membership, opened in Telegram as `/start tgi_<token>`. Only its hash is stored. |
| Ping | A short bot message to an away member's Telegram link about waiting customers, combined, capped, with no customer text or contact name. |
| Waiting period | From the message that makes a conversation waiting (or a reopen while waiting) until a reply is marked sent or the conversation is closed. Now stored as `waiting_since` + start kind. |
| Desktop notification | A system notification shown through the panel's service worker, once per browser, for a new customer message in a conversation that is the member's or unassigned, while no tab of the workspace in that browser is in focus. |
| Change signal | A small live notice with ids only. Here also `telegram_link.changed`, delivered only to the member's own sockets. |
| Presence lease † | A per-tab row whose `live_until` the live socket's keep-alive extends by 50 s, with the tab's on-screen state. A member is present while any of their leases counts. |
| Due set † | The conversations a member should be pinged about right now: past their 5- or 30-minute mark for that member, unread unless the period began with a reopen, and not yet in the member's ledger for the current period. |
| Ping ledger † | The `pings` and `ping_items` rows that record which member was pinged about which conversation in which waiting period. Written before the send, and the source of "at most once". |
| Inbound interceptor † | The port `bots` calls for every private update before capture. `notifications` answers `consumed` for connect-link starts and linked members, and `pass` otherwise. |
| Send pause † | `send_paused_until` on the bot row, set by any Telegram rate-limit answer. Pings and bot answers wait for it, and replies never do. |
| Operator / Business owner | Identical rights for notifications. Only business owners see the Team on/off mark and deactivate members. |
| End customer | Writes to the business bot and is captured as before, unless they hold a live Telegram link to that workspace's bot. |
