---
id: T5
title: "Classify group and channel updates in bots into four facts, add channel_post to allowed_updates, and hand them to a late-bound ChatEventsPort"
layer: "app"
deps: ["T2"]
blocks: ["T9"]
acs: ["AC-01", "AC-02", "AC-13", "AC-14", "AC-17"]
files_hint: ["apps/api/src/modules/bots/domain/inbound.ts", "apps/api/src/modules/bots/app/accept-update.ts", "apps/api/src/modules/bots/app/ports.ts", "apps/api/src/modules/bots/infra/telegram-gateway.ts", "apps/api/src/test/fixtures/telegram.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "blocked"
step: "GATE — inbound-chat.test.ts contradictory /connect@ tests (1 of 542 fails)"
---

# T5 — Classify group and channel updates in bots into four facts, add channel_post to allowed_updates, and hand them to a late-bound ChatEventsPort

## Place in the sequence

- **Blocked by:** T2 — Add the posts zod contracts, the 17 new error codes, and the · **Blocks:** T9 — Add the destination use cases: create and read a connect cod · **Wave:** 2 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to connect the business's Telegram channel or group to the workspace by posting a code from the panel into it
> **So that** the team can post there through the business bot, and no other chat can be posted to by mistake
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** replies to customers to go out and customer messages to arrive as fast as ever, whatever is being posted or written in the business's groups
> **So that** posting never makes support slower
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

> **As an** End customer
> **I want** what I write in the business's group to stay in the group, and my private messages to the bot to reach the team as fast as before
> **So that** the team sees only what I sent them directly, and my questions are not delayed by the group
>
> — `spec.md §4, US-08, verbatim` · full text: [spec.md](../spec.md)

This task delivers: classify group and channel updates in bots into four facts, add channel_post to allowed_updates, and hand them to a late-bound ChatEventsPort.

## Inlined context

> the pure classifier gains `destination_code`, `chat_membership`, `chat_migrated`, `chat_renamed` for group / supergroup / channel chats and `ignored` for everything else; `accept` forwards the four to a `ChatEventsPort` filled by `posts`; ignored updates cost one bot lookup and no write.
>
> — `adr/0003, Option 1, verbatim` · full text: [adr/0003](../adr/)

> | `message` with a `/connect` (or `/connect@<bot>`) command and a `tgp_…` argument | group, supergroup | `destination_code` | … `channel_post` whose text contains `tgp_…` | channel | `destination_code` | … `my_chat_member` | group, supergroup, channel | `chat_membership` | `{chatId, kind, title, username, status, canPost, date}` | … `migrate_to_chat_id` → `chat_migrated` … `new_chat_title` → `chat_renamed` … anything else → `ignored`
>
> — `contracts/events.md §Inbound Telegram updates, abridged` · full text: [contracts/events.md](../contracts/events.md)

> Today `bots` drops every non-private update in a pure classifier (`not_private`) … `classifyUpdate(update, {connectedAt})` L183 … `ALLOWED_UPDATES = ['message','edited_message','my_chat_member']` (telegram-gateway.ts:71); the health check re-registers `ours_outdated` webhooks
>
> — `explorer map 2026-11-03 §1, abridged` · full text: [explorer](../sad.md)

> Hard rule: nothing written in a destination is captured — no contact, conversation, unread or ping (bot-connection AC-12 stays true); private `my_chat_member` handling for broadcasts is unchanged.
>
> — `spec.md AC-17 + events.md, abridged` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

`receiveTelegramUpdate` (`x-delta: changed`): accepts `channel_post` and non-private updates; always answered as accepted.

— `contracts/openapi.yaml, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers" whose connected bot was added as an admin with the right to post to the channel "Acme Flowers News"
> **When** the owner creates a connect code in Settings and posts it in that channel within 10 minutes
> **Then** "Acme Flowers News" appears among the workspace's destinations, live, as a channel with its Telegram name, the code stops working, and the bot removes the code message from the channel when it is allowed to
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — domain invariant

> **Given** a business owner whose bot is in a group but may not send messages there, or in a channel without the right to post
> **When** the owner posts a valid connect code there
> **Then** the chat is not connected, and Settings tells the owner which right the bot needs in that chat; a chat the bot was added to without a code never becomes a destination; an expired or already used code connects nothing, and Settings shows the code as expired
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — error

> **Given** a published-now or scheduled post
> **When** Telegram refuses it — the bot lost the right to post or was removed from the chat, the chat no longer exists, or the text was refused
> **Then** the post is marked failed with that reason in plain language, is not tried again, is counted next to Posts in the navigation for the whole team until any member opens it, and the destination is marked unavailable with what is wrong when the bot can no longer post there
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — cross-context

> **Given** a workspace with destinations and scheduled posts
> **When** its bot stops working or is disconnected, or a different Telegram bot is connected
> **Then** while the bot is not working, publishing and scheduling are refused with a way to the bot settings and posts whose time comes fail with "the bot was not working"; with a different working bot, only the old bot's destinations are unavailable until connected again with a code, and posts due to them fail with "this chat is not connected to the current bot"; while reconnecting the same bot keeps them; a group that Telegram upgraded keeps working as the same destination
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — cross-context

> **Given** a destination group where customers chat busily and a broadcast and replies are being sent
> **When** posts go out and people write in the group
> **Then** nothing written in a destination is captured — no contact, conversation, unread or ping is created; customer messages to the bot and replies keep their usual speed; a limit Telegram applies to one chat delays only posts to that chat, while posts still wait for the bot's send pause
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `domain/inbound.ts` — non-private branch: `destination_code` / `chat_membership` / `chat_migrated` / `chat_renamed` / `ignored` (pure, unit-tested per chat type)
- [ ] `app/ports.ts` — `ChatEventsPort { onDestinationCode, onChatMembership, onChatMigrated, onChatRenamed }` (default no-op until bound)
- [ ] `app/accept-update.ts` — dispatch before interceptor/capture; private path unchanged
- [ ] `infra/telegram-gateway.ts` — `ALLOWED_UPDATES` += `channel_post` (health check then re-registers)
- [ ] fixtures for group / supergroup / channel updates

## Edge cases

| Case | Behaviour |
|---|---|
| ordinary group message | `ignored`, no write, no capture |
| `/connect@other_bot tgp_…` | `ignored` |
| `my_chat_member` private chat | unchanged broadcasts path |
| channel post without a code | `ignored` |

## Definition of Done

- [ ] classifier unit tests per chat type and update kind pass
- [ ] integration: a group message creates no contact or conversation; health check re-registers a webhook without `channel_post`
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
