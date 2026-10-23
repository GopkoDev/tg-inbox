---
id: T21
title: "Add the API end-to-end notification stories, the integrity checks, the reply-under-ping-load test, and the secrecy assertions for pings, answers, logs and frames"
layer: "tests"
deps: ["T14", "T15", "T17", "T19", "T20"]
blocks: ["T29"]
acs: ["AC-04", "AC-05", "AC-06", "AC-10", "AC-11", "AC-12"]
files_hint: ["apps/api/src/e2e/notification-flows.int.test.ts", "apps/api/src/e2e/notification-load.int.test.ts", "apps/api/src/e2e/helpers.ts", "apps/api/src/modules/bots/http/secrecy.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T21 — Add the API end-to-end notification stories, the integrity checks, the reply-under-ping-load test, and the secrecy assertions for pings, answers, logs and frames

## Place in the sequence

- **Blocked by:** T14 — Teach the inbox hub to read presence frames and report socket lifecycle to notifications, and deliver telegram_link.changed only to that account's sockets, T15 — Add the notifications.send-bot-message worker: readiness and pause, the answer text from the kind, outcomes, retries and the dead letter, and clearing a removed link's Telegram id, T17 — Wire the ping jobs: the notifications.send-pings chain per workspace, the notifications.schedule-pings cron over the sixth tenancy exception, and the QG-1 scenario tests, T19 — Serve the notifications routes (settings, connect link, disconnect) and GET inbox/attention behind the workspace guard, and register the notifications module, T20 — Add telegram_pings to Membership on the Team reads and the deactivate / reactivate answers through a notifications port that team takes · **Blocks:** T29 — Add browser end-to-end notification flows against the real API and the fake Bot API · **Wave:** 6 — after T14, T15, T17, T19, T20.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
> **So that** the bot can ping me when I am away, and only after I chose so
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** the business bot to ping me in Telegram when a customer of mine, or an unassigned one, has waited 5 minutes and I am away from the web
> **So that** no customer waits because I closed my laptop
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As an** End customer
> **I want** the business's conversation list to hold only real customers
> **So that** the team's attention and replies go to me, not to their own colleagues' notification chats
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It proves the whole loop for real — connect, ping, block, deactivate, intercept — and that nothing private leaks on the way.

## Inlined context

> - pings whose recipient's membership was not active at `created_at`;
> - two pings to one member and workspace less than 10 minutes apart;
> - contacts whose Telegram id equals a live link's Telegram user id in the same workspace (spec §6 "Captured link messages"; an ops join across modules, not a repository read);
> - live links whose Telegram bot id differs from the workspace's current bot.
>
> — `sad.md §7, Integrity checks, verbatim` · full text: [sad.md](../sad.md)

> - A link removed by its member that still holds `telegram_user_id` more than 1 hour after `removed_at`. This catches a dead-lettered notifications-off job, and an ops task clears the id.
> - Open conversations that are waiting by the shared-inbox marker but have `waiting_since IS NULL`. This catches a write path that forgot the period.
>
> — `_audit/data-model-2026-10-19.md §New integrity queries, run book, verbatim` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

> - Tracing: the Fastify request id is in every request log line, and job logs carry the workspace id, the member's account id, the ping id and the outcome code. Nothing logs a token, a Telegram display name, ping text or message text. The Telegram user id is logged only as part of the redeem outcome, at debug level.
>
> — `sad.md §7, Tracing, verbatim` · full text: [sad.md](../sad.md)

> - **F-3 · Telegram user id in `notifications.send-bot-message` payloads** for `link_expired` / `cannot_connect`, and in the DLQ — carried over from data-model assumption 3 and sad.md §6 flags. **Accepted pending security review** (spec §6.1 marks review as required).
>
> — `contracts/api-sync-report.md §C. Flags, F-3, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> | Reply delivery under ping load | reply send p95 ≤ 2 s, the shared-inbox target, with 50 pings due at once on one bot | load test against the fake Bot API |
>
> — `spec.md §6, Reply delivery under ping load, verbatim` · full text: [spec.md](../spec.md)

> | Captured link messages | 0 contacts or conversations created from connect-link starts or linked members' messages | integration test; run-book query: contacts whose Telegram id equals a linked member's in the same workspace |
>
> — `spec.md §6, Captured link messages, verbatim` · full text: [spec.md](../spec.md)

> - **Telegram:** all Bot API calls go through `telegramApi(token, { apiRoot })` in `src/platform/telegram.ts` (via the `bots` gateway). Each bot's webhook is `POST /api/telegram/webhook/:botId`, authenticated by `X-Telegram-Bot-Api-Secret-Token` (a per-bot derived secret, only its hash stored, checked before the body is parsed; the header is redacted from logs). Bot tokens are secrets — encrypted at rest, never logged, never returned. Tests use the fake Bot API in `src/test/fake-telegram.ts` (scriptable `sendMessage`, `getFile`, file download). Replies go out only via `deps.bots.sendText`, customer media streams via `deps.bots.openMedia` — the token never leaves `bots`.
>
> — `CLAUDE.md §Rules, Telegram, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Exercises `createConnectLink`, `getNotificationSettings`, `disconnectTelegram`, `getAttentionCount`, `listMemberships`, `deactivateMembership`, `openLiveSocket` (presence + `telegram_link.changed`), bot-connection's `receiveTelegramUpdate` with recorded `/start tgi_…` and member updates, and the `notifications.*` jobs against the fake Bot API.

## Acceptance criteria

### AC-04 — happy path

> **Given** an active operator of "Acme Flowers", whose bot is connected, with no Telegram link
> **When** they choose "Connect Telegram" in the panel, open the link it shows on their phone and press Start in the chat with the "Acme Flowers" bot within 10 minutes
> **Then** the bot answers in that chat that it will notify them about waiting customers of "Acme Flowers", and how to stop: disconnect in the panel. The panel shows "Connected" with their Telegram name and since when, without reloading. Starting the bot through this link creates no contact and no conversation and shows nothing in the inbox. Choosing "Disconnect" removes the link at once: the bot sends no further pings and tells them in the chat that notifications are off.
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — error

> **Given** a member who opens a connect link
> **When** the link is older than 10 minutes, was already used, was replaced by a newer link, or belongs to a member who has since been deactivated
> **Then** nothing is linked. The bot answers that the link has expired and that a new one is in the panel. The panel of the member who asked for it still shows "Not connected". The attempt creates no contact and no conversation.
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — domain invariant

> **Given** an operator of "Acme Flowers" who is already connected, or a Telegram account that is already connected to another member of "Acme Flowers"
> **When** they open a new connect link in a different Telegram account, or a teammate opens their own connect link from that same Telegram account
> **Then** nothing changes. A member has at most one Telegram link per workspace, and a Telegram account is linked to at most one member of a workspace. The bot answers that this Telegram account cannot be connected and why ("already receives notifications for another member of Acme Flowers" / "you are already connected from another Telegram account — disconnect it in the panel first"). An existing link is never replaced silently. A connected member who opens a new connect link from the Telegram account they are already connected with is told "you are already connected", and the link is used up. While a member is connected, the panel offers "Disconnect" and no connect link. Connecting another Telegram account means disconnecting first.
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — cross-context

> **Given** a conversation of "Acme Flowers" whose ping is due
> **When** at that moment the conversation is closed, a reply was marked sent, the recipient's membership is no longer active, the bot is "not connected" or "not working", or the member blocked the bot in Telegram
> **Then** no ping reaches that member. A closed conversation or a sent reply ends the wait (AC-08). A deactivated member's Telegram link is removed as part of the deactivation, before any further ping, and is not restored when they are reactivated. While the bot does not work, no ping is sent and none is queued for later, and the member's panel shows "Pings paused — the bot is not working". Once the bot works again, conversations whose customers are still waiting and that were not pinged to a member in their current waiting period become due for that member again. They go out combined, under the one-per-10-minutes limit (AC-08), and the 30-minute team reach continues from the start of each wait. When the member has blocked the bot, their panel shows "Not reachable — you blocked the bot in Telegram, unblock it or disconnect" until a ping reaches them again. Pings to that member are still attempted when due. A failed attempt counts as that conversation's ping for this member in the waiting period and is not retried. A deactivated member's link is removed. A link made with the workspace's previous bot is removed when a different bot is connected, and its member sees "Not connected". A bot that is "taken over" can still send (shared-inbox AC-14), so pings for customers who were already waiting still go out. The panel says that new customer messages are not arriving (shared-inbox AC-14). Pings never delay or crowd out replies to customers: when the bot is at its Telegram sending limit, replies go first and pings wait or are combined.
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — cross-context

> **Given** an operator of "Acme Flowers" whose Telegram account is linked to the "Acme Flowers" bot
> **When** they write anything in that chat, for example "ok" in answer to a ping
> **Then** the message is not captured, whatever it is: text, media, an edit or a start of the bot through any link, including a business's own campaign link. It creates no contact or conversation, does not reopen anything and counts toward no unread count or waiting marker. The bot answers that this chat only sends notifications and that replies to customers are written in the panel, with a link. It sends that answer at most once per hour. Messages the same person sent to the bot before they linked stay in their conversation as they were. Once they disconnect, their messages are captured as an end customer's again. For anyone without a Telegram link to that bot, starting the bot with a business's own campaign link is captured as before (bot-connection AC-07).
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person who is not an active member of "Acme Flowers": an account of another workspace, a deactivated member, someone not signed in, or a Telegram user who got hold of a connect link
> **When** they try to get a connect link for "Acme Flowers", see or remove a member's Telegram link, or use a link issued to someone else
> **Then** the system refuses and changes nothing. An account of another workspace gets no hint that the workspace exists. A deactivated member gets the access-removed notice. Someone not signed in is asked to sign in first. A connect link works only for the membership it was issued to, only once and only for 10 minutes (AC-05). A member sees and removes only their own Telegram link. A business owner sees which members are connected ("Telegram pings on/off" in Team) but cannot link or unlink for them, and never sees the Telegram account itself. A ping opened by someone else leads to the panel's sign-in and the workspace's usual access rules. Only an active member of "Acme Flowers" reaches the conversation.
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Story: create link → webhook `/start tgi_…` → `connected` answer in the fake chat, `telegram_link.changed` on the member's socket only, settings `connected`, no contact or conversation (AC-04)
- [ ] Story: expired, replaced, reused and deactivated-member links → `link_expired`; teammate's account and member-linked-elsewhere → `cannot_connect`; same account → `already_connected` (AC-05, AC-06)
- [ ] Story: away member, 5 min → ping with the conversation link; fake `403` → `blocked`, settings `not_reachable`, next accepted → `on`; deactivate during a due ping → no send; bot replaced → link removed (AC-10)
- [ ] Story: linked member writes «ok», media, edit, campaign start → nothing captured, one notice per hour (AC-11); another workspace's account → `404` on every new route (AC-12)
- [ ] Load: 50 pings due on one bot while replies drain, fake `429` once → pings pause, reply send p95 ≤ 2 s — `apps/api/src/e2e/notification-load.int.test.ts`
- [ ] Integrity queries after the stories return no row — `apps/api/src/e2e/helpers.ts`
- [ ] Secrecy: scan every new body, frame, job payload and captured log line for the bot token, the connect token and its hash, ping text, contact names and message text; the Telegram user id appears only in `link_expired` / `cannot_connect` payloads and the redeem debug line (F-3) — `apps/api/src/modules/bots/http/secrecy.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Contact name containing a phishing line | never appears in any ping text (by type and by scan) |
| Teammate's socket | receives no `telegram_link.changed` |
| Member-removed link after its job finished | no Telegram user id left on the row |

## Definition of Done

- [ ] The e2e stories pass against Postgres and the fake Bot API (connect and answers, every redeem refusal, ping to an away member with blocked and recovered reachability, deactivation during a due ping, bot replaced, linked-member interception, cross-workspace refusals), the integrity queries return no row, the load test keeps reply p95 within 2 s with 50 pings due, and the secrecy scan finds no token, hash, ping text, contact name or message text and the Telegram user id only where F-3 allows.
- [ ] a captured customer message's frame reaches a connected socket and GET inbox/attention returns the new count within 3 s, and the eight integrity queries listed in test-plan.md (pings to inactive members, duplicate ledger items, pings < 10 min apart, contacts equal to a linked member, links of another bot, live links of inactive members, member-removed links still holding a Telegram id after 1 h, waiting conversations without a period) return no row (test-plan.md, §6)
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
