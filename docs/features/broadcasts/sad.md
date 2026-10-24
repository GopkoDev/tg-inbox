---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-23"
feature_size: "L"
target_surfaces: [backend-service, web-frontend]
---

# Software Architecture Document — broadcasts

## 1. Introduction and goals

**Intent.** broadcasts lets a workspace send one plain-text message from its own business bot to a chosen part of its contact base, from the panel. Any member drafts a **broadcast**: an internal name, the text, and one **audience**. The audience is either a **tag audience** (the Contacts tag filter's rules plus tags to leave out) or a **broadcast group** of hand-picked contacts. A draft always shows its breakdown: the audience size, the **unreachable contacts** (blocked the bot, or never wrote to the **current bot**) and how many it would reach. Only a **business owner launches**, from a confirmation that shows the exact text and number. The **launch** freezes the **recipient list** to exactly the contacts the confirmation counted. Sending then runs in the background, below the bot's Telegram limit, giving way to replies and waiting for the bot's **send pause**. Each recipient is sent the broadcast at most once and gets an outcome in the **delivery report**, which updates live. A business owner can **stop** a sending broadcast. Every delivered (or not confirmed) broadcast shows as a **broadcast item** in the recipient's conversation thread and changes nothing else there. Underneath, tg-inbox learns from Telegram which contacts **blocked the bot**, per Telegram bot, and shows it on Contacts. The design is built around the spec's sharpest failure. Broadcasts and support share **one bot**, so a broadcast must never take replies down with it, never send twice and never send what the owner did not confirm.

**Top-3 quality goals (1-liners; full scenarios in §10):**

1. **Support first.** Replies keep their latency while a 10 000-recipient broadcast sends. A bot's broadcasts stay at or below 25 messages per second together, pause on any rate-limit answer, and never slow another workspace.
2. **Exactly what was confirmed, at most once.** A launch freezes exactly the confirmed set, at most once per broadcast. Each recipient is sent at most once, including across restarts, double launches and unanswered sends. A launched broadcast's text and recipient list never change, and a stop takes effect within 2 s.
3. **An honest, live report inside a tenant boundary.** Every recipient ends with a truthful outcome (delivered, blocked the bot, failed with a reason, not confirmed, or not sent because stopped), shown live within 3 s. Blocked marks follow Telegram within 5 s. Nothing crosses a workspace: no contact of another workspace in a group or recipient list, and no send through another workspace's bot.

**Stakeholders.**

| Role | Interest | Sign-off owner? |
|---|---|---|
| Operator | Drafts, edits, duplicates and deletes own drafts. Builds tag audiences and broadcast groups. Sees every broadcast and report. Keeps answering customers while broadcasts send. Sees "blocked the bot" on contacts | No |
| Business owner | Everything an operator does. Also launches and stops broadcasts, deletes any draft, and carries the risk of the shared bot being restricted | No |
| End customer | Receives one broadcast once, as plain text, in their private chat with the business bot. Can answer it into the inbox, or block the bot | No |
| Tech Lead | SAD approval | Yes |
| Security Lead | Security review: a new owner-only capability that messages customers in bulk, new personal data (blocked state, recipient outcomes), a new cross-entity link (groups of contacts) that must stay inside one workspace (spec §6.1: review required) | Yes |

**Assumptions (autonomous run 2026-10-23)**, each can be vetoed at review:

- Depth = medium (from `.claude/sdd.local.md`), size L and route `full` (from `.size` / `.route`). The pipeline made every per-section decision itself, choosing the option most consistent with the existing architecture (modular monolith, pg-boss queues, realtime change signals, no new tenancy exception). Each decision is recorded in the section it belongs to. Blast-radius decisions are ADRs.
- `docs/architecture-map.md` reflects `0c2d56f` (contacts shipped). Only documentation commits came after it, so the map is fresh. Targeted reads of the code at HEAD `1125d9e` confirmed the facts used here (§3 brownfield note).
- Wire shapes in this SAD (routes, frame fields, error codes) show intent only, and `api` fixes the names. Table and column names are indicative, and `data-model` fixes them.
- "A working bot" for a **launch** means the bot row's state is `connected`. `needs_token` (not working), `disconnected` / no row (no bot) and `taken_over` (the webhook points elsewhere, so answers and block notices would not reach tg-inbox) refuse a launch with the way to the bot settings. **While sending**, the broadcast keeps the reply rule: it sends while the bot is `connected` or `taken_over` and ends at once on `needs_token`, a disconnect or a different Telegram bot (AC-12).
- Existing contacts are treated as having written to the workspace's current Telegram bot when this feature is migrated. Messages store no bot id today, and pilots have not changed bots, so the backfill is exact for them. A contact who in fact never wrote to that bot fails with "chat not found" (§11).
- A failure "chat not found" (Telegram does not know a private chat between the bot and that user) is a recipient-level failure that a new attempt cannot fix. It is not copied by "only recipients it did not reach" (AC-13 lists the fixable reasons, and this is not one).
- The launched broadcast keeps its audience **as it was defined**: the match mode and the tags with their names at launch. The report shows those names even after a later rename.
- Design constants that are not spec numbers live in `broadcasts/domain` and are chosen so that the spec §6 targets hold (§10): a sending link of at most 20 s, at most 8 sends in flight per workspace, report signals coalesced to at most one per broadcast per second, and a report page of 50 recipients (ux-flows).

**Decision overrides:** none.

**Critic pass (autonomous run 2026-10-23):** seven findings, all resolved as amendments (Accept amendment):
- one failure-reason vocabulary: a lost bot (`bot_unavailable` / `bot_changed`) fails waiting recipients with reason `bot_stopped`, which duplicates copy (§6 flow 2, ADR-0009);
- the report is not pushed as totals: an id-only signal makes the page refetch (§4);
- flow 3 no longer refetches draft counts live (§6, ux-flows);
- the broadcast row lock is `FOR NO KEY UPDATE` everywhere (ADR-0005, ADR-0006, ADR-0009 aligned with §8);
- the sender runs 16 links per instance and §11 names the bound past which one workspace's broadcast could wait for another's (AC-15);
- a recipient left in flight by a dead link gets its "not confirmed" broadcast item at the claim time, with an integrity query (AC-11, AC-16);
- strawman options replaced in ADR-0005 and ADR-0006 and dropped from ADR-0012.

## 2. Constraints

**Technical.**
- TypeScript ~6.0 (strict) on Node.js 26 in a pnpm workspaces monorepo: repo [ADR-0001](../../adr/0001-use-a-typescript-pnpm-monorepo-on-node-26.md).
- Backend: Fastify 5 with `fastify-type-provider-zod` and zod 4, `@fastify/websocket` for the live socket `GET /api/workspaces/:workspaceId/inbox/live`, opened by the workspace frame (operator-notifications ADR-0002). grammY's `Api` through `telegramApi()` and the `bots` gateway is the only Telegram client. pg-boss 12 runs on the main database (policies `exclusive` / `stately`, `singletonKey`, `startAfter`, retries with a dead-letter queue, cron by the minute, `jobDb(tx)` to enqueue inside a Kysely transaction).
- Datastore: PostgreSQL 16 via Kysely 0.29, reversible migrations through kysely-ctl, types generated into `db.types.gen.ts`: repo [ADR-0004](../../adr/0004-use-postgres-with-kysely-reversible-migrations-and-workspace-scoped-tenancy.md). READ COMMITTED throughout. Row locks and transaction-level advisory locks (`hashtextextended('<key>', 0)`) are the serialisation tools. Composite foreign keys `(workspace_id, id)` keep links inside one workspace (the contacts precedent).
- Architecture: a modular monolith with layers `domain → app → infra → http`, in one process: repo [ADR-0002](../../adr/0002-organize-the-backend-as-a-modular-monolith-with-layered-modules.md). Module dependencies are one-way: `inbox → {conversations, contacts, bots, workspaces, notifications}`, `notifications → {conversations, workspaces, bots}`, `bots → conversations → contacts`, `bots → contacts`, `contacts → workspaces`. A module reaches a module that depends on it only through a port that it declares and `buildDeps()` fills.
- Live updates: `platform/realtime` `publish(trx, signal)` sends `pg_notify` inside the writing transaction (ids only, at most 1000 bytes, zod-validated). Every API instance LISTENs on one dedicated connection, and the `inbox` hub dispatches to the sockets of the workspace. Clients refetch through the read routes.
- Telegram: a bot sends to a private chat whose id is the user's Telegram id. Telegram allows roughly 30 messages per second per bot and answers `429` with `retry_after` above that. A user who blocked the bot gets `403` ("bot was blocked by the user"); a deleted account gets `403` ("user is deactivated"). Telegram tells a bot that a private user blocked or unblocked it through a `my_chat_member` update (new status `kicked` / `member`), delivered only when the webhook's `allowed_updates` names it. Today `bots` registers `message` and `edited_message` only. A text message is at most 4096 characters, which Telegram counts in UTF-16 code units. Paid broadcasts above 30 per second are out of scope (spec §3).
- Frontend: React 19 + Vite SPA with Tailwind + shadcn/ui, Zustand stores per feature and React Router (`/w/:workspaceId/…`). The workspace frame (SCR-15) owns the one live socket per tab and hands frames to feature stores. The Contacts list, its search and tag filter and the contact profile exist (`features/contacts`, `features/tags`).

**Organisational.**
- Effort budget: size L, a new capability area (`.size`), route `full`.
- Deadline: none in the spec. The platform MCP server (roadmap step 11) waits for broadcasts.
- Team composition: not stated. The pipeline assumes one backend + frontend implementer working through `tasks.json`.

**Conventions.**
- [`CLAUDE.md`](../../../CLAUDE.md) and [`docs/architecture-map.md`](../../architecture-map.md) §Conventions are binding. Each module exposes `register<Module>(app, deps)`. Only `buildDeps()` constructs dependencies, and only `buildApp()` registers modules and workers. Imports flow inward. Other modules are reached only through their app layer, never through their tables.
- IDs are UUIDv7 from `newId()`. Telegram ids (user id, bot id, message id) are `bigint` columns, never primary keys.
- Errors are `AppError` subclasses, with codes declared in `packages/shared/src/errors.ts` and returned in the single envelope.
- Every tenant-owned table has a non-null `workspace_id`, and every repository method takes `workspaceId`. Each repository gets a cross-workspace isolation test. **This design adds no tenancy exception** (§8, [ADR-0007](adr/0007-send-through-a-per-workspace-pg-boss-chain-that-claims-each-recipient-before-its-send.md)).
- Async work goes through pg-boss queues named `<module>.<job>`, with workers in `modules/<m>/infra/jobs.ts`, registered by `buildApp()`. A job that follows a write is enqueued in the writing transaction.
- Bot tokens stay inside `bots`. Broadcasts go out only through a `bots` app-layer call.
- No triggers or stored procedures. Migrations are reversible: expand, then migrate, then contract.
- UI composes shadcn/ui primitives from `apps/web/src/shared/ui`, Tailwind only, per `docs/design-system.md` (desktop-first, usable at ≥ 360 px).

**Regulatory / external.**
- Data classification is confidential (spec §6.1).
- New personal data: per contact and Telegram bot, whether the contact wrote through it and whether (and since when) they blocked it. Per broadcast: its recipients, each one's outcome, reason and time, and which member created, last changed, launched and stopped it. The broadcast text is business-written. No new data is collected from end customers.
- Retention: broadcasts, recipients and broadcast items are kept like messages. Removal is by hand on request (spec OQ-4, §11).
- No compliance regime is named. A security review is required before release (spec §6.1). Telegram's own rules on unsolicited messages are the external constraint behind the launch cap, the owner-only launch and OQ-1.

## 3. Context and scope

tg-inbox is a shared Telegram inbox for small businesses. Each workspace has its own business bot, its team answers customers in a shared web inbox, and its contacts carry tags (roadmap step 7). broadcasts turns the tagged base into an audience. It adds one new outbound path: bulk `sendMessage` from the workspace's own bot to many private chats. It also adds one new inbound path: Telegram's `my_chat_member` notices that a customer blocked or unblocked the bot. Both share the bot with the existing paths: customer messages in, replies out, member pings and bot answers out.

The trust boundary moves in two places. **First, one member's decision now reaches thousands of customers.** That is why the launch is owner-only and re-checked at the moment of the action, why it confirms against the exact set it showed, and why it is capped per workspace per day. Everything a launch freezes is a copy inside the broadcast and is never re-derived. **Second, a contact's reachability is now learned from Telegram.** A `my_chat_member` update is trusted the way a message is: it comes through the bot's authenticated webhook (the per-bot secret checked before the body is parsed), and it is scoped by the bot that received it. It creates no message, conversation, unread or ping.

<!-- brownfield: map fresh (reflects 0c2d56f; only doc commits to HEAD 1125d9e). Code facts read at HEAD: bots — gateway ALLOWED_UPDATES = message, edited_message (telegram-gateway.ts:69), setWebhook at connect/rotate/reconnect only, the health check (every 3 min per bot) reads getWebhookInfo and never re-registers; classifyUpdate handles message / edited_message and ignores everything else as unsupported_update; sendText (replies) does not wait for the send pause but stores it on 429; sendMemberMessage refuses while paused and paces 10/s per bot through an in-process keyed pacer (pacer.ts); SendOutcome refused reasons blocked / account_gone (403 by description) / chat_not_found (any 400); BotRecord carries telegramBotId; a different Telegram bot can be connected only after the old row is deleted; the bot-connected hook runs inside the connect transaction. conversations — thread positions are message / reply / activity (domain/thread.ts) in one keyset-paged query; capture calls contacts.upsertFromProfile inside its transaction with no bot id; conversation.changed item types message / reply / activity. contacts — the list filter (q, tag mode any/all/none, matching count) is ContactListQuery in infra/contact-list-query.ts; contact_tags uses composite FKs (workspace_id, contact_id) / (workspace_id, tag_id); contact.changed change = tags only. web — the inbox store refetches only the open thread for a created reply item, but the attention store refetches the count on every conversation.changed that is not an edit (features/attention/store.ts:32-36). -->

**External systems (in / out):**

| Actor or system | Type | Interaction |
|---|---|---|
| Operator | Person | Opens Broadcasts. Drafts, edits, duplicates and deletes own drafts. Builds audiences. Follows reports. Answers customers as before |
| Business owner | Person | Everything an operator does. Launches from the confirmation, stops a sending broadcast, deletes any draft |
| End customer | Person | Receives the broadcast in their private chat with the business bot. May answer it (captured as a customer message) or block the bot |
| Telegram Bot API | System (external) | In: webhook updates, now also `my_chat_member` for private chats (blocked / unblocked). Out: `sendMessage` of broadcast texts, sharing the bot's ~30 per second with replies, pings and bot answers. Answers `429` with `retry_after`, `403` for blocked or deleted users, `400` for an unknown chat or a refused text |
| tg-inbox team monitoring | System (internal ops) | Receives the blocked-share alert (spec §7) from structured logs. No panel surface |

**C4 Context (L1):**

```mermaid
C4Context
    title broadcasts - System Context

    Person(operator, "Operator", "Drafts broadcasts, builds audiences, follows reports")
    Person(owner, "Business owner", "Launches and stops broadcasts")
    Person(customer, "End customer", "Receives a broadcast, may answer or block the bot")

    System(tginbox, "tg-inbox", "Shared inbox with broadcasts sent through the workspace's own bot")

    System_Ext(telegram, "Telegram Bot API", "Webhook updates incl. my_chat_member, sendMessage")
    System_Ext(monitoring, "tg-inbox team monitoring", "Blocked-share alert from logs")

    Rel(operator, tginbox, "Drafts, edits, duplicates, follows reports", "HTTPS, WebSocket")
    Rel(owner, tginbox, "Launches and stops", "HTTPS, WebSocket")
    Rel(customer, telegram, "Reads the broadcast, answers or blocks the bot", "Telegram app")
    Rel(telegram, tginbox, "Pushes customer messages and block or unblock notices", "HTTPS webhook")
    Rel(tginbox, telegram, "Sends broadcast messages, replies, pings", "HTTPS Bot API")
    Rel(tginbox, monitoring, "Emits blocked-share metrics", "structured logs")
```

The context: operators and business owners work in the panel over HTTPS and the workspace live socket. The business owner alone launches and stops. End customers never touch tg-inbox: they receive the broadcast in Telegram and answer or block the bot there. Telegram pushes their answers and their block or unblock notices back through the bot's webhook. tg-inbox sends broadcast messages through the same Bot API as replies and pings. The blocked-share alert leaves only as structured logs for the team's monitoring.

## 4. Solution strategy

**Target surfaces:** `backend-service` and `web-frontend`. The backend gets a new `broadcasts` module with its own tables, routes and sending job. It also gets per-bot reachability in `contacts`, a new inbound update and a broadcast send call in `bots`, and a new thread entry kind in `conversations`. The frontend gets a new Broadcasts area (SCR-24…SCR-32) and small changes to the inbox thread (SCR-02), the Contacts list (SCR-18) and the profile (SCR-19). The sender is a pg-boss job inside the same API process, like the reply drain and the ping sweep, so no separate `worker` surface is declared (the shared-inbox and operator-notifications precedent). The end customer's Telegram chat is the bot's output, not a surface tg-inbox draws (ux-flows, US-08). The surface split is recorded with the module decision in [ADR-0001](adr/0001-add-a-broadcasts-module-that-owns-drafts-groups-and-recipients-and-reaches-other-modules-through-their-app-layers.md).

**UI architecture (web-frontend):** client-side SPA, already fixed by repo ADR-0001. No new UI ADR is needed for the delivery model. The structure follows the existing features:
- **Routes:** `/w/:workspaceId/broadcasts` (SCR-24), `/w/:workspaceId/broadcasts/:broadcastId` (one address, two views: SCR-25 while the broadcast is a draft, SCR-28 once it is launched, chosen from the status the read returns), and `/w/:workspaceId/broadcasts/:broadcastId/launch` (SCR-27 opened over SCR-25 for a business owner; an operator is redirected to the draft with the owners-only note). The Broadcasts item joins the workspace frame's navigation (SCR-15) for every member.
- **Stores:** `features/broadcasts/` with a list store (SCR-24), a draft store (SCR-25/26/27/31/32: fields saved as they change against the shown version, the member's own unsaved edit kept beside a teammate's version on a stale answer, group adds and removes sent one by one) and a report store (SCR-28/29/30: totals plus one 50-recipient page with an outcome filter). They subscribe to the frame's live socket and refetch on `broadcast.changed` frames ([ADR-0011](adr/0011-push-broadcast-changes-as-id-only-signals-coalesced-to-once-per-second-and-page-the-report.md)).
- **Reuse:** the group picker (SCR-26) composes the Contacts list's search box, tag filter and row components from `features/contacts` and `features/tags`, against the same `GET …/contacts` read, so matching and counts are the Contacts list's by construction (AC-04). The text editor shows the remaining length from the shared length rule ([ADR-0012](adr/0012-count-broadcast-text-in-utf-16-code-units-after-trimming-with-one-shared-rule.md)). Dialogs are shadcn `Dialog` / `AlertDialog`. `screens` picks the primitives.
- **Thread and Contacts:** the inbox thread renders a new item kind `broadcast` (SCR-02). The attention store ignores `conversation.changed` frames whose item is a broadcast (§5, [ADR-0010](adr/0010-store-broadcast-items-as-a-conversations-thread-entry-that-never-touches-conversation-state.md)). The Contacts list and the profile show a "blocked the bot" marker from the contacts reads and refetch on `contact.changed` with `change: 'reach'`.

**Top strategic choices (the seeds for ADRs):**

1. **A new `broadcasts` module owns drafts, groups, recipients and the sending loop. It reaches `contacts`, `conversations`, `bots` and `workspaces` only through their app layers, and `inbox` reads broadcast details from it for the thread.** Static edges added: `broadcasts → {contacts, conversations, bots, workspaces}` and `inbox → broadcasts`. No module calls `broadcasts` back, so it needs no port, and the graph stays acyclic. `bots` stays the only module that talks to Telegram. `inbox` keeps owning no tables. `broadcasts` registers its own routes under `/api/workspaces/:workspaceId/broadcasts…`, like `contacts` (goals 1 and 3): [ADR-0001](adr/0001-add-a-broadcasts-module-that-owns-drafts-groups-and-recipients-and-reaches-other-modules-through-their-app-layers.md).
2. **Reachability belongs to the contact and is kept per Telegram bot in `contacts`.** A new `contacts` table holds one row per contact and Telegram bot id: when the contact first wrote through that bot, whether it is blocked and since when, and the Telegram time of the newest fact applied. Capture writes "wrote" (and clears a block) through the existing `upsertFromProfile`, which now takes the bot's Telegram id. `bots` writes block and unblock. Every read asks about the **current** Telegram bot, so reconnecting the same Telegram bot keeps the marks and connecting a different one starts clean, with no reset job (AC-10, AC-14): [ADR-0002](adr/0002-keep-per-bot-reachability-of-contacts-in-contacts-keyed-by-the-telegram-bot-id.md).
3. **`bots` learns blocks from `my_chat_member` updates and from refused sends, and brings every webhook's allowed updates up to date in the health check.** `allowed_updates` gains `my_chat_member`. The inbound classifier turns a private `my_chat_member` (`kicked` / `member`) into a block change, never a message. Any send to a customer chat refused as blocked (a reply or a broadcast) records a block too. The 3-minute health check re-registers a webhook whose allowed updates are outdated, so bots connected before this feature start receiving block notices within minutes of the deploy (AC-14, §6 blocked freshness ≤ 5 s): [ADR-0003](adr/0003-learn-blocks-from-my-chat-member-updates-and-refused-sends-in-bots-and-re-register-outdated-webhooks-in-the-health-check.md).
4. **Audiences are evaluated by `contacts`, with the Contacts filter's own matching, and return the breakdown and the reachable set.** A tag audience (mode, tags, tags to leave out) and a group (a list of contact ids) both go to `contacts` with the current Telegram bot id. `contacts` answers the audience size, blocked, never wrote to the current bot and reachable, or the reachable contacts themselves (id and Telegram user id). Tags are kept on the draft by id with the name at the moment they were chosen. A tag that no longer exists is left out of the evaluation and reported by that name, so a rename keeps working and a delete or merge drops it with a notice, without any hook from tag admin into `broadcasts` (AC-01, AC-04, AC-05): [ADR-0004](adr/0004-evaluate-audiences-in-contacts-with-the-contacts-filter-rules-and-return-the-breakdown-and-the-reachable-set.md).
5. **Draft fields are versioned. The group is a set of per-contact rows outside the version.** The name, the text, the audience kind and a tag audience's tags are saved with the version the member saw, and a stale save is refused with the current draft. A group add or remove is its own row write under the broadcast row lock, which also enforces the 10 000 limit and "still a draft". It never raises the version. Switching away from a non-empty group carries the group size the member confirmed (AC-03, AC-04, AC-05): [ADR-0005](adr/0005-version-draft-fields-and-keep-the-group-as-per-contact-rows-outside-the-version.md).
6. **A launch confirms the shown version and an audience fingerprint, under a per-workspace launch lock, and freezes the recipients in the same transaction.** The confirmation read returns the version, the breakdown and a fingerprint, the SHA-256 of the sorted reachable contact ids. The launch re-checks, in one transaction: the owner's active membership (share-locked), the per-workspace launch lock and the 10-per-24-h cap, the broadcast row (still a draft, same version), the bot (connected, its Telegram id), the audience (at most 10 000, at least one reachable, same fingerprint). It then inserts the recipients, freezes the text, the audience definition and the bot, and enqueues sending. A second launch of the same broadcast finds it launched and returns it, so a double click or two owners launch once (AC-05, AC-06, AC-09, AC-10): [ADR-0006](adr/0006-launch-against-the-shown-version-and-an-audience-fingerprint-under-a-per-workspace-launch-lock.md).
7. **Sending runs as a per-workspace pg-boss chain that claims each recipient in its own committed transaction before its send.** `broadcasts.send` (policy `stately`, `singletonKey` = workspace id) runs one link of at most 20 s at a time per workspace, across instances. Each link first resolves any recipient left in flight by a dead predecessor as **not confirmed** (with its broadcast item at the claim time, AC-16), then sends, then enqueues its successor in its last transaction while a broadcast of the workspace is still sending. Launch enqueues the first link in its own transaction. Retries and a dead-letter handler that re-enqueues keep the chain alive without any cross-workspace read, so **no new tenancy exception** is needed. A recipient is claimed (`waiting → sending`) and committed before the Telegram call, so nothing is sent twice. A send with no answer ends **not confirmed** and is never repeated (AC-11, §6 at most once): [ADR-0007](adr/0007-send-through-a-per-workspace-pg-boss-chain-that-claims-each-recipient-before-its-send.md).
8. **Broadcasts are paced at 25 per second per bot in turns, wait for the bot's send pause, and go out through a dedicated `bots.sendBroadcastMessage`.** The sender keeps at most 8 sends in flight. Each send takes the next start slot of a per-bot pacer in `bots` (40 ms apart, so any 1 s window holds at most 25). The sending broadcasts of a workspace are served round-robin, one recipient each in turn. `sendBroadcastMessage` refuses without calling Telegram while the bot's send pause runs, when the bot is not `connected` / `taken_over`, or when the workspace's bot is no longer the Telegram bot the broadcast was launched with. Replies keep `sendText`, which neither waits for the pacer nor for the pause (AC-15, §6 pace, reply latency): [ADR-0008](adr/0008-pace-broadcasts-at-25-per-second-per-bot-in-turns-and-wait-for-the-send-pause.md).
9. **A broadcast ends, stops or aborts by settling every waiting recipient in one transaction under the broadcast row lock.** A stop marks the waiting ones "not sent — stopped". A refused text or a lost bot marks them failed with that reason. Claims are single-row conditional updates (`waiting → sending`), so after the settling transaction commits no new send can start, and sends already in flight finish and record their outcome. Every other Telegram refusal fails only its recipient, without a retry (AC-11, AC-12, AC-18, §6 stop takes effect): [ADR-0009](adr/0009-end-stop-or-abort-a-broadcast-by-settling-every-waiting-recipient-in-one-transaction.md).
10. **A broadcast item is a new thread entry kind owned by `conversations`, written in the send's outcome transaction, and enriched by `inbox` from `broadcasts`.** `conversations` stores, per recipient conversation, the broadcast id, the state (delivered / not confirmed) and the position time. It never touches the conversation's status, assignee, state version, waiting period, last activity or anyone's unread. The thread read returns it in the same keyset order as messages, replies and activity entries. `inbox` adds the broadcast's name, text and launching owner from `broadcasts` (AC-16): [ADR-0010](adr/0010-store-broadcast-items-as-a-conversations-thread-entry-that-never-touches-conversation-state.md).
11. **Broadcast changes reach open tabs as id-only `broadcast.changed` signals, report changes coalesced to at most one per broadcast per second, and the report is read as totals plus 50-recipient pages.** `contact.changed` gains `change: 'reach'` and `conversation.changed` gains the item type `broadcast` (AC-11, AC-14, AC-16, §6 report live update ≤ 3 s): [ADR-0011](adr/0011-push-broadcast-changes-as-id-only-signals-coalesced-to-once-per-second-and-page-the-report.md).
12. **The text is trimmed and counted in UTF-16 code units by one shared rule.** `packages/shared/src/broadcast-text.ts` holds the tidy (trim both ends) and the measure (1–4096 UTF-16 code units, Telegram's count), and the name rule (1–80 characters as a person sees them, measured like tag names). The web editor and the API use the same functions (AC-02, AC-17): [ADR-0012](adr/0012-count-broadcast-text-in-utf-16-code-units-after-trimming-with-one-shared-rule.md).

**Supporting choices (inline, below the ADR gate):**

- **Launch cap counting.** The cap counts broadcasts of the workspace whose `launched_at` is within the last 24 h, under the advisory lock `broadcast-launches:<ws>`. A stopped or aborted broadcast keeps its `launched_at`, so it counts. A refused launch writes nothing, so it does not count. The refusal carries `next_launch_at` = the 10th newest `launched_at` + 24 h (AC-09).
- **Duplicates** are one transaction in `broadcasts`: a new draft row (author = the member, name "Copy of …" cut to 80 characters by the shared name rule, same text) plus a copy of the source's audience: the tag rows; the group rows; for a launched broadcast "all recipients" (every recipient row) or "only recipients it did not reach" (outcomes `failed` with reason `bot_stopped`, `text_refused` or `telegram_error`, plus `stopped`, plus `not_confirmed` only when the request carries `include_not_confirmed`), offered only when the broadcast has ended. Copied contacts are re-checked against the workspace by the composite foreign key (AC-13).
- **Deleting a draft** locks the broadcast row and requires status `draft` and that the member is its author or a business owner. Its tag and group rows go with it (AC-07).
- **The draft's count** is computed on every draft read and after every change (ux-flows: not pushed live). The list shows only the audience size, which a tag audience gets from the same count query.
- **Blocked-share alert** (spec §7): once a broadcast ends, a delayed `broadcasts.measure-blocked-share` job (48 h later, payload workspace id + broadcast id) counts delivered recipients whose contact is now blocked for that bot and logs a structured metric. Monitoring alerts above 5 %. No panel surface.

**ux-flows "flagged for design" — where each is decided:**

- The launch confirmation sends back what it showed (version + exact reachable set) → the version and the audience fingerprint, ADR-0006.
- The stop confirmation's waiting count may be stale, needs no second confirmation, and a stop after the last outcome is a no-op → ADR-0009.
- A 10 000-recipient report is not pushed as a list: an id-only `broadcast.changed` signal makes the page refetch its totals and its current 50-recipient page → ADR-0011.
- The blocked mark comes from Telegram updates through `bots` and never becomes a customer message → ADR-0003 (classified before the inbound interceptor and capture, never handed to either).
- The broadcast item is a new thread item kind that never touches read state or conversation state → ADR-0010.
- How live updates arrive (the existing change signal) → ADR-0011.

## 5. Building block view

The repo's layered modular monolith is kept: one new module with `domain → app → infra → http`, and small app-layer additions to four existing modules. `broadcasts` holds every broadcast rule (versions, limits, launch checks, the send loop's decisions, outcome mapping, duplicates) in its pure `domain`, its use cases in `app` behind ports, Kysely repositories and the pg-boss workers in `infra`, and routes in `http`. Other modules are reached only through their app layer, passed in by `buildDeps()` (ADR-0001). Build order in `buildDeps()`: … `contacts` → `conversations` → `bots` core (now with `sendBroadcastMessage`) → `notifications` → `team` → **`broadcasts`** (needs contacts, conversations, bots, workspaces) → `inbox` (now given `broadcasts.itemDetails` for the thread). `contacts` gets its `currentBot` port from the `bots` core, late-bound like the existing ports (a runtime edge, no import).

**Internal decomposition:**

```
apps/api/src/modules/broadcasts/
├── domain/   broadcast.ts (status machine draft → sending → sent | stopped, version rule, who may delete / launch / stop)
│             audience.ts (tag audience shape, missing-tag notice, 10 000 limit, fingerprint over sorted ids)
│             recipient.ts (outcomes + reasons, Telegram answer → outcome map, "fixable" set for duplicates)
│             sending.ts (25 per second, 8 in flight, 20 s link, round-robin turn, 1 s report coalescing)
│             duplicate.ts ("Copy of …" within 80 by the shared name rule, audience copy choices)
├── app/      drafts.ts (create, save fields against a version, switch kind, delete)
│             group.ts (add one, add all matching, remove)
│             preview.ts (draft breakdown, launch confirmation read with fingerprint)
│             launch.ts (ADR-0006) · stop.ts (ADR-0009) · duplicate.ts
│             send-link.ts (one link of the chain: stale in-flight → turns → claim → send → outcome → successor, ADR-0007/0008)
│             reads.ts (list, one broadcast, report totals + page, itemDetails for inbox)
│             blocked-share.ts (the 48 h KPI measurement)
│             ports.ts (repos, ContactsApi, ConversationsApi, BotsApi, WorkspacesApi, signals, clock, jobs)
├── infra/    broadcast-repo.ts · audience-tag-repo.ts · group-repo.ts · recipient-repo.ts
│             signals.ts (broadcast.changed, coalescing) · jobs.ts (broadcasts.send + DLQ, broadcasts.measure-blocked-share)
└── http/     routes.ts (registerBroadcasts: /api/workspaces/:workspaceId/broadcasts…)
```

**Tables at a glance** (indicative; `data-model` fixes names, types and indexes). Every table has a non-null `workspace_id` and composite foreign keys `(workspace_id, …)`:

| Table | Owner | Holds |
|---|---|---|
| `broadcasts` | broadcasts | name, text, status (`draft` / `sending` / `sent` / `stopped`), `version`, audience kind, tag mode, author, last changed by / at; after launch: launched by / at, the launch Telegram bot id, the frozen audience definition (tag names at launch), stopped by / at, finished at, end reason |
| `broadcast_audience_tags` | broadcasts | per draft (and frozen per launched broadcast): tag id, include / exclude, tag name when chosen (no foreign key to `tags`: a delete is detected at read, ADR-0004) |
| `broadcast_group_contacts` | broadcasts | per draft: contact id (composite FK to `contacts`), added by, added at; primary key (workspace, broadcast, contact) |
| `broadcast_recipients` | broadcasts | per launched broadcast: contact id (composite FK), Telegram user id (the chat), turn order, state (`waiting` / `sending` / `delivered` / `blocked` / `failed` / `not_confirmed` / `stopped`), reason, claimed at, outcome at, Telegram message id; unique (workspace, broadcast, contact) |
| `contact_bot_reach` | contacts | per contact and Telegram bot id: wrote at, blocked at (null = not blocked), changed at (Telegram time of the newest fact) — ADR-0002 |
| `broadcast_items` | conversations | per broadcast and recipient conversation: state `delivered` / `not_confirmed`, position time, Telegram message id — ADR-0010 |

**App-layer additions to existing modules** (the only cross-module calls; names indicative):

| Module | New / changed call | Called by | For |
|---|---|---|---|
| contacts | `upsertFromProfile(…, telegramBotId)` writes the reach row (wrote, clears a block when newer) | conversations (capture) | AC-10, AC-14 |
| contacts | `recordBlockChange(workspaceId, telegramBotId, telegramUserId, blocked, at)` | bots | AC-14 |
| contacts | `audienceBreakdown`, `reachableContacts`, `existingTags`, `matchingContactIds`, `contactCards(ids)`, `isBlocked(contactId, botId)` | broadcasts | ADR-0004, AC-04, AC-11 |
| contacts | list / profile rows gain `blocked_since` for the current bot (via the `currentBot` port) | web (SCR-18, SCR-19) | AC-14 |
| bots | `sendBroadcastMessage({ workspaceId, telegramBotId, chatId, text })`, `launchReadiness(workspaceId)` (state + Telegram bot id) | broadcasts | ADR-0008, AC-10 |
| bots | `classifyUpdate` → `reach` decision for `my_chat_member`; `sendText` records a refused-as-blocked; health check re-registers outdated allowed updates | (internal) | ADR-0003 |
| conversations | `recordBroadcastItem(tx, { workspaceId, contactId, broadcastId, state, positionAt, telegramMessageId })`; thread read gains kind `broadcast` | broadcasts; inbox | ADR-0010 |
| workspaces | `lockActiveMembers` (existing) for launch / stop; display names incl. deactivated (existing) | broadcasts, inbox | AC-08, AC-16 |
| inbox | thread entries of kind `broadcast` enriched with `broadcasts.itemDetails` | web (SCR-02) | AC-16 |

**Web additions:** `apps/web/src/features/broadcasts/` (list, draft editor, group picker, launch / stop / duplicate / delete / switch dialogs, report, stores), pages under `apps/web/src/pages/`, routes in `app/routes.tsx`, the Broadcasts navigation item in the frame; `features/inbox` renders `ThreadItemView` kind `broadcast`; `features/attention/store.ts` ignores broadcast items; `features/contacts` shows the blocked marker; `packages/shared/src/broadcasts.ts` (zod DTOs) and `broadcast-text.ts` (ADR-0012).

**C4 Container (L2):**

```mermaid
C4Container
    title broadcasts - Containers

    Person(operator, "Operator", "Drafts and follows broadcasts")
    Person(owner, "Business owner", "Launches and stops")

    Container_Boundary(tginbox, "tg-inbox") {
        Container(web, "Web panel", "React 19, Vite, Zustand, shadcn/ui", "Broadcasts list, draft editor, group picker, report, thread item, blocked marker")
        Container(api, "API server", "Node 26, Fastify 5", "HTTP routes, webhook ingress, live socket hub")
        Container(broadcasts, "broadcasts module", "TypeScript, Kysely", "Drafts, groups, launch, recipients, report, duplicates")
        Container(sender, "broadcasts.send worker", "pg-boss, in-process", "Per-workspace chain: claim, send, outcome, item")
        Container(contacts, "contacts module", "TypeScript, Kysely", "Audience evaluation, per-bot reachability")
        Container(conversations, "conversations module", "TypeScript, Kysely", "Thread incl. broadcast items")
        Container(bots, "bots module", "TypeScript, grammY", "sendBroadcastMessage, pacer, send pause, my_chat_member")
        Container(inbox, "inbox module", "TypeScript", "Thread enrichment, live hub fan-out")
    }

    ContainerDb(db, "PostgreSQL 16", "Postgres + pg-boss schema", "broadcasts tables, contact_bot_reach, broadcast_items, jobs")
    System_Ext(telegram, "Telegram Bot API", "sendMessage, webhook updates")

    Rel(operator, web, "Uses", "HTTPS")
    Rel(owner, web, "Launches, stops", "HTTPS")
    Rel(web, api, "Calls routes, receives change signals", "JSON over HTTPS, WebSocket")
    Rel(api, broadcasts, "Broadcast routes")
    Rel(api, inbox, "Inbox routes, live socket")
    Rel(broadcasts, contacts, "Evaluates audiences")
    Rel(broadcasts, bots, "Launch readiness")
    Rel(broadcasts, sender, "Enqueues the first link at launch", "pg-boss")
    Rel(sender, bots, "sendBroadcastMessage")
    Rel(sender, conversations, "recordBroadcastItem")
    Rel(sender, contacts, "Blocked at the recipient's turn")
    Rel(inbox, broadcasts, "Broadcast item details")
    Rel(bots, contacts, "Records block changes")
    Rel(bots, telegram, "Sends, registers webhook", "HTTPS Bot API")
    Rel(telegram, api, "Webhook updates incl. my_chat_member", "HTTPS")
    Rel(broadcasts, db, "Reads and writes", "SQL via Kysely")
    Rel(sender, db, "Claims and outcomes, publishes signals", "SQL, pg_notify")
```

The containers: the web panel calls the API's routes and listens to change signals on the workspace live socket. The `broadcasts` module serves the broadcast routes, evaluates audiences through `contacts`, checks the bot through `bots`, and at launch enqueues the first link of the `broadcasts.send` worker. The worker runs in the same process: it checks each recipient's block mark in `contacts`, sends through `bots.sendBroadcastMessage` (the only path to Telegram), and records the outcome together with the thread's broadcast item in `conversations`. `bots` also turns Telegram's `my_chat_member` updates into block changes in `contacts`. `inbox` enriches broadcast items in the thread from `broadcasts` and fans every change signal out to the open tabs. All state, including the job queue, is in the one Postgres database.

## 6. Runtime view

design seeds the four critical flows below. The `sequences` stage completes coverage of every AC. Participants are the §5 containers.

**Critical flow 1: A business owner launches a draft against what the confirmation showed (US-03 — AC-05, AC-06, AC-07, AC-09, AC-10)**

```mermaid
sequenceDiagram
    actor Owner as Business owner
    participant Web as Web panel
    participant BC as broadcasts module
    participant WS as workspaces
    participant BT as bots module
    participant CT as contacts module
    participant DB as PostgreSQL
    Owner->>Web: Launch on the draft
    Web->>BC: confirmation read
    BC->>BT: launch readiness (state, Telegram bot id)
    BC->>CT: reachable contacts of the audience for that bot
    BC-->>Web: text, version, breakdown, fingerprint
    Owner->>Web: Confirm
    Web->>BC: launch with version and fingerprint
    BC->>WS: share-lock memberships, owner still active
    BC->>DB: advisory lock broadcast-launches per workspace
    BC->>DB: lock broadcast row, still a draft, same version
    BC->>BT: launch readiness again
    BC->>DB: count launches in the last 24 h
    BC->>CT: reachable contacts again, in the transaction
    alt set, version, bot and cap all hold
        BC->>DB: insert recipients, freeze text, audience and bot, status sending
        BC->>DB: enqueue first broadcasts.send link, publish broadcast.changed
        BC-->>Web: launched
    else something changed or a limit is hit
        BC-->>Web: refusal with the current version, breakdown or next launch time
    end
```

Already-launched (a double click, a second owner) returns the launched broadcast from the row lock step. An operator, a deactivated owner or a foreign workspace is refused before any lock beyond the membership check (AC-07, AC-08).

**Critical flow 2: One link of the sending chain (US-04, US-07, US-08 — AC-11, AC-14, AC-15, AC-16, AC-17)**

```mermaid
sequenceDiagram
    participant Q as pg-boss broadcasts.send
    participant S as broadcasts.send worker
    participant CT as contacts module
    participant BT as bots module
    participant TG as Telegram Bot API
    participant CV as conversations module
    participant DB as PostgreSQL
    Q->>S: link for workspace
    S->>DB: recipients left sending by a dead link become not confirmed
    loop until 20 s or nothing left, at most 8 in flight
        S->>DB: next waiting recipient, broadcasts in turn
        S->>CT: blocked for the launch bot?
        alt blocked now
            S->>DB: outcome blocked the bot, no send
        else reachable
            S->>DB: claim waiting to sending, commit
            S->>BT: sendBroadcastMessage
            BT->>BT: same Telegram bot, not paused, pacer slot
            BT->>TG: sendMessage
            TG-->>BT: answer
            BT-->>S: outcome
            S->>DB: record outcome
            S->>CV: recordBroadcastItem when delivered or not confirmed
            S->>DB: publish broadcast.changed at most once per second
        end
    end
    S->>DB: finish broadcasts with nothing waiting or in flight
    S->>Q: enqueue successor while a broadcast still sends
```

A `429` puts the recipient back to waiting and ends the link with its successor delayed to the pause end. The `bots` answers `text_refused`, `bot_unavailable` and `bot_changed` abort the broadcast (flow 4's settling transaction, ADR-0009): waiting recipients fail with reason `text_refused` ("Telegram refused the text") or `bot_stopped` ("the bot stopped working", for both bot answers). A recipient left `sending` by a dead link becomes not confirmed **and** gets its broadcast item at its claim time in the same transaction (AC-16). Replies never pass through this loop.

**Critical flow 3: A customer blocks the bot (US-06 — AC-14)**

```mermaid
sequenceDiagram
    actor Customer as End customer
    participant TG as Telegram Bot API
    participant API as API server webhook
    participant BT as bots module
    participant CT as contacts module
    participant Hub as inbox live hub
    participant Web as Web panel
    Customer->>TG: blocks the business bot
    TG->>API: my_chat_member update, status kicked
    API->>BT: authenticate by per-bot secret, then classify
    BT->>CT: recordBlockChange blocked, at the update time
    CT->>CT: apply only if newer than the stored fact
    CT->>Hub: contact.changed change reach
    Hub-->>Web: frame to every tab of the workspace
    Web->>API: refetch the Contacts row or the profile
```

No message, conversation, unread or ping results. An unblock (`member`), or a new customer message through capture, clears the mark the same way. A send refused as blocked records the same change from `bots` (ADR-0003).

**Critical flow 4: A business owner stops a sending broadcast (US-04 — AC-18)**

```mermaid
sequenceDiagram
    actor Owner as Business owner
    participant Web as Web panel
    participant BC as broadcasts module
    participant WS as workspaces
    participant DB as PostgreSQL
    participant S as broadcasts.send worker
    Owner->>Web: Stop, sees the waiting count, confirms
    Web->>BC: stop
    BC->>WS: share-lock memberships, owner still active
    BC->>DB: lock broadcast row
    alt sending with waiting recipients
        BC->>DB: every waiting recipient becomes stopped, broadcast stopped, who and when
        BC->>DB: publish broadcast.changed status
        BC-->>Web: stopped
    else nothing waiting
        BC-->>Web: unchanged, sent once the last outcome is in
    end
    S->>DB: next claim finds no waiting recipient of it
    S->>DB: in-flight sends finish and record their outcome
```

The claim is a conditional single-row update (`waiting → sending`), so the stop's commit is the moment after which no send of that broadcast can start (spec §6: 0 sends started more than 2 s after the stop).

Flows 5–19 below were added by the `sequences` stage. They use the generic runtime vocabulary: `<user>` (an operator or business owner in the panel, or the end customer in Telegram where a flow says so), `<ui>` (a tab of the web panel), `<service>` (tg-inbox's backend), `<data-store>`, `<message-bus>` (the job queue and the live-signal fan-out; a flow that needs both draws two, marked "jobs" and "live") and `<external-system>` (the Telegram Bot API). `SCR-NN` ids refer to [`ux-flows.md`](ux-flows.md). Every persist or read note is a hint for `data-model`. The seeded flows 1–4 above are unchanged.

**Assumptions (autonomous run 2026-10-23, `sequences`)**, each can be vetoed at review:

- Depth = medium, size L (`.size`), route `full` (`.route`). The pipeline confirmed every flow itself against spec §5, `ux-flows.md` and ADR-0001…0012. Each flow's prose account is the paragraph under it.
- The same session guard (signed out, another workspace, deactivated) fronts every broadcasts route. It is drawn in full in flow 5 and referred to elsewhere. A broadcast id of another workspace is not found, with no hint.
- "Launch" on the draft reads the launch confirmation. That one read is also the pre-check: it answers either the confirmation (text, version, breakdown, fingerprint) or the refusal ux-flows shows on the draft (no working bot, nobody reachable, over 10 000, the 24-hour cap). No separate pre-check route.
- With no bot at all (no bot row), the draft breakdown shows the audience size and says that reach is known once a bot is connected. A bot that is not working (`needs_token`, `taken_over`) still has its Telegram bot id, so the breakdown is computed against it.
- At launch each recipient gets a position in the order the fingerprint sorts them (by contact id). The sender serves a broadcast's waiting recipients in position order, and the report lists recipients in that order, optionally narrowed to one outcome.
- The launch also freezes the breakdown it confirmed (audience size, blocked, never wrote to the current bot, recipients) on the broadcast. The Broadcasts list and the broadcast page read these numbers instead of recounting.
- The group is shown 50 contacts at a time, the most recently added first. The group picker asks the draft which contacts of its current page are already in the group (ids of that page only).
- A delivered broadcast item sits at the time the answer was recorded. A not confirmed one sits at its claim time (the time the send was made).
- Every write on a broadcast (draft fields, group, launch, stop, abort, finish) moves its "last changed" time, which orders the list. Only draft field saves raise the version.

### Flow 5: Open the Broadcasts list, and it stays live (US-01, US-04 — AC-01, AC-08)

```mermaid
sequenceDiagram
    autonumber
    actor U as #lt;user#gt;
    participant UI as #lt;ui#gt;
    participant S as #lt;service#gt;
    participant D as #lt;data-store#gt;
    participant B as #lt;message-bus#gt; live
    Note over U,S: Precondition: a person opens Broadcasts of workspace W from the navigation or by its address (SCR-15, SCR-24)
    U->>UI: opens Broadcasts
    UI->>S: ask for the broadcasts of W
    S->>D: check the session and the membership in W
    alt not signed in
        S-->>UI: sign in first
        UI-->>U: sign-in, then back to the same address (SCR-09)
    else account of another workspace, or an unknown workspace
        S-->>UI: not found, no hint the workspace exists
        UI-->>U: not-found card in the frame (SCR-06)
    else membership deactivated
        S-->>UI: access removed
        UI-->>U: access-removed landing (SCR-07)
    else active member of either role
        S->>D: read every broadcast of W, most recently changed first
        Note over S,D: reads broadcasts by (workspace, last changed desc, id desc) - name, status, who last changed or launched it, the frozen breakdown of launched ones
        S->>D: audience size of each draft
        Note over S,D: a group counts its rows by (workspace, broadcast) - a tag audience runs the Contacts filter count over contact tags by (workspace, tag, contact)
        S-->>UI: rows with name, status, audience size and who last changed or launched it
        alt W has broadcasts
            UI-->>U: drafts and launched together, newest change first
        else none yet
            UI-->>U: what a broadcast is, and New broadcast for every member
        end
        loop while the list is open
            B-->>UI: broadcast changed, ids only
            UI->>S: refetch the list
        end
    end
    Note over U,S: Postcondition: only broadcasts of W are listed, the same list for both roles
```

Broadcasts, from the navigation or by its address, asks for the workspace's broadcasts. The usual guard sends a signed-out visitor to sign in and back, gives another workspace's account the not-found card with no hint, and gives a deactivated member the access-removed landing (AC-08). An active member of either role gets every broadcast of the workspace, drafts and launched ones together, the most recently changed first, each with its name, status, audience size and who last changed or launched it (AC-01). A draft's audience size is its group's row count or its tag audience's matching count. A launched broadcast shows the breakdown frozen at launch. An empty list explains broadcasts and offers "New broadcast". While the list is open, every `broadcast.changed` frame makes it refetch, so statuses change live.

### Flow 6: Create a draft and save its name and text against the version shown (US-01 — AC-01, AC-02, AC-03, AC-09, AC-10)

```mermaid
sequenceDiagram
    autonumber
    actor U as #lt;user#gt;
    participant UI as #lt;ui#gt;
    participant S as #lt;service#gt;
    participant D as #lt;data-store#gt;
    participant B as #lt;message-bus#gt; live
    Note over U,S: Precondition: an active member on Broadcasts of W past the guard of flow 5, with or without a working bot
    U->>UI: New broadcast, types a name and a text
    UI->>UI: tidy and measure with the shared rule, show the remaining length as Telegram counts it
    alt name outside 1 to 80, or text empty, spaces only or over 4096 code units
        UI-->>U: message next to the field, nothing saved
    else first valid name
        UI->>S: create a draft with the name and the text
        S->>S: tidy and measure again, refuse an invalid name or text
        S->>D: insert the draft - status draft, version 1, author and last changed by the member, tag audience any of with no tags
        Note over S,D: persists broadcasts (id from newId, workspace, author, version, trimmed text, last changed by and at)
        S->>B: publish broadcast changed draft, commit
        S-->>UI: the draft with its version and breakdown
    end
    U->>UI: changes the name or the text
    UI->>S: save the field with the version shown
    S->>S: tidy and measure, refuse an invalid value - the draft keeps its last valid content
    S->>D: lock the broadcast row of W for no key update
    alt not a broadcast of W
        S-->>UI: not found, no hint
    else launched already
        S-->>UI: refused, not a draft
        UI-->>U: the read-only broadcast page with Duplicate (SCR-28)
    else another version
        S-->>UI: refused, draft changed, with the current draft
        UI-->>U: the teammate's version next to the member's own edit, to apply again
    else the version shown
        S->>D: write the field, raise the version, record who and when
        Note over S,D: persists broadcasts version, name or text, last changed by and at
        S->>B: publish broadcast changed draft, commit
        S-->>UI: the draft with its new version
    end
    Note over U,S: Postcondition: the draft holds the last valid content saved on the version its author saw, no customer is messaged, and no bot was needed
```

"New broadcast" opens an empty editor. The browser tidies and measures with the shared rule while the member types (ADR-0012), shows the remaining length as Telegram counts it, and creates the draft at the first valid name (AC-02). The server checks the same rule again, so an invalid name or text is refused and the draft keeps its last valid content. The draft starts at version 1, with the member as its author and last changer, and is listed for every member (flow 5). Each later save of the name or the text carries the version the member saw. Under the broadcast row lock, a launched broadcast refuses the save as not a draft (AC-09), and another version refuses it as changed with the current draft, which the editor shows next to the member's own edit (AC-03). Otherwise the field is written, the version goes up and the list signal fires. Nothing here needs a bot (AC-10) or sends anything.

### Flow 7: Choose a tag audience, read the breakdown, switch the audience kind (US-01, US-02 — AC-01, AC-03, AC-05, AC-10, AC-14)

```mermaid
sequenceDiagram
    autonumber
    actor U as #lt;user#gt;
    participant UI as #lt;ui#gt;
    participant S as #lt;service#gt;
    participant D as #lt;data-store#gt;
    participant B as #lt;message-bus#gt; live
    Note over U,S: Precondition: an active member on a draft of W (SCR-25)
    U->>UI: picks tags, any of, all of or no tags, and tags to leave out
    UI->>S: save the tag audience with the version shown
    S->>D: lock the broadcast row, still a draft and the version shown - as flow 6
    S->>D: resolve the tag ids among the tags of W
    Note over S,D: reads tags by (workspace, id) - an id of another workspace does not resolve and is refused as not found
    S->>D: replace the draft's tag rows, each with include or leave out and its name now, raise the version
    Note over S,D: persists broadcast audience tags keyed by (workspace, broadcast, tag) - no foreign key to tags
    S->>B: publish broadcast changed draft, commit
    UI->>S: read the draft
    S->>S: ask the bot module for the current Telegram bot id
    S->>D: which of the stored tag ids still exist
    S->>D: breakdown for the audience and that bot - audience size, blocked, never wrote, reachable
    Note over S,D: one aggregate query - contact tags by (workspace, tag, contact) for the match and the leave-out, reach rows by (workspace, contact, Telegram bot)
    S-->>UI: the draft, its breakdown and the names of dropped tags
    alt a stored tag was deleted or merged away
        UI-->>U: dropped from the audience with a notice naming it
    else a stored tag was renamed
        UI-->>U: still in the audience under its current name
    end
    alt audience over 10 000
        UI-->>U: saved, cannot be launched, and why
    else no bot at all
        UI-->>U: the audience size, reach known once a bot is connected
    else a bot, working or not
        UI-->>U: audience, left out as blocked, left out as never wrote to the current bot, would reach
    end
    opt switch from a broadcast group holding N contacts to a tag audience
        UI-->>U: confirm switch, the group holds N contacts (SCR-32)
        U->>UI: confirms
        UI->>S: switch to a tag audience with the version shown and the group size N
        S->>D: lock the broadcast row, still a draft and the version shown, count the group rows
        alt the group size is no longer N
            S-->>UI: refused, group changed, with its current size
            UI-->>U: asks again with the current number
        else still N
            S->>D: delete the group rows, kind tags, raise the version
            S->>B: publish broadcast changed draft, commit
        end
    end
    opt switch from a tag audience to a broadcast group
        UI->>S: switch to a group with the version shown
        S->>D: lock, check, delete the tag rows, kind group, raise the version, commit
    end
    Note over U,S: Postcondition: the draft's tag audience is saved by tag id with the name when chosen, and every read counts it with the Contacts filter's rules for the current bot
```

The member picks tags, the match mode and tags to leave out. The save carries the version shown and is checked as in flow 6. The tag ids are resolved among the workspace's own tags, so a foreign id is refused. Each chosen tag is stored by id with "include" or "leave out" and its name at that moment, with no foreign key to tags (ADR-0004). Every draft read asks `bots` for the current Telegram bot id, keeps only the stored tags that still exist, and runs one aggregate query with the Contacts filter's rules ("any of", "all of", "no tags", no tag = every contact, a left-out tag removes the contact) joined to the reach rows of that bot. It answers the audience size, blocked, never wrote to the current bot and would reach (AC-01, AC-10, AC-14). A renamed tag keeps working under its new name, and a deleted or merged one is dropped with a notice that uses its stored name. An audience over 10 000 is saved but cannot be launched (AC-05). With no bot at all, only the audience size is shown. Switching from a non-empty group asks first with its size. The switch carries that size, and a different size is refused with the current one (AC-03). Switching to a group simply drops the tag rows.

### Flow 8: Fill a broadcast group from the group picker (US-02 — AC-03, AC-04, AC-05, AC-08, AC-14)

```mermaid
sequenceDiagram
    autonumber
    actor U as #lt;user#gt;
    participant UI as #lt;ui#gt;
    participant S as #lt;service#gt;
    participant D as #lt;data-store#gt;
    participant B as #lt;message-bus#gt; live
    Note over U,S: Precondition: an active member on a draft of W whose audience is a broadcast group (SCR-25)
    U->>UI: Add contacts, then searches and filters (SCR-26)
    UI->>S: a page of contacts with the search and the filter - the Contacts list read
    S->>D: the Contacts list query of W, as contacts flow 5
    S-->>UI: rows, matching count and total, as on the Contacts list
    UI->>S: which contacts of this page are already in the group
    S->>D: group rows of the draft for those contact ids
    Note over S,D: reads broadcast group contacts by (workspace, broadcast, contact)
    S-->>UI: the ids already there, marked in the picker
    opt add one contact
        U->>UI: adds Olena K.
        UI->>S: add one contact to the group
        S->>D: lock the broadcast row of W for no key update, still a draft, count the group rows
        alt not a contact of W
            S-->>UI: not found, no hint
        else a teammate switched the audience to tags meanwhile
            S-->>UI: refused, draft changed, with the current draft
        else already in the group
            S-->>UI: unchanged, already there
        else the group holds 10 000
            S-->>UI: refused, audience too large, 0 can still be added
        else added
            S->>D: insert the group row with the adder and the time, on conflict nothing, record last changed - the version stays
            Note over S,D: persists broadcast group contacts keyed by (workspace, broadcast, contact) - the composite foreign key to contacts (workspace, id) cannot hold a contact of another workspace
            S->>B: publish broadcast changed group, commit
            S-->>UI: added, with the group size
        end
    end
    opt add all matching
        U->>UI: add all matching
        UI->>S: how many contacts match and are not in the group
        S->>D: matching contact ids of W minus the group rows
        S-->>UI: N to add
        UI-->>U: states N, asks to confirm
        U->>UI: confirms
        UI->>S: add all matching with the search, the filter and N
        S->>D: lock the broadcast row, still a draft, count the group rows
        S->>D: the matching contact ids now, up to the room left plus one, minus the group rows
        Note over S,D: reads the Contacts filter (contacts and contact tags of W) and group rows by (workspace, broadcast, contact)
        alt no longer a group - a teammate switched the audience
            S-->>UI: refused, draft changed, with the current draft
        else the group would pass 10 000
            S-->>UI: refused as a whole, audience too large, how many can still be added
        else within the limit
            S->>D: insert the rows on conflict nothing, record last changed
            S->>B: publish broadcast changed group, commit
            S-->>UI: how many were added
            UI-->>U: says how many - the current matches when they changed since the count
        end
    end
    opt remove a contact
        U->>UI: removes a contact from the group
        UI->>S: remove the contact from the group
        S->>D: lock the broadcast row, still a draft, delete the group row by its key - an absent row changes nothing
        S->>B: publish broadcast changed group, commit
    end
    UI->>S: read the group - 50 contacts, newest added first, with the breakdown
    S->>D: group rows by (workspace, broadcast, added at desc, contact), then their names, usernames, tags and block marks for the current bot
    Note over S,D: breakdown for a group - its contact ids joined to reach rows by (workspace, contact, Telegram bot)
    S-->>UI: the group page, its size and how many it would reach
    UI-->>U: contacts with name, username, tags and a blocked marker
    Note over U,S: Postcondition: two members' adds and removes both stand, never raise the version, and the group holds at most 10 000 contacts of W
```

The group picker is the Contacts list's own read with the same search and tag filter, so matching and counts are the same by construction (AC-04, ADR-0004). It marks the page's contacts that are already in the group. Adding one contact locks the broadcast row, checks that it is still a draft and that the group is under 10 000, and inserts one row keyed by workspace, broadcast and contact. A contact already there changes nothing and says so (AC-05). The composite foreign key makes a contact of another workspace unstorable, and the request answers not found (AC-08). "Add all matching" first counts the matching contacts not in the group, and on confirmation re-reads the matches under the row lock. It refuses the whole add if the group would pass 10 000, saying how many can still be added (AC-05). Otherwise it adds the current matches and says how many, which can differ from the count shown. An add after a teammate switched the draft to a tag audience is refused as a changed draft, with the current draft (amended at `api`). Removing deletes one row by its key and changes nothing on the contact. Group writes are set operations that never raise the version, so two members' adds and removes both stand and never make a teammate's name or text save stale (AC-03, ADR-0005). The group shows 50 contacts at a time with their tags and block marks for the current bot, its size and how many it would reach (AC-14).

### Flow 9: Delete a draft (US-01 — AC-07, AC-08, AC-09)

```mermaid
sequenceDiagram
    autonumber
    actor U as #lt;user#gt;
    participant UI as #lt;ui#gt;
    participant S as #lt;service#gt;
    participant D as #lt;data-store#gt;
    participant B as #lt;message-bus#gt; live
    Note over U,S: Precondition: an active member on a draft of W, or on its row of the Broadcasts list
    alt neither the draft's author nor a business owner
        UI-->>U: no delete, a draft is deleted by its author or a business owner
    else author or business owner
        U->>UI: Delete
        UI-->>U: confirm delete, names the draft and its audience size (SCR-31)
        U->>UI: confirms
        UI->>S: delete the draft
        opt the member is a business owner
            S->>D: share-lock the member's active membership of W
        end
        S->>D: lock the broadcast row of W for no key update
        alt not a broadcast of W
            S-->>UI: not found, no hint
        else launched
            S-->>UI: refused, not a draft
            UI-->>U: read-only, offer Duplicate
        else neither its author nor an active business owner
            S-->>UI: forbidden, a draft is deleted by its author or a business owner
        else may delete
            S->>D: delete its tag rows and group rows, then the broadcast row
            Note over S,D: deletes broadcast audience tags and broadcast group contacts by (workspace, broadcast), then broadcasts by (workspace, id)
            S->>B: publish broadcast changed deleted, commit
            S-->>UI: deleted
            UI-->>U: back to the Broadcasts list (SCR-24)
        end
    end
    Note over U,S: Postcondition: only a draft is ever deleted, by its author or a business owner, and launched broadcasts stay
```

Only the draft's author and business owners see Delete. Anyone else sees why not (AC-07). The confirmation names the draft and its audience size. The server takes a business owner's membership with a share lock first (§8 lock order), then the broadcast row. A foreign id is not found (AC-08). A launched broadcast is refused as not a draft and stays read-only (AC-09). A member who is neither its author nor an active business owner is refused, whatever the browser showed (AC-07). Otherwise the draft's tag and group rows go with it, and every open list drops it on the `deleted` signal.

### Flow 10: Launch — from "Launch" to a launched broadcast or a refusal (US-03 — AC-05, AC-06, AC-07, AC-08, AC-09, AC-10)

```mermaid
sequenceDiagram
    autonumber
    actor U as #lt;user#gt;
    participant UI as #lt;ui#gt;
    participant S as #lt;service#gt;
    participant D as #lt;data-store#gt;
    participant B as #lt;message-bus#gt; live
    Note over U,S: Precondition: a member on a draft of W (SCR-25), or a saved launch-confirmation address
    alt an operator
        UI-->>U: no launch action, only a business owner launches - a confirmation address lands on the draft with the same note
    else a business owner
        U->>UI: Launch
        UI->>S: read the launch confirmation
        S->>D: guard, business owner role, a draft of W
        S->>S: ask the bot module for readiness - state and Telegram bot id
        S->>D: launches of W in the last 24 h
        Note over S,D: reads broadcasts by (workspace, launched at) where launched
        S->>D: existing tags, then the reachable set and the breakdown for that bot
        alt no bot, or the bot is not connected
            S-->>UI: refused, needs a working bot, with its state
            UI-->>U: on the draft, with the way to Settings - Bot (SCR-08)
        else audience over 10 000
            S-->>UI: refused, audience too large
            UI-->>U: on the draft, at most 10 000
        else nobody reachable
            S-->>UI: refused, no reachable contact
            UI-->>U: on the draft, the audience has no reachable contact
        else 10 launches in the last 24 h
            S-->>UI: refused, launch limit, next launch at the 10th newest launch plus 24 h
            UI-->>U: on the draft, when the next launch is possible
        else it can be launched
            S->>S: fingerprint over the sorted reachable contact ids
            S-->>UI: trimmed text, version, breakdown, fingerprint
            UI-->>U: text as the customer sees it, count, left out and why, the warning (SCR-27)
            U->>UI: confirms
            UI->>S: launch with the version and the fingerprint
            Note over S,D: the launch transaction of seeded flow 1 - every check above runs again
            S->>D: insert the recipients in fingerprint order, freeze text, tag names, bot and breakdown, status sending
            Note over S,D: persists broadcast recipients (workspace, broadcast, contact, position, Telegram user id, waiting) and broadcasts launched by, launched at, Telegram bot id, frozen counts
            alt launched
                S->>B: publish broadcast changed status, commit with the first link queued
                S-->>UI: the broadcast, sending
                UI-->>U: the broadcast page (SCR-28), sending for every member
            else launched already by a teammate or a double click
                S-->>UI: the launched broadcast, nothing launched again
                UI-->>U: the broadcast page
            else text, audience or reachable set changed since the confirmation
                S-->>UI: refused, with the current version, breakdown and fingerprint
                UI-->>U: the current version and number to confirm again
            else the owner was deactivated meanwhile
                S-->>UI: access removed, nothing launched
                UI-->>U: access-removed landing (SCR-07)
            else bot, size, reach or cap no longer holds
                S-->>UI: the same refusal as at the confirmation read
            end
        end
    end
    opt an operator posts a launch anyway
        S-->>UI: forbidden, nothing sent or changed
    end
    Note over U,S: Postcondition: a broadcast is launched at most once, to exactly the fingerprinted set, within the cap
```

An operator sees no launch action, and a saved confirmation address brings them to the draft with the owners-only note. A launch request from them is refused and changes nothing (AC-07). For a business owner, "Launch" reads the confirmation, which is also the pre-check (sequences assumption). It asks `bots` for the bot's state and Telegram id and counts the launches of the last 24 h. It then evaluates the audience for that bot. No bot or a bot that is not connected is refused with the way to the bot settings (AC-10). An audience over 10 000 (AC-05), nobody reachable (AC-09) and the 10th launch within 24 h are refused too, the last one with the next launch time (AC-09). Otherwise the confirmation shows the trimmed text, the count, who is left out and why, and the warning. It carries the version and the fingerprint (AC-06, ADR-0006). Confirming runs the launch transaction of seeded flow 1, which re-checks all of it. A double click or a second owner gets the launched broadcast back and launches nothing again. A changed text, audience or reachable set (even with the same number) is refused with the current version to confirm again. An owner deactivated meanwhile launches nothing (AC-08). A successful launch inserts the recipients in fingerprint order, freezes the text, the tag names, the Telegram bot id and the confirmed breakdown, sets status `sending`, queues the first link and signals every tab.

### Flow 11: Follow the delivery report (US-04 — AC-07, AC-09, AC-11, AC-18)

```mermaid
sequenceDiagram
    autonumber
    actor U as #lt;user#gt;
    participant UI as #lt;ui#gt;
    participant S as #lt;service#gt;
    participant D as #lt;data-store#gt;
    participant B as #lt;message-bus#gt; live
    Note over U,S: Precondition: a member opens a broadcast of W from the list, its address, a launch, or a broadcast item in a thread
    UI->>S: read the broadcast
    S->>D: guard, then the broadcast of W
    alt not a broadcast of W
        S-->>UI: not found, no hint
        UI-->>U: not-found card (SCR-06)
    else a draft
        UI-->>U: the draft editor at the same address (SCR-25)
    else launched
        S->>D: totals of its recipients by state
        Note over S,D: reads broadcast recipients counted by (workspace, broadcast, state)
        S-->>UI: name, text, the audience as defined with tag names at launch, launched by and at, status, stop or finish, totals
        UI->>S: first 50 recipients, optionally of one outcome
        S->>D: recipients after the cursor in position order, then their contact names
        Note over S,D: reads broadcast recipients by (workspace, broadcast, position) or by (workspace, broadcast, state, position) when narrowed
        S-->>UI: recipients with outcome, reason and time, and the next cursor
        UI-->>U: the read-only page and its report (SCR-28)
        loop while it sends
            B-->>UI: broadcast changed report or status, at most once per second per broadcast
            UI->>S: refetch the totals and the current page, one fetch at a time
            UI-->>U: totals and outcomes move, sent or stopped at the end
        end
        opt someone tries to edit or delete it
            S-->>UI: refused, not a draft
            UI-->>U: read-only, offer Duplicate
        end
        opt an operator
            UI-->>U: no stop action - a stop request is refused as forbidden and changes nothing
        end
        opt a business owner while it sends
            UI-->>U: Stop with the waiting count (SCR-29) - seeded flow 4
        end
        opt picks a recipient
            UI-->>U: the contact's profile (SCR-19)
        end
    end
    Note over U,S: Postcondition: the page shows the stored outcome of every recipient of W's broadcast, never more than one fetch behind the newest signal
```

A broadcast's address shows the draft editor while it is a draft and the read-only page once it is launched. A foreign id is the not-found card. The page shows the name, the text, the audience as it was defined (tag names at launch), who launched it and when, its status and the totals by outcome, which are one grouped count over the recipient rows (AC-11). Recipients come 50 at a time in position order, optionally narrowed to one outcome, each with its outcome, reason and time. While it sends, `broadcast.changed` frames (at most one per second per broadcast, ADR-0011) make the page refetch its totals and its current page, one fetch at a time. Every edit or delete is refused as not a draft, and the page offers Duplicate (AC-09). An operator has no Stop, and a stop request from them is refused (AC-18). A business owner gets Stop, drawn in seeded flow 4. Picking a recipient opens their profile.

### Flow 12: One recipient's turn — the end customer receives the broadcast once (US-08, US-04 — AC-08, AC-11, AC-12, AC-14, AC-16, AC-17, AC-18)

```mermaid
sequenceDiagram
    autonumber
    participant Q as #lt;message-bus#gt; jobs
    participant S as #lt;service#gt;
    participant D as #lt;data-store#gt;
    participant X as #lt;external-system#gt;
    actor C as #lt;user#gt; end customer
    participant B as #lt;message-bus#gt; live
    Note over Q,S: Trigger: a send link of W is running (flow 14) and recipient R of broadcast A has its turn
    Q->>S: link of W, ids only
    S->>D: is R's contact blocked for A's launch Telegram bot
    Note over S,D: reads reach rows by (workspace, contact, Telegram bot)
    alt blocked now
        S->>D: R blocked the bot, with the time, nothing sent
        Note over S,D: persists the recipient's state, reason and outcome time
    else reachable
        S->>D: claim R - waiting to sending with the claim time, only if still waiting, commit
        Note over S,D: idempotency key - the conditional single-row update, a recipient that is not waiting is never claimed again
        alt R was not waiting - settled by a stop or an abort
            S->>S: skip R, nothing sent
        else claimed
            S->>S: the bot module checks the same Telegram bot of W, connected or taken over, no send pause, then a pacer slot
            S->>X: send the trimmed text to R's private chat, no formatting
            X->>C: one plain-text message from the business bot
            X-->>S: answer
            alt accepted
                S->>D: R delivered with the Telegram message id, broadcast item delivered at that time
                Note over S,D: persists the recipient outcome and the broadcast item keyed by (workspace, broadcast, conversation)
                S->>B: conversation changed, item type broadcast
            else refused, bot blocked by the user
                S->>D: R blocked the bot, and the contact's reach row marked blocked
                S->>B: contact changed reach
            else refused, account deleted or chat not found
                S->>D: R failed with that reason, no item
            else no answer - timeout or a lost connection
                S->>D: R not confirmed, broadcast item not confirmed at the claim time
                S->>B: conversation changed, item type broadcast
            else rate limited, or the bot module refuses because of the send pause
                S->>D: R back to waiting, the bot's send pause stored
                S->>S: the link stops and queues its successor at the pause end - flow 19
            else Telegram refuses the text, or the bot is not working, disconnected or replaced
                S->>D: abort A - flow 13
            else any other Telegram error
                S->>D: R failed, Telegram error, no item
            end
            S->>B: broadcast changed report, when 1 s passed since the last one for A
        end
    end
    Note over S,X: retry - none per recipient, only a rate-limited recipient waits and is tried again
    alt the link dies between the claim and the answer
        S->>D: the next link resolves R as not confirmed with its item at the claim time - flow 14
        Note over S,D: dead-letter - a lost send is never repeated
    end
    Note over Q,C: Postcondition: R got the broadcast at most once, as plain text, and has exactly one outcome
```

Each turn first re-checks the recipient's block mark for the Telegram bot the broadcast was launched with: a contact blocked now gets "blocked the bot" and no send, and one who unblocked is sent it (AC-11, AC-14). Otherwise the recipient is claimed with a conditional single-row update (`waiting → sending`) that commits before the Telegram call. That update is the idempotency key: a recipient settled by a stop or an abort is never claimed (AC-18), and a recipient that is not waiting is never sent again (AC-11). `bots` checks that the workspace's bot is still the same Telegram bot and working, that no send pause runs, and takes a pacer slot. The send is scoped by the workspace, so one workspace's bot never sends another's broadcast (AC-08). The customer gets one plain-text message with the trimmed text, with no formatting and nothing about other recipients (AC-17). Telegram's answer decides the outcome (ADR-0009). Accepted means delivered, with a broadcast item at that time (AC-16). Blocked means "blocked the bot", and the contact is marked (AC-14). A deleted account or an unknown chat fails with that reason. No answer means not confirmed, with an item at the claim time, never sent again (AC-11, AC-16). A rate limit, or the pause seen by `bots`, puts the recipient back to waiting. A refused text or a lost bot aborts the broadcast (flow 13, AC-12). Any other error fails only this recipient. No outcome is retried except the rate-limited wait. If the link dies after the claim, the next link marks the recipient not confirmed. Outcomes, items and report signals are written in the outcome transaction.

### Flow 13: A broadcast ends — finished or aborted (US-04 — AC-11, AC-12)

```mermaid
sequenceDiagram
    autonumber
    participant S as #lt;service#gt;
    participant D as #lt;data-store#gt;
    participant Q as #lt;message-bus#gt; jobs
    participant B as #lt;message-bus#gt; live
    Note over S,D: Trigger: the send link recorded an outcome of broadcast A, or a send of A came back as a refused text or a lost bot
    S->>D: lock A's row for no key update
    alt A is no longer sending - stopped or ended meanwhile
        S->>S: nothing to settle
    else Telegram refused the text
        S->>D: every waiting recipient of A failed, Telegram refused the text, A sent with its finish time and end reason
        Note over S,D: one bulk update of broadcast recipients by (workspace, broadcast, state) - persists broadcasts finished at and end reason
    else the bot is not working, disconnected or replaced
        S->>D: every waiting recipient of A failed, the bot stopped working, A sent with its finish time and end reason
    else nothing of A is waiting or in flight
        S->>D: A sent with its finish time
        Note over S,D: reads broadcast recipients by (workspace, broadcast, state) for waiting and sending
    else recipients still wait or are in flight
        S->>S: A keeps sending
    end
    opt A ended in this transaction
        S->>Q: queue the blocked-share measure for A 48 h later, one per broadcast
        S->>B: publish broadcast changed status, commit
    end
    opt sends of A in flight at the abort
        S->>D: they record their own outcome as usual
    end
    opt the bot works again, or another bot is connected later
        S->>S: nothing of A is sent - no recipient of A is waiting
    end
    Note over S,B: Postcondition: an ended broadcast has no waiting recipient, and its report shows who got it before the end
```

After each outcome the link checks whether the broadcast is done. Under the broadcast row lock (ADR-0009), a refused text fails every waiting recipient with "Telegram refused the text", and a bot that is not working, disconnected or replaced (both `bots` answers) fails them with "the bot stopped working". Either way the broadcast becomes "sent" with its finish time and end reason, in one bulk update (AC-12). A broadcast with nothing waiting and nothing in flight becomes "sent" (AC-11). A broadcast that was stopped meanwhile is left alone. An ending queues the 48-hour blocked-share measurement and signals every tab. Sends already in flight finish and record their outcome. Because no recipient of an ended broadcast is waiting, nothing of it is ever sent later, by a working bot or a new one.

### Flow 14: The send chain stays alive — first link, restart, retries, dead letter (US-04, US-07 — AC-11, AC-15, AC-16)

```mermaid
sequenceDiagram
    autonumber
    participant Q as #lt;message-bus#gt; jobs
    participant S as #lt;service#gt;
    participant D as #lt;data-store#gt;
    participant B as #lt;message-bus#gt; live
    Note over Q,S: Trigger: a launch queued the first link of W, a link queued its successor, or a retry or the dead-letter handler did
    Q->>S: deliver the link of W - at most one active per workspace across instances
    S->>S: check idempotency - the queue's one-active-link rule per workspace means any recipient still sending is stale
    S->>D: W's sending broadcasts, oldest launch first, and their recipients still sending
    Note over S,D: reads broadcasts by (workspace, status) where sending, and broadcast recipients by (workspace, broadcast, state)
    opt recipients left sending by a dead link
        S->>D: each becomes not confirmed with its broadcast item at its claim time, one transaction
        S->>B: broadcast changed report, conversation changed per item
    end
    loop up to 20 s, at most 8 sends in flight, broadcasts in turn
        S->>D: the next waiting recipient of the next broadcast in turn
        Note over S,D: reads broadcast recipients by (workspace, broadcast, state, position) - lowest waiting position
        S->>S: that recipient's turn - flow 12
    end
    S->>S: wait for the sends in flight, each bounded by 10 s
    S->>D: end the broadcasts with nothing left - flow 13
    alt a broadcast of W still sends
        S->>Q: queue the successor in the last transaction, at the send pause end when paused
    else nothing sends
        S->>S: the chain ends
    end
    Note over Q,S: retry 3 times with back-off when a link fails
    alt retries exhausted
        Q->>Q: route the link to the dead-letter queue
        Q->>S: the dead-letter handler logs an error and queues a fresh link of W 60 s later
        Note over Q,S: dead-letter after 3 failed attempts, then the chain resumes
    end
    opt the process restarts mid-link
        Q->>S: the queued link or its retry runs on any instance and resumes with the waiting recipients
    end
    Note over Q,D: Postcondition: every sending broadcast of W has a link queued or running, and no recipient is sent twice
```

The chain is a pg-boss queue with one active link per workspace (ADR-0007). A link carries only the workspace id. It first finds the workspace's sending broadcasts and any recipient still `sending`. Because only one link is active, such a recipient was left by a dead link, so it becomes "not confirmed" with its broadcast item at its claim time (AC-11, AC-16). The link then runs for at most 20 s with at most 8 sends in flight. It picks the lowest waiting position of each sending broadcast in turn, oldest launch first, so two broadcasts both move on (AC-15). It waits for the sends in flight, ends the broadcasts with nothing left (flow 13), and queues its successor in its last transaction while anything still sends, delayed to the send pause end when the bot is paused. A failed link is retried 3 times with back-off. After that the dead-letter handler logs it and queues a fresh link 60 s later. A restart loses nothing: the queued link runs on any instance and continues with the recipients still waiting (AC-11).

### Flow 15: Duplicate a broadcast into a new draft (US-05 — AC-07, AC-08, AC-13, AC-18)

```mermaid
sequenceDiagram
    autonumber
    actor U as #lt;user#gt;
    participant UI as #lt;ui#gt;
    participant S as #lt;service#gt;
    participant D as #lt;data-store#gt;
    participant B as #lt;message-bus#gt; live
    Note over U,S: Precondition: an active member of either role on a broadcast of W, its row or its page
    alt the source is a draft
        U->>UI: Duplicate on the row or in the editor
        UI->>S: duplicate the draft
    else the source is launched
        U->>UI: Duplicate on the row or on the page
        UI-->>U: the copy's audience - same tags (tag audience only), all recipients, or only recipients it did not reach (SCR-30)
        opt only recipients it did not reach, while it still sends
            UI-->>U: disabled, available once it has ended
        end
        opt the choice includes not confirmed recipients
            UI-->>U: how many, and that they may have received it
        end
        U->>UI: confirms the choice
        UI->>S: duplicate with the choice, and whether to include not confirmed
    end
    S->>D: guard, then the source broadcast of W
    alt not a broadcast of W
        S-->>UI: not found, no hint
    else only recipients it did not reach, while the source still sends
        S-->>UI: refused, not ended yet
    else may duplicate
        S->>D: insert a new draft - author the member, Copy of the name cut to 80, the same text, version 1
        alt a draft source
            S->>D: copy its tag rows or its group rows
        else same tags
            S->>D: copy the tags the source was launched with as the draft's tag audience
        else all recipients
            S->>D: a group of every recipient's contact
        else only recipients it did not reach
            S->>D: a group of recipients failed as the bot stopped working, text refused or Telegram error, stopped, and not confirmed when asked
            Note over S,D: reads broadcast recipients by (workspace, broadcast, state) and their reason
        end
        Note over S,D: persists broadcasts and broadcast group contacts or audience tags - the composite foreign keys keep every copied contact in W
        S->>B: publish broadcast changed draft for the copy, commit
        S-->>UI: the new draft
        UI-->>U: the copy's draft editor (SCR-25), the original unchanged
    end
    Note over U,S: Postcondition: a new draft of W authored by the member, launched like any draft, and the source is untouched
```

Any member duplicates any broadcast. A draft is copied at once with its text and its audience rows. A launched broadcast asks for the copy's audience first (AC-13). "Same tags" copies the tag audience it was launched with, evaluated again at the copy's launch. "All recipients" makes a group of every recipient, and those who blocked the bot are counted unreachable by the breakdown. "Only recipients it did not reach" is offered once the broadcast has ended, and the server refuses it before then. It copies recipients who failed with a fixable reason (the bot stopped working, Telegram refused the text, a Telegram error), those stopped before their turn (AC-18), and the not confirmed ones only when the member confirmed the warning. Delivered, blocked and deleted-account recipients are never copied. The copy is named "Copy of …" within 80 characters by the shared name rule, its author is the member who duplicated it, and the source does not change. That is how an operator duplicates any broadcast while launching none (AC-07). Every copied contact passes the composite foreign key to the workspace's contacts (AC-08).

### Flow 16: Block marks follow Telegram, and Contacts shows them for the current bot (US-06 — AC-10, AC-14)

```mermaid
sequenceDiagram
    autonumber
    actor C as #lt;user#gt; end customer
    participant X as #lt;external-system#gt;
    participant S as #lt;service#gt;
    participant D as #lt;data-store#gt;
    participant B as #lt;message-bus#gt; live
    participant UI as #lt;ui#gt;
    actor U as #lt;user#gt;
    Note over C,S: Precondition: Olena K. is a contact of W who wrote to W's current Telegram bot
    alt a reply or a broadcast to her is refused as blocked
        S->>X: send to her chat
        X-->>S: refused, bot was blocked by the user
        S->>D: mark her reach row for that Telegram bot blocked at the answer time, if newer than its last fact
    else she blocks or unblocks the bot in Telegram
        C->>X: blocks or unblocks
        X->>S: my chat member update through the webhook - seeded flow 3
        S->>D: blocked or cleared at the update time, if newer than its last fact
    else she writes to the bot again
        C->>X: a message
        X->>S: message update
        S->>D: capture as before, and her reach row for this Telegram bot - wrote at, a block older than the message cleared
        Note over S,D: persists contact bot reach keyed by (workspace, contact, Telegram bot) - wrote at, blocked at, changed at
    end
    S->>B: contact changed reach, commit
    B-->>UI: frame to every tab of W
    UI->>S: refetch the Contacts rows or the profile
    S->>S: ask the bot module for the current Telegram bot id
    S->>D: contacts with blocked since for that bot
    Note over S,D: reads reach rows by (workspace, contact, Telegram bot) for the listed contacts
    S-->>UI: rows and profile with blocked since, or none
    UI-->>U: a marker on her row and blocked since on her profile, or gone
    opt W reconnects the same Telegram bot
        S->>D: reads keep the same bot id - her marks and wrote stay
    end
    opt W connects a different Telegram bot
        S->>D: reads for the new bot id find no row - not blocked, never wrote to the current bot
        UI-->>U: drafts count her apart as never wrote to the current bot, a launch leaves her out
    end
    Note over C,U: Postcondition: no message, conversation, unread or ping came of a block, and no launched recipient list changed
```

A contact's reachability is a row per Telegram bot (ADR-0002). A reply or a broadcast refused as blocked marks it, a `my_chat_member` update blocks or clears it (seeded flow 3), and a new customer message, through the existing capture, records "wrote" and clears an older block. Each fact applies only when it is newer than the last one applied, so out-of-order updates cannot flip the mark back (AC-14). Each write signals `contact.changed` with `change: 'reach'`, and open Contacts rows and profiles refetch. Every read asks `bots` for the current Telegram bot id and shows "blocked the bot since …" for that bot only. Reconnecting the same Telegram bot keeps the marks, and connecting a different one finds no rows, so its contacts count as never wrote to the current bot and are left out at launch (AC-10). A block creates no message, conversation, unread or ping, and no launched recipient list changes (AC-14).

### Flow 17: Existing bots start receiving block notices — the health check re-registers the webhook (US-06 — AC-14)

```mermaid
sequenceDiagram
    autonumber
    participant Q as #lt;message-bus#gt; jobs
    participant S as #lt;service#gt;
    participant X as #lt;external-system#gt;
    participant D as #lt;data-store#gt;
    Note over Q,S: Trigger: the existing scheduled health check of one bot, every 3 minutes
    Q->>S: check the health of bot T of W
    S->>S: check idempotency - one check per bot at a time, as today
    S->>X: who am I, and the webhook's info
    X-->>S: the webhook URL and its allowed updates
    alt the URL is ours and allowed updates lack my chat member
        S->>X: set the webhook again - same URL and secret, message, edited message and my chat member, keep pending updates
        X-->>S: accepted
        S->>D: record the check as today
    else the URL is ours and up to date
        S->>D: record the check as today
    else the URL points elsewhere
        S->>D: taken over, as today - no re-registration
    end
    Note over S,X: retry - none within a check, the next scheduled check 3 minutes later is the retry
    alt the set webhook call fails
        S->>S: log by code, dead-letter - nothing queued, the next check tries again
    end
    Note over Q,D: Postcondition: within minutes of the deploy every live bot of ours receives my chat member updates
```

Bots connected before this feature registered only `message` and `edited_message`. The existing 3-minute health check now compares the webhook's allowed updates with the expected set. When the URL is ours but the set is outdated, it registers the webhook again with the same URL and secret, keeping pending updates (ADR-0003). A webhook taken over by someone else is left alone, as today. A failure is logged by code and the next scheduled check tries again, as the health check already does (no retry, no dead-letter queue). Until then, refused sends still mark blocks (AC-14).

### Flow 18: The broadcast item in the thread, and the customer's answer (US-07 — AC-16)

```mermaid
sequenceDiagram
    autonumber
    actor U as #lt;user#gt;
    participant UI as #lt;ui#gt;
    participant S as #lt;service#gt;
    participant D as #lt;data-store#gt;
    participant B as #lt;message-bus#gt; live
    participant X as #lt;external-system#gt;
    actor C as #lt;user#gt; end customer
    Note over U,S: Precondition: Olena K.'s conversation is closed, unassigned and not waiting, and she was sent A (flow 12)
    S->>D: insert the broadcast item in the outcome transaction - no column of her conversation changes
    Note over S,D: persists broadcast items (workspace, conversation, broadcast, state, position at, Telegram message id) - finds her conversation by (workspace, contact)
    S->>B: conversation changed, item type broadcast, created
    B-->>UI: frame to every tab of W
    alt her conversation is open in this tab
        UI->>S: refetch the new thread item
    else any other tab or view
        UI->>UI: ignore it - the inbox list and the attention count are not refetched
    end
    U->>UI: opens her conversation
    UI->>S: a thread page
    S->>D: messages, replies, activity entries and broadcast items in position order
    Note over S,D: reads broadcast items by (workspace, conversation, position at, id) in the thread's keyset
    S->>D: name, text and launching owner of those broadcasts
    Note over S,D: reads broadcasts by (workspace, id) - the owner's name from member display names, deactivated ones included
    S-->>UI: the thread with broadcast items - delivered at their time, or not confirmed at the send time
    UI-->>U: the broadcast item apart from replies, status, assignee, waiting and unread unchanged, no ping
    opt picks the broadcast name
        UI-->>U: the broadcast page (SCR-28)
    end
    C->>X: answers the broadcast
    X->>S: message update
    S->>D: captured as a customer message as before - reopens, unread, waiting for a reply, ping as usual
    alt failed for another reason, stopped before the turn, or left out at launch
        S->>S: no item exists for that contact
    end
    Note over U,C: Postcondition: the item shows what the customer is answering and moved no conversation state
```

The broadcast item is written by `conversations` in the same transaction as the recipient's outcome, for delivered and not confirmed sends only (ADR-0010). It finds the contact's conversation and changes none of its columns: status, assignee, state version, waiting, last activity and read marks stay (AC-16). Its `conversation.changed` frame carries the item type `broadcast`. Only a tab with that conversation open refetches. The inbox list and the attention count ignore it. The thread read returns broadcast items in the same keyset order as messages, replies and activity entries. `inbox` adds each broadcast's name, text and launching owner from `broadcasts`, and names a deactivated owner too. A not confirmed item is marked and sits at the time of the send. The item links to the broadcast page. The customer's answer is captured as an ordinary message and reopens the conversation, counts as unread and waiting, and pings as usual. A recipient who failed for another reason, was stopped, or was left out has no item.

### Flow 19: Replies keep going while broadcasts send, and a rate limit pauses only broadcasts (US-07 — AC-15)

```mermaid
sequenceDiagram
    autonumber
    actor U as #lt;user#gt;
    participant UI as #lt;ui#gt;
    participant S as #lt;service#gt;
    participant D as #lt;data-store#gt;
    participant X as #lt;external-system#gt;
    Note over U,S: Precondition: W's broadcasts A and B are sending through its bot, and an operator answers a customer
    U->>UI: sends a reply
    UI->>S: reply
    S->>D: store the reply and queue its delivery, as before
    S->>X: send the reply now - no broadcast pacer, no wait for the send pause
    X-->>S: accepted
    S-->>UI: delivered as fast as on a quiet day
    loop while A and B send
        S->>S: next recipient alternates between A and B, oldest launch first
        S->>S: a pacer slot - at most 25 per second for all of the bot's broadcasts
        S->>X: a broadcast send - flow 12
    end
    alt Telegram rate-limits any send of the bot - a reply, a ping or a broadcast
        X-->>S: rate limited, retry after N seconds
        S->>D: store the bot's send pause until now plus N
        Note over S,D: persists the bot's send pause, as today
        S->>S: broadcast sends refuse while paused, the claimed recipient goes back to waiting, the link queues its successor at the pause end
        S->>S: the reply backs off as today and never waits for the pause
        S->>S: after the pause the next waiting recipient is sent - none skipped or doubled
    end
    opt another workspace V sends replies, pings or broadcasts
        S->>S: V has its own link, bot, pacer and pause - nothing of V waits for W
    end
    Note over U,X: Postcondition: replies kept their latency, broadcasts stayed at or under 25 per second per bot, and every recipient is sent at most once
```

Replies keep their own path: `sendText` neither takes the broadcast pacer nor waits for the send pause (ADR-0008), so a reply during a broadcast goes out as on a quiet day (AC-15). Broadcast sends of the bot take 40 ms start slots of one per-bot pacer, so all its broadcasts together stay at or under 25 per second. Two sending broadcasts of the workspace alternate, so neither waits for the other to finish. A rate-limit answer to any send of the bot stores the bot's send pause. Broadcast sends then refuse without calling Telegram, the claimed recipient goes back to waiting and the link queues its successor at the pause end. After the pause the broadcasts continue with the next waiting recipient, skipping and doubling no one. The reply that met the rate limit backs off as replies do today. Each workspace has its own link, bot, pacer and pause, so one workspace's broadcast never slows another's replies, pings or broadcasts.

**Coverage — every spec §4 user story and §5 acceptance criterion → where §6 shows it:**

| Spec item | Shown by |
|---|---|
| US-01 | Flow 5, flow 6, flow 7, flow 9 |
| US-02 | Flow 8, flow 7 (switching the audience kind) |
| US-03 | Seeded flow 1, flow 10 |
| US-04 | Flow 11, seeded flow 2, seeded flow 4, flow 12, flow 13, flow 14 |
| US-05 | Flow 15 |
| US-06 | Seeded flow 3, flow 16, flow 17 |
| US-07 | Flow 18, flow 19, flow 14 (turns between broadcasts) |
| US-08 | Flow 12 (one plain-text message, at most once) |
| AC-01 | Flow 5: the list for every member with status, audience size and who last changed it. Flow 6: the draft saved with its text, nothing sent. Flow 7: the breakdown with the Contacts filter's rules, left-out tags, a renamed tag kept, a deleted or merged tag dropped with a notice, the count as it is now on reopening |
| AC-02 | Flow 6: name 1–80 and text 1–4096 UTF-16 code units after trimming, checked in the browser and again on the server, the last valid content kept, the remaining length shown |
| AC-03 | Flow 6: a stale field save refused with the current draft and the member's own edit kept. Flow 8: group adds and removes commute and never raise the version. Flow 7: a kind switch confirmed against the group size |
| AC-04 | Flow 8: the Contacts list read for search and filter, add one, add all matching with the count first and the current matches on confirmation, removal from this draft only, the group page with name, username, tags and blocked marker, its size and reach |
| AC-05 | Flow 8: already in the group, a bulk add over 10 000 refused as a whole with the room left. Flow 7: a tag audience over 10 000 saved but not launchable. Flow 10: launch refused over 10 000. Flow 8: the composite key keeps the group in its workspace |
| AC-06 | Flow 10: the confirmation's text, count, left-out reasons and warning, the version and fingerprint, a changed set refused to confirm again, a double click or two owners launching once. Seeded flow 1: the launch transaction |
| AC-07 | Flow 10: no launch action for an operator, a confirmation address lands on the draft, a launch request refused. Flow 9: delete only by the author or a business owner. Flow 15: an operator still duplicates. Flow 6: an operator edits |
| AC-08 | Flow 5: the guard (sign in, not found with no hint, access removed). Flow 8: a contact of another workspace refused, the composite key. Flow 10: an owner deactivated on the confirmation launches nothing. Flow 12: the send is scoped by the workspace and its bot. Flow 15: copies stay in the workspace. Flows 6, 9 and 11: a foreign broadcast id is not found |
| AC-09 | Flow 6, flow 9 and flow 11: a launched broadcast refuses every edit and the delete, read-only with Duplicate. Flow 10: nobody reachable and the 11th launch within 24 h refused with the next launch time, every confirmed launch counted. Seeded flow 1 and flow 16: the recipient list never changes after launch |
| AC-10 | Flow 10: no bot or a bot not working refused with the way to the bot settings. Flow 7: never wrote to the current bot counted apart, the no-bot case. Flow 16: the same Telegram bot keeps its marks, a different one starts clean. Flow 6: drafts need no bot |
| AC-11 | Flow 11: the report with totals and outcomes, live. Flow 12: blocked at the turn, unblocked sent, other refusals failed without retry, no answer not confirmed. Flow 13: sent with its finish time. Flow 14: a restart resumes with waiting recipients and a stale in-flight send ends not confirmed. Seeded flow 2 |
| AC-12 | Flow 12: a refused text or a lost bot aborts. Flow 13: every waiting recipient failed with the plain reason, the broadcast sent, nothing sent later by a working or new bot |
| AC-13 | Flow 15: Copy of within 80, the same text, the member as author, the original unchanged, a draft's group copied, all recipients, only recipients it did not reach once ended with the fixable reasons and the not confirmed warning, the same tags evaluated again |
| AC-14 | Seeded flow 3: my chat member blocks and unblocks without a message. Flow 16: refused sends, writing again, newer facts only, the Contacts marker and profile line. Flow 17: existing webhooks re-registered. Flow 12: the mark decides at the turn. Flow 7 and flow 8: drafts count blocked contacts as unreachable |
| AC-15 | Flow 19: replies never wait, 25 per second per bot for all broadcasts, turns, the send pause after any rate limit, no skipping or doubling, other workspaces untouched. Flow 14: turns between broadcasts in a link. Seeded flow 2 |
| AC-16 | Flow 18: the item in the thread with text, name and launching owner, not confirmed at the send time, no state change, the answer captured as usual, no item for other outcomes. Flow 12 and flow 14: items written with the outcome, also for stale in-flight sends |
| AC-17 | Flow 12: one plain-text message with the trimmed text, no formatting, nothing about other recipients |
| AC-18 | Seeded flow 4: the stop settles waiting recipients under the row lock, a late stop changes nothing. Flow 12: a settled recipient is never claimed, sends in flight finish. Flow 11: no stop for operators. Flow 15: stopped recipients copied by "did not reach" |

**Flagged by `sequences` (for `design` / `data-model` / `api` to reconcile, no ADR written):**

- **No new participants.** Every flow stays within §5's containers. `<message-bus>` is both pg-boss (jobs) and `platform/realtime` (live signals through `LISTEN/NOTIFY` and the inbox hub). `<external-system>` is the Telegram Bot API. The seeded flows 1–4 keep their concrete participant names from `design`, and flows 5–19 use the generic vocabulary.
- **The launch confirmation read is also the pre-check (flow 10).** `api` gives it one route that answers either the confirmation or one of the launch refusals, with the same codes as the launch itself.
- **Two reads `api` needs that §5 does not list:** the group picker's "which of these contacts are in the group" (ids of one page, flow 8) and the group page (50 contacts, newest added first, with the breakdown, flow 8).
- **Frozen breakdown on the broadcast (flows 5, 10).** The launch stores the confirmed audience size, blocked, never wrote and recipient counts on the broadcast row, so the list and the page never recount a launched audience. `data-model` adds the columns.
- **Recipient position (flows 10, 11, 14).** Recipients get a position at launch in fingerprint order. It drives the sending order and the report's keyset. `data-model` adds it.
- **The no-bot breakdown (flow 7).** With no bot row, a draft shows only the audience size. `screens` draws the line.
- **Indexes for `data-model`** (from the persist and read notes):
  - `broadcasts` by `(workspace_id, updated_at DESC, id DESC)` for the list (flow 5); by `(workspace_id, launched_at)` where launched, for the 24-hour cap (flow 10, seeded flow 1); by `(workspace_id, status)` where `sending`, for the link's broadcasts (flow 14); unique `(workspace_id, id)` as the composite FK target;
  - `broadcast_audience_tags` keyed by `(workspace_id, broadcast_id, tag_id)` (flows 7, 9, 15);
  - `broadcast_group_contacts` keyed by `(workspace_id, broadcast_id, contact_id)` (flow 8 add, remove, membership of a page, count), by `(workspace_id, broadcast_id, added_at DESC, contact_id)` for the group page (flow 8), and by `(workspace_id, contact_id)` for the contacts foreign key;
  - `broadcast_recipients` unique `(workspace_id, broadcast_id, contact_id)`, by `(workspace_id, broadcast_id, position)` for the report (flow 11), by `(workspace_id, broadcast_id, state, position)` for totals, the next waiting recipient, stale in-flight, settling and the duplicate (flows 11–15), and by `(workspace_id, contact_id)` for the contacts foreign key;
  - `contact_bot_reach` keyed by `(workspace_id, contact_id, telegram_bot_id)` (flows 7, 8, 12, 16);
  - `broadcast_items` unique `(workspace_id, broadcast_id, conversation_id)` (one item per broadcast and conversation), by `(workspace_id, conversation_id, position_at, id)` for the thread keyset (flow 18); the conversation is found by the existing `(workspace_id, contact_id)` key of `conversations`.

## 7. Deployment view

No new deployable. The one API process keeps serving HTTP, webhooks, the live sockets and every pg-boss worker (architecture map, "One process"). broadcasts adds three queues, created and registered by `buildApp()`:

| Queue | Policy | Payload | Notes |
|---|---|---|---|
| `broadcasts.send` | `stately`, `singletonKey` = workspace id, retry limit 3 with back-off, expire 60 s | workspace id | one link ≤ 20 s; enqueued by launch and by each link while a broadcast of the workspace sends (ADR-0007); worker concurrency per instance: 16 links |
| `broadcasts.send-dlq` | dead letter of `broadcasts.send` | workspace id | logs an error, enqueues a fresh `broadcasts.send` link 60 s later |
| `broadcasts.measure-blocked-share` | `singletonKey` = broadcast id, retry limit 2 | workspace id, broadcast id | enqueued when a broadcast ends, `startAfter` 48 h; logs the blocked share (spec §7) |

No new environment variable: pace, window, link length and coalescing are constants in `broadcasts/domain` (§1 assumptions). Rollout: the migration (reach table + backfill, broadcasts tables, broadcast items) runs before the new code; after the deploy, each bot's next health check (≤ 3 min) re-registers its webhook with `my_chat_member` (ADR-0003).

**Monitoring:**
- Metrics (structured logs, no text, no names, no chat ids): per broadcast — launch (recipients, unreachable split), outcome counts by state and reason at finish, launch-to-finish duration; per link — sends, sends per second, in-flight peak, time paused, stale in-flight resolved; per bot — `429` answers by sender (reply / ping / broadcast); blocked share 48 h after a broadcast (spec §7).
- Alerts: any `broadcasts.send-dlq` job; a broadcast `sending` with no outcome recorded for 5 minutes outside a send pause; a stale in-flight resolution (a link died mid-send); blocked share > 5 % (spec §7, team monitoring only); reply p95 in the hour after a launch more than 1 s above the 30-day baseline (spec §7 "Support unaffected").
- Tracing: none in the repo; the launch and each link log one line with workspace id, broadcast id(s) and counts.

**Scaling thresholds:**
- Recipient rows grow by at most 10 launches × 10 000 = 100 000 per workspace per day. One table with an index by (workspace, broadcast, state) is comfortable to tens of millions of rows; above ~50 M, partition `broadcast_recipients` by launch month.
- Sixteen links per instance means up to sixteen workspaces send at full pace at once per instance (≤ 400 Telegram calls per second, mostly waiting on the network), more than every pilot workspace broadcasting at the same moment. A seventeenth sending workspace would wait for a free slot at a link boundary (≤ 20 s), which AC-15 forbids; the alert on a `broadcasts.send` job waiting more than 20 s marks the point to raise the concurrency or move the worker to its own process (the map's planned split), with no module change (§11).
- Database connections: each claim and outcome transaction is short and holds no connection across the Telegram call; sixteen links hold a connection only inside those short transactions.

## 8. Crosscutting concepts

Repo defaults are kept (CLAUDE.md, architecture map §Conventions). Feature-specific rows below.

| Concept | Convention | Where defined |
|---|---|---|
| Logging | pino structured logs. Never the broadcast text, contact names, usernames, chat ids or the token; ids, counts, states and reasons only. The group picker's search text is masked in request logs, like the Contacts search | CLAUDE.md, contacts SAD §8, here |
| Authentication / authorization | session + workspace membership guard on every route. Roles: any active member lists, reads, creates, edits, duplicates, adds to / removes from groups; the draft author or a business owner deletes a draft; only a business owner launches and stops, re-checked under `workspaces.lockActiveMembers` (`FOR SHARE`) inside the action's transaction. Foreign ids answer 404 (`NotFoundError`) with no hint | workspaces guard; ADR-0006, ADR-0009 |
| Tenancy | every new table has a non-null `workspace_id` and composite foreign keys `(workspace_id, …)` to `contacts`, `memberships`, `broadcasts` and `conversations`; every repository method takes `workspaceId`; each repository has a cross-workspace isolation test. The sender job carries its workspace id; `sendBroadcastMessage` takes the workspace id and the expected Telegram bot id. **No new tenancy exception** (the six stay six) | CLAUDE.md; ADR-0007 |
| Error handling | `AppError` subclasses, codes in `packages/shared/src/errors.ts`: `BROADCAST_DRAFT_CHANGED` (409, current draft), `BROADCAST_GROUP_CHANGED` (409, current group size, on a kind switch), `BROADCAST_NOT_A_DRAFT` (409, launched: read-only), `BROADCAST_AUDIENCE_CHANGED` (409, current breakdown + fingerprint), `BROADCAST_AUDIENCE_TOO_LARGE` (409, limit + how many can still be added), `BROADCAST_NO_REACHABLE_CONTACT` (409), `BROADCAST_NEEDS_WORKING_BOT` (409, bot state), `BROADCAST_LAUNCH_LIMIT_REACHED` (429, `next_launch_at`), `BROADCAST_NAME_INVALID` / `BROADCAST_TEXT_INVALID` (400), `BROADCAST_NOT_ENDED` (409, duplicate "only recipients it did not reach" of a broadcast still sending — api flag F-2). An operator's launch confirmation, launch or stop → `403 OWNER_ONLY` (the existing `ForbiddenError` subclass, before any lookup, as the contract fixed it); a member's delete of a teammate's draft → `403 FORBIDDEN` | here; `api` fixes names |
| ID strategy | UUIDv7 from `newId()` for broadcasts, recipients, group rows, broadcast items, reach rows; Telegram user, bot and message ids as `bigint` | CLAUDE.md |
| Lock order | **Launch:** memberships `FOR SHARE` → advisory `broadcast-launches:<ws>` → broadcast row `FOR NO KEY UPDATE` → (contacts reads, no locks) → recipient inserts → job insert. **Stop / delete by an owner:** memberships `FOR SHARE` → broadcast row. **Draft and group writes, abort, finish:** broadcast row `FOR NO KEY UPDATE` → its tag / group / recipient rows. **Claim:** one recipient row (conditional update). **Outcome:** recipient row → broadcast item insert (foreign-key `KEY SHARE` on the conversation and broadcast rows, compatible with `NO KEY UPDATE`) → signal. Reach writes lock only their reach row (capture: after the contact upsert, as today). No path takes a broadcast row after a recipient row with an incompatible mode, and none takes a membership after a broadcast row, so these cannot deadlock with each other, with deactivation (workspace row → membership → conversations) or with the tag locks (contacts ADR-0004) | ADR-0005, ADR-0006, ADR-0009, here |
| Events / live signals | `broadcast.changed { workspace_id, broadcast_id, change }` (new, every socket of the workspace; report changes coalesced to ≤ 1 per second per broadcast); `contact.changed` gains `change: 'reach'`; `conversation.changed` gains item type `broadcast` (`created` only). All published inside the writing transaction, ids only | ADR-0011 |
| Async jobs | `broadcasts.send` (+ DLQ) and `broadcasts.measure-blocked-share`, payloads ids only; workers in `modules/broadcasts/infra/jobs.ts` | §7, ADR-0007 |
| Rate limiting | Launch cap 10 per workspace per rolling 24 h (advisory lock + count). Pace 25 per second per bot for broadcasts (pacer in `bots`), the bot's send pause respected. Group size 10 000. No per-member limit on draft edits (versioned saves are cheap; the limit the spec asks for is on launches) | ADR-0006, ADR-0008 |
| Text and names | one shared rule in `packages/shared/src/broadcast-text.ts`: text trimmed at both ends, 1–4096 UTF-16 code units; name 1–80 characters as a person sees them. Sent with no `parse_mode` (plain text, AC-17), link previews at Telegram's default. Shown as plain text everywhere | ADR-0012 |
| Integrity run book | `apps/api/src/e2e/helpers.ts` gains `broadcastIntegrity.*`: recipients with more than one broadcast item; recipients still `sending` with no active link; launched broadcasts whose recipients were created after `launched_at`; recipients or group rows whose contact belongs to another workspace; more than 10 launches in any 24 h per workspace; delivered or not confirmed recipients without a broadcast item | here |
| Internationalisation | none: the panel is English, the broadcast text is the business's own | — |
| Configuration | no new env var | §7 |

## 9. Architecture decisions

| # | Title | Status | Section |
|---|---|---|---|
| 0001 | Add a broadcasts module that owns drafts, groups and recipients and reaches other modules through their app layers | Accepted | §4, §5 |
| 0002 | Keep per-bot reachability of contacts in contacts, keyed by the Telegram bot id | Accepted | §4 |
| 0003 | Learn blocks from my_chat_member updates and refused sends in bots, and re-register outdated webhooks in the health check | Accepted | §4 |
| 0004 | Evaluate audiences in contacts with the Contacts filter rules and return the breakdown and the reachable set | Accepted | §4 |
| 0005 | Version draft fields and keep the group as per-contact rows outside the version | Accepted | §4 |
| 0006 | Launch against the shown version and an audience fingerprint under a per-workspace launch lock | Accepted | §4 |
| 0007 | Send through a per-workspace pg-boss chain that claims each recipient before its send | Accepted | §4, §7 |
| 0008 | Pace broadcasts at 25 per second per bot in turns and wait for the send pause | Accepted | §4 |
| 0009 | End, stop or abort a broadcast by settling every waiting recipient in one transaction | Accepted | §4 |
| 0010 | Store broadcast items as a conversations thread entry that never touches conversation state | Accepted | §4 |
| 0011 | Push broadcast changes as id-only signals coalesced to once per second, and page the report | Accepted | §4, §8 |
| 0012 | Count broadcast text in UTF-16 code units after trimming, with one shared rule | Accepted | §4, §8 |

ADR files live under `docs/features/broadcasts/adr/NNNN-<title>.md`.

## 10. Quality requirements

**QG-1. Support first — pace, reply latency, isolation**
- **When:** a workspace launches a 10 000-recipient broadcast while its operators send replies, and another workspace keeps answering its own customers.
- **Then:** broadcast pace per bot "≤ 25 messages per second for all of a bot's broadcasts together, over any 1 s window"; reply latency during a broadcast "p95 reply send → Telegram accepted ≤ 2 s while a 10 000-recipient broadcast is sending"; cross-workspace isolation "p95 reply and ping latency of other workspaces unchanged (± 1 s) while one workspace sends 10 000"; on a `429` to any send of the bot, broadcasts send nothing until the pause ends (AC-15).
- **How verify:** integration test against the fake Telegram counting `sendMessage` per bot per sliding 1 s window with two broadcasts sending together (AC-15 turns); an interleaved test sending replies during a seeded 10 000-recipient broadcast and asserting reply accept time p95; a scripted `429` from a reply, then asserting no broadcast send before `retry_after`; reply and ping timing logs compared per workspace in staging.

**QG-2. Completion**
- **When:** a broadcast sends alone with no rate-limit answers.
- **Then:** "1 000 recipients, no rate-limit answers → every recipient has an outcome within 90 s of launch; 10 000 within 10 minutes".
- **How verify:** seeded integration test with 1 000 recipients against the fake Telegram with a realistic answer delay (150 ms), asserting launch-to-finish ≤ 90 s; the launch-to-finish timing log in staging for 10 000.

**QG-3. Exactly what was confirmed, at most once**
- **When:** a launch is confirmed twice at once, the process is killed mid-send, a send gets no answer, or members try every edit path on a launched broadcast.
- **Then:** at most once per recipient "0 recipients sent the same broadcast twice, including after a restart mid-send or a double launch"; frozen recipients "0 changes to a launched broadcast's text or recipient list"; the recipient list equals the set the confirmation fingerprinted (AC-06).
- **How verify:** integration tests: two concurrent launches (one launched, one returned); kill a link between claim and outcome, then run the next link (the recipient ends not confirmed, the fake records one send); a fake send that never answers (not confirmed, never resent); each edit route on a launched broadcast → `BROADCAST_NOT_A_DRAFT`; a retag between confirmation and launch → `BROADCAST_AUDIENCE_CHANGED`; the `broadcastIntegrity` run-book queries.

**QG-4. Stop and launch cap**
- **When:** an owner stops a broadcast mid-send; an owner launches an 11th broadcast within 24 h.
- **Then:** stop takes effect "0 sends of a broadcast started more than 2 s after its stop was confirmed"; launch cap "≤ 10 launches per workspace per rolling 24 h".
- **How verify:** integration test stopping mid-send against the fake Telegram and comparing every send's start time with the stop's commit time; integration test where the 11th launch is refused with `next_launch_at`, including a stopped broadcast among the 10.

**QG-5. Responsive drafts and launch**
- **When:** a draft is opened or changed, or launched, in a workspace with 10 000 contacts.
- **Then:** draft audience count "≤ 500 ms server time (as the Contacts list, contacts §6)" p95 for a tag audience or a group; launch "≤ 2 s server time from confirm to "sending"" p95 when freezing 10 000 recipients.
- **How verify:** seeded integration tests timing the draft read (tag audience and a 10 000-contact group) and the launch; the request timing log.

**QG-6. Honest, live report and fresh reachability**
- **When:** outcomes are recorded while a report is open; a customer blocks or unblocks the bot.
- **Then:** report live update "≤ 3 s (as shared-inbox §6)" p95 from outcome recorded to shown; blocked state freshness "≤ 5 s" p95 from Telegram's notice to the contact marked or unmarked; availability "99.5 % monthly (as shared-inbox §6)".
- **How verify:** server-side timing from the outcome transaction to the `broadcast.changed` push (coalescing ≤ 1 s + refetch); integration test posting a `my_chat_member` update to the webhook with the fake Telegram and timing the reach row and the `contact.changed` signal; the uptime check on `/health`.

## 11. Risks and technical debt

| Risk / debt | Severity | Mitigation | Owner |
|---|---|---|---|
| A broadcast to a cold or broad audience draws spam reports and Telegram restricts the shared bot, stopping support (spec §1, §6.1) | High | owner-only launch with the warning (AC-06), 10 launches per 24 h, 25 per second with pause on `429`, stop (AC-18), blocked-share alert; spec OQ-1 (limit audiences to recent or opted-in contacts) | Dmytro Hopko — OQ-1 due after the first 30 days of pilot broadcasts, or earlier if the §7 alert fires |
| Broadcasts (25 per second) plus pings (up to 10) plus replies can exceed Telegram's ~30 per second in a busy second; replies then meet a `429` | Medium | pings are rare in practice; the first `429` pauses broadcasts and pings, replies back off as today; the §7 "Support unaffected" KPI and the per-sender `429` metric show it | Backend |
| Telegram's length count is assumed to be UTF-16 code units (ADR-0012); a mismatch would let the editor accept a text Telegram refuses | Medium | verify against the real Bot API during `implement` (4096 emoji-heavy text); a refused text aborts the broadcast cleanly (ADR-0009) and the owner fixes it through a duplicate | Backend |
| Telling a refused text from a refused chat relies on Telegram's `400` description; an unknown `400` aborts the whole broadcast | Medium | classify "chat not found" / "user not found" / "PEER_ID_INVALID" as recipient-level; log the code and a description class (never the text); review the class list with pilot data | Backend |
| Reach backfill treats every existing contact as having written to the current Telegram bot; a workspace that changed bots before this feature has contacts who in fact never wrote to the new one | Low | they fail with "chat not found" (not copied by "did not reach"); pilots have not changed bots; the backfill is logged per workspace | Backend |
| Until a bot's next health check after the deploy (≤ 3 min), its webhook does not deliver `my_chat_member` | Low | refused sends still mark blocks; the window is minutes, once | Backend |
| A link that stalls longer than the 60 s expire (event loop blocked) could overlap its successor | Low | claims still prevent any double send; the overlap only risks the pace for a moment; link ≤ 20 s + send timeout 10 s; alert on stale in-flight resolutions | Backend |
| More sending workspaces than the per-instance link concurrency (16) would make one workspace's broadcast wait for another's link to end (≤ 20 s), against AC-15's "never slows another workspace" | Low | 16 exceeds the pilot count; alert on a `broadcasts.send` job waiting more than 20 s; raise the concurrency or split the worker (§7) | Backend |
| One `conversation.changed` frame per recipient (25 per second per sending workspace) reaches every tab of the workspace | Low | frames are tiny; inbox and attention stores ignore broadcast items unless the thread is open | Frontend |
| Spec OQ-3: answers to a broadcast count for pings and reopen conversations like any message, which may flood the inbox after a large broadcast | Medium | measured with pilot data; capture is unchanged, so grouping later is a `conversations` / `notifications` change | Dmytro Hopko — due after the first 30 days of pilot broadcasts |
| Spec OQ-4: no in-product contact removal; recipients, group rows and broadcast items now reference contacts by foreign key, so a hand erasure must delete them first | Medium | the run book's erasure procedure lists the new tables in order; an in-product deletion is designed with OQ-4 | Dmytro Hopko — due before roadmap step 8 ships |

**Accepted debt (acceptable in v1, plan to fix later):**
- No retry of a recipient after a non-rate-limit failure, and no automatic resend of not confirmed sends: a duplicate is the retry (spec).
- Reach rows of a previous Telegram bot are kept and never pruned.
- The report coalescing clock and the pacer are in memory, correct because one link per workspace is active (ADR-0007, ADR-0008).
- The draft breakdown is recomputed on every read, not cached.
- Scheduling, media, formatting and placeholders are out of scope (spec §3).

## 12. Glossary

| Term | Meaning |
|---|---|
| Audience | (CONTEXT) who a draft is meant for: a tag audience or a broadcast group |
| Tag audience | (CONTEXT) chosen tags with the Tag filter's match mode plus tags to leave out, evaluated whenever the draft is shown and again at launch |
| Broadcast group | (CONTEXT) the hand-picked contacts of one draft, stored as rows outside the draft's version |
| Broadcast | (CONTEXT) one plain-text message the business bot sends on a business owner's launch to every recipient: draft → sending → sent, or stopped |
| Launch | (CONTEXT) the owner's confirmed decision that freezes the recipient list and starts sending; at most once per broadcast, at most 10 per workspace per 24 h |
| Recipient list | (CONTEXT) the contacts fixed at launch from the audience minus unreachable contacts; never changed afterwards |
| Unreachable contact | (CONTEXT) an audience contact that blocked the current bot or never wrote to it |
| Blocked the bot | (CONTEXT) a contact's state for one Telegram bot, learned from `my_chat_member` or a refused send |
| Current bot | (CONTEXT) the Telegram bot connected now, identified by its Telegram bot id |
| Delivery report | (CONTEXT) each recipient's outcome and the totals, live while sending |
| Broadcast item | (CONTEXT) the broadcast as shown in one recipient's thread; never changes conversation state |
| Draft author | (CONTEXT) the member who created a draft, by creating or duplicating; besides owners, the only one who may delete it |
| Duplicate | (CONTEXT) a new draft from any broadcast, with the same text and a copied audience |
| Not confirmed | (CONTEXT) a send that got no answer; never sent again |
| Send pause | (CONTEXT) the bot's stored time until which Telegram asked to stop; broadcasts wait for it, replies never do |
| Count breakdown | (CONTEXT) audience size, blocked, never wrote to the current bot, would reach; recomputed for a draft and the confirmation, frozen at launch |
| Audience fingerprint | the SHA-256 over the sorted ids of the reachable contacts the confirmation showed; the launch compares it with the set it would freeze (ADR-0006). *Technical — kept in the SAD, not in CONTEXT (glossary 2026-10-23)* |
| Sending link | one run (≤ 20 s) of the per-workspace `broadcasts.send` chain; exactly one is active per workspace (ADR-0007). *Technical — kept in the SAD, not in CONTEXT (glossary 2026-10-23)* |
| Claim | the committed `waiting → sending` update of one recipient right before its send; what makes a send at most once (ADR-0007). *Technical — kept in the SAD, not in CONTEXT (glossary 2026-10-23)* |
| Reach row | per contact and Telegram bot: wrote through it, blocked since, newest fact time (ADR-0002). *Technical — kept in the SAD, not in CONTEXT (glossary 2026-10-23)* |
| Recipient position | a recipient's rank (1…n) in the fingerprint's contact-id order; the send order and the report's keyset (data-model). *Technical — kept in the SAD, not in CONTEXT (glossary 2026-10-23)* |
