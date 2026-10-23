---
id: T10
title: "Learn blocks in bots: allowed_updates gains my_chat_member, the classifier turns a private kicked / member update into a reach decision handled before the interceptor and capture, and a reply refused as blocked records the block"
layer: "app"
deps: ["T7"]
blocks: ["T11", "T12"]
acs: ["AC-14"]
files_hint: ["apps/api/src/modules/bots/infra/telegram-gateway.ts", "apps/api/src/modules/bots/domain/inbound.ts", "apps/api/src/modules/bots/domain/inbound.test.ts", "apps/api/src/modules/bots/app/accept-update.ts", "apps/api/src/modules/bots/app/send-text.ts", "apps/api/src/modules/bots/app/ports.ts", "apps/api/src/modules/bots/app/fakes.ts", "apps/api/src/test/fake-telegram.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T10 — Learn blocks in bots: allowed_updates gains my_chat_member, the classifier turns a private kicked / member update into a reach decision handled before the interceptor and capture, and a reply refused as blocked records the block

## Place in the sequence

- **Blocked by:** T7 — Record reachability in contacts: capture's upsertFromProfile takes the receiving bot's Telegram id and writes "wrote" (clearing an older block), recordBlockChange applies a block or unblock only when newer, and contact.changed reach fires only when a mark changed · **Blocks:** T11 — Re-register outdated webhooks in the bots health check: a webhook that is ours but lacks my_chat_member is set again with the same URL and secret, keeping pending updates, T12 — Add bots.sendBroadcastMessage and launchReadiness: a per-bot broadcast pacer at 40 ms start slots, refusal while the send pause runs, when the bot is not working or is not the launch Telegram bot, plain-text sendMessage, and every Telegram answer classified (blocked recorded in contacts) · **Wave:** 4 — after T7.
- **Lane:** shares `apps/api/src/modules/bots/app/accept-update.ts` with T7; shares `apps/api/src/modules/bots/infra/telegram-gateway.ts` with T11; shares `apps/api/src/modules/bots/infra/telegram-gateway.ts`, `apps/api/src/modules/bots/app/ports.ts`, `apps/api/src/test/fake-telegram.ts` with T12 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to see on a contact that they have blocked the bot, and have such contacts left out of broadcasts
> **So that** the team does not count on reaching customers the bot cannot reach
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It turns Telegram's block and unblock notices, and replies refused because the customer blocked the bot, into the contact's blocked mark, without ever creating a message.

## Inlined context

> **`bots` learns blocks from `my_chat_member` updates and from refused sends, and brings every webhook's allowed updates up to date in the health check.** `allowed_updates` gains `my_chat_member`. The inbound classifier turns a private `my_chat_member` (`kicked` / `member`) into a block change, never a message. Any send to a customer chat refused as blocked (a reply or a broadcast) records a block too.
>
> — `sad.md §4, choice 3, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. The block notice arrives through the authenticated webhook within the same request handling as a message, which meets the 5 s target. Refused sends cover blocks that happened before the webhook knew. […]
> - A linked member's own block of the bot is recorded only if that person is also a contact; otherwise it finds no contact and is dropped.
>
> — `adr/0003 §Decision outcome + §Consequences (Neutral), ADR-0003, abridged` · full text: [ADR-0003](../adr/0003-learn-blocks-from-my-chat-member-updates-and-refused-sends-in-bots-and-re-register-outdated-webhooks-in-the-health-check.md)

> - **Consumer:** `bots.classifyUpdate` → a `reach` decision for a private chat (`new_chat_member.status` `kicked` → blocked, `member` → unblocked) → `contacts.recordBlockChange(workspaceId, telegramBotId, telegramUserId, blocked, at = date)`. Classified before the inbound interceptor and capture: never a message, conversation, unread, attention change or ping.
> - **Ordering:** none from Telegram; the reach row's `changed_at` makes the newest fact win (ADR-0002).
> - **Delivery:** at-least-once (Telegram redelivers on `500`); applying the same fact twice changes nothing.
>
> — `contracts/events.md §Inbound Telegram update: my_chat_member, verbatim` · full text: [events.md](../contracts/events.md)

> No message, conversation, unread or ping results. An unblock (`member`), or a new customer message through capture, clears the mark the same way. A send refused as blocked records the same change from `bots` (ADR-0003).
>
> — `sad.md §6, Critical flow 3, prose, verbatim` · full text: [sad.md](../sad.md)

> Telegram tells a bot that a private user blocked or unblocked it through a `my_chat_member` update (new status `kicked` / `member`), delivered only when the webhook's `allowed_updates` names it. Today `bots` registers `message` and `edited_message` only.
>
> — `sad.md §2, Technical, Telegram, abridged` · full text: [sad.md](../sad.md)

> | contacts | `recordBlockChange(workspaceId, telegramBotId, telegramUserId, blocked, at)` | bots | AC-14 |
>
> — `sad.md §5, App-layer additions, verbatim` · full text: [sad.md](../sad.md)

> **Hard rule:** Each bot's webhook is `POST /api/telegram/webhook/:botId`, authenticated by `X-Telegram-Bot-Api-Secret-Token` (a per-bot derived secret, only its hash stored, checked before the body is parsed; the header is redacted from logs).
>
> — `CLAUDE.md §Rules, Telegram, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> Reach rows of a refused send use our clock for `changed_at` and `blocked_at`. Telegram updates and messages use Telegram's time.
>
> — `data-model.md §Assumptions, 11, abridged` · full text: [data-model.md](../data-model.md)

> | Logging | pino structured logs. Never the broadcast text, contact names, usernames, chat ids or the token; ids, counts, states and reasons only. The group picker's search text is masked in request logs, like the Contacts search | CLAUDE.md, contacts SAD §8, here |
>
> — `sad.md §8, Logging, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (block changes are written to `contact_bot_reach` through `contacts.recordBlockChange`, T7).

## API contract

- `POST /api/telegram/webhook/{botId}` (`receiveTelegramUpdate`), **changed:** accepts a private-chat `my_chat_member`; `new_chat_member.status` `kicked` → "blocked", `member` → "unblocked" for (workspace, this bot's Telegram id, `from.id`) at `date`. "Group, channel and other statuses are ignored with `200`. The answer is always `200` with an empty body for an authentic update, as before." `401` / `500` unchanged.
- `TelegramUpdate.my_chat_member` fields read: `chat.id`, `chat.type`, `from.id`, `date` (Unix), `new_chat_member.status`. "Never stored, never logged beyond ids."
- Signal (published by `contacts`, T7): `contact.changed { change: "reach" }` only when a mark changed.

— `contracts/openapi.yaml, operationId receiveTelegramUpdate + schema TelegramUpdate, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-14 — cross-context

> **Given** a contact "Olena K." of "Acme Flowers"
> **When** she blocks the business bot in Telegram, or a broadcast or reply to her is refused because she blocked it; and later she unblocks the bot, or writes to it again
> **Then** after the block her profile says she has blocked the bot and since when, the Contacts list marks her row, every draft that includes her counts her as unreachable, and a launch leaves her out; blocking the bot creates no customer message, does not open her conversation, does not change any unread count and triggers no ping; after she unblocks the bot or writes again the mark is gone and drafts count her as reachable again; the recipient list of a broadcast already launched is not changed by either event, and if she is still waiting in a sending broadcast, her mark at her turn decides whether she is sent it (AC-11); a member's own Telegram account linked for pings is never a contact and never a recipient
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Failing classifier tests first: private `kicked` / `member` → `{ type: 'reach', telegramUserId, blocked, at }`; group / channel chat or another status → ignored; malformed → ignored — `apps/api/src/modules/bots/domain/inbound.test.ts`
- [ ] Add the `reach` decision (and its ignore reasons) to `classifyUpdate`, checked before `message` / `edited_message` — `apps/api/src/modules/bots/domain/inbound.ts`
- [ ] Declare the `ContactsReach` port (`recordBlockChange(workspaceId, telegramBotId, telegramUserId, blocked, at)`) and its fake — `apps/api/src/modules/bots/app/ports.ts`, `apps/api/src/modules/bots/app/fakes.ts`
- [ ] `acceptUpdate` routes a `reach` decision to the port with the authentic bot's `telegramBotId`, before the inbound interceptor and capture, and answers `200` — `apps/api/src/modules/bots/app/accept-update.ts`
- [ ] `ALLOWED_UPDATES` = `message`, `edited_message`, `my_chat_member` — `apps/api/src/modules/bots/infra/telegram-gateway.ts`
- [ ] `sendText`: a `refused` / `blocked` answer also calls `recordBlockChange(…, blocked: true, at: clock.now())`; the reply outcome is unchanged — `apps/api/src/modules/bots/app/send-text.ts`
- [ ] Fake Bot API: assert `setWebhook`'s `allowed_updates` and script a `403 bot was blocked by the user` for `sendMessage` — `apps/api/src/test/fake-telegram.ts`
- [ ] Webhook integration test: a `kicked` update marks the contact, creates no message / conversation / unread / ping, never reaches the interceptor; `member` clears it; a stranger's update changes nothing

## Edge cases

| Case | Behaviour |
|---|---|
| `my_chat_member` of a group or channel | ignored, `200` |
| status other than `kicked` / `member` | ignored, `200` |
| `from.id` is not a contact (e.g. a member's linked account) | no-op in `contacts`, `200` (ADR-0003) |
| the same update redelivered | the second apply changes nothing (newer-only rule, T7) |
| an older block arriving after an unblock | ignored by `changed_at` (ADR-0002) |
| a reply refused as `account_gone` / `chat_not_found` | no block recorded; reply outcome as today |
| wrong or missing secret | `401` before the body is parsed (unchanged) |

## Definition of Done

- [ ] Unit and webhook integration tests prove a private my_chat_member kicked update calls contacts.recordBlockChange(blocked, at = update date) and member clears it, that neither creates a message, conversation, unread change or ping nor reaches the inbound interceptor, that a non-private my_chat_member is ignored, that setWebhook registers message, edited_message and my_chat_member, and that sendText refused with "bot was blocked by the user" records the block for that bot.
- [ ] A test proves the inbound interceptor (notifications' `/start tgi_…` consumer) is never called for a `my_chat_member` update.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
