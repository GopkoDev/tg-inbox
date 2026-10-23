---
id: T12
title: "Intercept every private update in bots before capture through a port: redeem connect-link starts, consume linked members' messages with the hourly notice, pass everyone else"
layer: "app"
deps: ["T11"]
blocks: ["T19"]
acs: ["AC-04", "AC-11"]
files_hint: ["apps/api/src/modules/bots/app/ports.ts", "apps/api/src/modules/bots/app/accept-update.ts", "apps/api/src/modules/notifications/app/intercept.ts", "apps/api/src/modules/notifications/app/intercept.test.ts", "apps/api/src/deps.ts", "apps/api/src/test/fixtures/telegram.ts", "apps/api/src/modules/bots/http/webhook-route.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T12 — Intercept every private update in bots before capture through a port: redeem connect-link starts, consume linked members' messages with the hourly notice, pass everyone else

## Place in the sequence

- **Blocked by:** T11 — Redeem a connect-link start: share-lock the membership, lock and re-check the link, enforce both uniqueness rules, link, signal and enqueue the answer · **Blocks:** T19 — Serve the notifications routes (settings, connect link, disconnect) and GET inbox/attention behind the workspace guard, and register the notifications module · **Wave:** 4 — after T11.
- **Lane:** shares `apps/api/src/deps.ts` with T7; shares `apps/api/src/deps.ts` with T14; shares `apps/api/src/deps.ts`, `apps/api/src/modules/bots/app/ports.ts` with T18; shares `apps/api/src/deps.ts` with T19; shares `apps/api/src/deps.ts` with T20 — serialized.

## Why (user story)

> **As an** End customer
> **I want** the business's conversation list to hold only real customers
> **So that** the team's attention and replies go to me, not to their own colleagues' notification chats
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
> **So that** the bot can ping me when I am away, and only after I chose so
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It keeps the team's inbox holding only real customers: nothing a connect-link start or a linked member sends is ever captured.

## Inlined context

> **Chosen:** Option 1. The check happens before anything is written, in the module that already decides what is captured. It costs one indexed lookup per private update, scoped by the workspace id the authenticated webhook's bot gives. It needs no new tenancy exception and no reverse import. The link stays wholly owned by `notifications`. The bot-connected hook makes "a different bot removes the links" atomic with the connect. Link reads also filter by the current bot's Telegram id, as a second line.
>
> — `adr/0003-intercept-connect-link-starts-and-linked-members-messages-in-bots-before-capture-through-a-port.md §Decision outcome, ADR-0003, verbatim` · full text: [ADR-0003](../adr/0003-intercept-connect-link-starts-and-linked-members-messages-in-bots-before-capture-through-a-port.md)

> `bots/app/accept-update.ts` classifies an update as today. Then, for every private message or edit from a human sender, it asks `inboundInterceptor.intercept({ workspaceId, telegramBotId, from, kind, text })` before it calls `captureInbound` or `applyEdit`. The answer is `pass` (capture as before) or `consumed`. `notifications` answers `consumed` in two cases:
> - the text is `/start tgi_<token>`, a connect-link start (choice 4), whether or not the sender is linked;
> - the sender's Telegram user id has a live link in this workspace, made with this bot (any message, edit or start, campaign links included, AC-11).
>
> — `sad.md §4, choice 3, abridged` · full text: [sad.md](../sad.md)

> | `/start tgi_<43 chars>` | redeem (seeded flow 2); never captured | the link and/or the connect link's `used_at`, one bot-answer job | `200` |
> | anything from a sender with a live link made with this bot (text, media, edit, any start, a campaign start included) | consumed; no contact, conversation, unread, waiting marker or reopen | at most `last_notice_at` and one `chat_only_notifications` job per hour | `200` |
> | anything else (no live link, or disconnected since) | captured as before (bot-connection AC-07) | as before | `200` |
> | the lookup or a write fails | nothing written | — | not acknowledged, Telegram redelivers |
>
> — `contracts/events.md §Inbound Telegram updates, interceptor table, verbatim` · full text: [events.md](../contracts/events.md)

> | `bots/app/accept-update.ts` captures `/start <payload>` as a customer message today. Until this feature ships, connect links must not be issued. | Low | The interceptor and connect routes ship together in one release (task ordering). | Tech Lead |
>
> — `sad.md §11, start captured today, verbatim` · full text: [sad.md](../sad.md)

> | A business's own campaign start payload that happens to begin with `tgi_` would be treated as a connect-link start and not captured. | Low | The prefix is distinctive. Document it in the bot settings help. A redeem with an unknown token answers "link expired", so the sender sees why. | Tech Lead |
>
> — `sad.md §11, tgi_ prefix, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Column | Change |
|---|---|
| `telegram_links.last_notice_at` | conditional `UPDATE` (≤ 1 notice per hour per link) |

Reads `telegram_links_live_workspace_id_telegram_user_id_key`, then compares `telegram_bot_id`. No `contacts` / `conversations` write on a consumed update.

— `data-model.md §Entities telegram_links, abridged` · full text: [data-model.md](../data-model.md)

## API contract

`receiveTelegramUpdate` (bot-connection) keeps its contract; a consumed update answers `200`, a failed lookup is not acknowledged. — `contracts/events.md §Inbound Telegram updates, abridged` · full text: [events.md](../contracts/events.md)

## Acceptance criteria

### AC-04 — happy path

> **Given** an active operator of "Acme Flowers", whose bot is connected, with no Telegram link
> **When** they choose "Connect Telegram" in the panel, open the link it shows on their phone and press Start in the chat with the "Acme Flowers" bot within 10 minutes
> **Then** the bot answers in that chat that it will notify them about waiting customers of "Acme Flowers", and how to stop: disconnect in the panel. The panel shows "Connected" with their Telegram name and since when, without reloading. Starting the bot through this link creates no contact and no conversation and shows nothing in the inbox. Choosing "Disconnect" removes the link at once: the bot sends no further pings and tells them in the chat that notifications are off.
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — cross-context

> **Given** an operator of "Acme Flowers" whose Telegram account is linked to the "Acme Flowers" bot
> **When** they write anything in that chat, for example "ok" in answer to a ping
> **Then** the message is not captured, whatever it is: text, media, an edit or a start of the bot through any link, including a business's own campaign link. It creates no contact or conversation, does not reopen anything and counts toward no unread count or waiting marker. The bot answers that this chat only sends notifications and that replies to customers are written in the panel, with a link. It sends that answer at most once per hour. Messages the same person sent to the bot before they linked stay in their conversation as they were. Once they disconnect, their messages are captured as an end customer's again. For anyone without a Telegram link to that bot, starting the bot with a business's own campaign link is captured as before (bot-connection AC-07).
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Declare `InboundInterceptor` in the bots ports and call it in `accept-update` for every private human message or edit, before `captureInbound` / `applyEdit` — `apps/api/src/modules/bots/app/ports.ts`, `apps/api/src/modules/bots/app/accept-update.ts`
- [ ] `intercept(…)`: `parseStartPayload` → redeem (T11); else live link with this bot id → claim the notice, enqueue `chat_only_notifications` when claimed, `consumed`; else `pass` — `apps/api/src/modules/notifications/app/intercept.ts`
- [ ] Fill the port in `buildDeps()`, establishing the order contacts → conversations → bots core → notifications → bots ports → team — `apps/api/src/deps.ts`
- [ ] Recorded-update builders for `/start tgi_…`, a campaign start, text, media and an edit — `apps/api/src/test/fixtures/telegram.ts`
- [ ] Webhook integration tests asserting `contacts` and `conversations` unchanged for every consumed case, captured for an unlinked sender and a campaign start — `apps/api/src/modules/bots/http/webhook-route.int.test.ts`, `apps/api/src/modules/notifications/app/intercept.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Linked member sends a campaign `/start promo` | consumed, not captured (AC-11) |
| Linked member edits an old message sent before linking | consumed; the old message stays as it was |
| Linked member made the link with the previous bot | no live link with this bot → captured as before |
| Disconnected member writes | captured as an end customer again |
| Two updates within the hour | one notice |

## Definition of Done

- [ ] Webhook integration tests prove a connect-link start is redeemed and never captured, every update from a linked sender with this bot (text, media, edit, any start) is consumed with at most one notice per hour, and unlinked or disconnected senders and campaign starts without a link are captured exactly as before, with contacts and conversations unchanged for every consumed case.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
