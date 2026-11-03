---
id: T6
title: "Add bots.sendPost, bots.deletePost and postReadiness with a 1-per-second post pacer, and teach the fake Telegram group chats, deleteMessage and getChatMember"
layer: "app"
deps: ["T2"]
blocks: ["T9", "T12", "T13"]
acs: ["AC-07", "AC-13", "AC-15", "AC-17"]
files_hint: ["apps/api/src/modules/bots/app/", "apps/api/src/modules/bots/infra/telegram-gateway.ts", "apps/api/src/test/fake-telegram.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T6 — Add bots.sendPost, bots.deletePost and postReadiness with a 1-per-second post pacer, and teach the fake Telegram group chats, deleteMessage and getChatMember

## Place in the sequence

- **Blocked by:** T2 — Add the posts zod contracts, the 17 new error codes, and the · **Blocks:** T9 — Add the destination use cases: create and read a connect cod, T12 — Add the posts.send job body: re-check owner and limits, per-, T13 — Add delete from Telegram within 48 hours and the deactivatio · **Wave:** 2 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to check the destination and the exact text one last time and publish the post right away
> **So that** the announcement appears in the business's channel or group from its bot, once
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to delete a post the bot published, shortly after it went out
> **So that** a mistake does not stay in front of the business's audience
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** replies to customers to go out and customer messages to arrive as fast as ever, whatever is being posted or written in the business's groups
> **So that** posting never makes support slower
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

This task delivers: add bots.sendPost, bots.deletePost and postReadiness with a 1-per-second post pacer, and teach the fake Telegram group chats, deleteMessage and getChatMember.

## Inlined context

> `sendPost(workspaceId, {telegramBotId, chatId, text, silent})` → `{messageId} | classified failure`; `deletePost(…)`; `postReadiness(workspaceId)` → `{state, telegramBotId, sendPausedUntil}`; a third keyed pacer `POST_MESSAGES_PER_SECOND = 1` beside the member and broadcast pacers in `bots/app/pacer.ts`.
>
> — `sad.md §5 App-layer additions, verbatim` · full text: [sad.md](../sad.md)

> a `429` to a post stores `destinations.paused_until` and re-queues that post … the bot's `send_paused_until` is checked before sending.
>
> — `adr/0007, Option 1, abridged — so sendPost returns `rate_limited{retryAfterMs}` and never calls `pauseSends`` · full text: [adr/0007](../adr/)

> Telegram chat ids pass through `Number()` in the gateway … the posts path passes ids as strings to the API
>
> — `sad.md §11, verbatim` · full text: [sad.md](../sad.md)

> Hard rule: Only `bots` talks to Telegram; bot tokens never leave `bots`.
>
> — `CLAUDE.md §Rules «Telegram», abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Reads `bots` (`state`, `telegram_bot_id`, `send_paused_until`) — existing schema, no change.

— `data-model.md §Entities, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal app-layer API used by `posts` (no HTTP route).

## Acceptance criteria

### AC-07 — happy path

> **Given** a business owner with a draft for "Acme Flowers News" and a working bot
> **When** the owner opens Publish, sees the destination's Telegram name and kind and the exact text, and confirms
> **Then** the post appears in the channel from the bot within seconds (if the bot is paused by Telegram it waits, at most 15 minutes, then is marked missed), once, and is marked published with the time, the owner who published it and a way to open it in Telegram; its text and destination never change afterwards, and it can be duplicated into a new draft
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — error

> **Given** a published-now or scheduled post
> **When** Telegram refuses it — the bot lost the right to post or was removed from the chat, the chat no longer exists, or the text was refused
> **Then** the post is marked failed with that reason in plain language, is not tried again, is counted next to Posts in the navigation for the whole team until any member opens it, and the destination is marked unavailable with what is wrong when the bot can no longer post there
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** a post the bot published to "Acme Flowers News" less than 48 hours ago
> **When** a business owner deletes it from Telegram and confirms
> **Then** the message disappears from the channel, the post is marked deleted with the owner and time, and its text stays readable in the panel; after 48 hours, or if Telegram refuses, the panel says it can no longer be deleted by the bot
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — cross-context

> **Given** a destination group where customers chat busily and a broadcast and replies are being sent
> **When** posts go out and people write in the group
> **Then** nothing written in a destination is captured — no contact, conversation, unread or ping is created; customer messages to the bot and replies keep their usual speed; a limit Telegram applies to one chat delays only posts to that chat, while posts still wait for the bot's send pause
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] gateway: `sendPost` (`sendMessage` with `disable_notification`, no `parse_mode`, chat id as string), `deleteMessage`, `getChatMember`; `classifyPostError` → `rate_limited` / `no_post_right` / `chat_gone` / `text_refused` / `telegram_error` / `no_answer`
- [ ] `app/send-post.ts`, `app/delete-post.ts`, `app/post-readiness.ts`; pacer `POST_MESSAGES_PER_SECOND = 1`
- [ ] fake Telegram: non-private chat ids in `sendMessage`, `deleteMessage`, `getChatMember` scriptable

## Edge cases

| Case | Behaviour |
|---|---|
| Telegram 429 to a post | `rate_limited`, bot pause untouched |
| 403 bot was kicked | `no_post_right`/`chat_gone` classified |
| no answer (hang) | `no_answer` |
| bot replaced since claim | refused before the call |

## Definition of Done

- [ ] unit + integration tests against the fake Telegram for each classification pass
- [ ] a post 429 leaves `send_paused_until` unchanged (test)
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
