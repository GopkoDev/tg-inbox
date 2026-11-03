---
id: T26
title: "Fix connecting and Telegram classification: redeem under posts:<ws> with the 20 limit (also on revival) and a visible limit result, needed right per chat kind, 400 rights / upgrade answers, delete timeout as Telegram unavailable"
layer: "app"
deps: []
blocks: []
acs: ["AC-01", "AC-02", "AC-13", "AC-14", "AC-15"]
files_hint: ["apps/api/src/modules/posts/app/chat-events.ts", "apps/api/src/modules/posts/app/destinations.ts", "apps/api/src/modules/posts/infra/code-repo.ts", "apps/api/src/modules/bots/infra/telegram-gateway.ts", "packages/shared/src/posts.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T26 — Fix connecting and Telegram classification: redeem under posts:<ws> with the 20 limit (also on revival) and a visible limit result, needed right per chat kind, 400 rights / upgrade answers, delete timeout as Telegram unavailable

## Place in the sequence

- Follow-up task from the review of 2026-11-04 (`_review/review-2026-11-04.md`, gate CHANGES REQUESTED). **Blocked by:** —.
- **Lane:** own lane.

## Why (user story)

Fixes review findings F5, F6, F7, F8 so the ACs below are genuinely met. User stories: see each AC's US tag in [spec.md](../spec.md) §4.

## Inlined context

The review findings this task resolves (verbatim rows):


| F5 | 1/2 | Redeem counts and inserts without `posts:<ws>`; reviving a removed destination skips the 20 limit; a limit stop leaves the code "waiting" — `posts/app/chat-events.ts:97-147` | AC-01 | Fix → T26 |
| F6 | 1/2 | `needed_right` is always `post_messages`, also for groups — `posts/app/destinations.ts:114-120` | AC-02 | Fix → T26 |
| F7 | 2 | Telegram 400 rights / supergroup-upgrade answers classified as `text_refused`; destination not marked — `bots/infra/telegram-gateway.ts:166-170` | AC-13, AC-14 | Fix → T26 |
| F8 | 1 | Delete-from-Telegram: timeout / network error reported as refused, not `TELEGRAM_UNAVAILABLE` — `telegram-gateway.ts:367-369` | AC-15 | Fix → T26 |

— `_review/review-2026-11-04.md §Findings, verbatim` · full text: [review](../_review/review-2026-11-04.md)

**Fallback:** read the cited code and [sad.md](../sad.md) / [openapi.yaml](../contracts/openapi.yaml) / [screens.md](../screens.md) / [adr/](../adr/). Do not guess.

## Data delta

No DB changes (unless a finding requires a new enum value — then note it).

## API contract

As in [openapi.yaml](../contracts/openapi.yaml); keep responses in line with it.

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers" whose connected bot was added as an admin with the right to post to the channel "Acme Flowers News"
> **When** the owner creates a connect code in Settings and posts it in that channel within 10 minutes
> **Then** "Acme Flowers News" appears among the workspace's destinations, live, as a channel with its Telegram name, the code stops working, and the bot removes the code message from the channel when it is allowed to
>
> — `spec.md §5, AC-01, verbatim`

### AC-02 — domain invariant

> **Given** a business owner whose bot is in a group but may not send messages there, or in a channel without the right to post
> **When** the owner posts a valid connect code there
> **Then** the chat is not connected, and Settings tells the owner which right the bot needs in that chat; a chat the bot was added to without a code never becomes a destination; an expired or already used code connects nothing, and Settings shows the code as expired
>
> — `spec.md §5, AC-02, verbatim`

### AC-13 — error

> **Given** a published-now or scheduled post
> **When** Telegram refuses it — the bot lost the right to post or was removed from the chat, the chat no longer exists, or the text was refused
> **Then** the post is marked failed with that reason in plain language, is not tried again, is counted next to Posts in the navigation for the whole team until any member opens it, and the destination is marked unavailable with what is wrong when the bot can no longer post there
>
> — `spec.md §5, AC-13, verbatim`

### AC-14 — cross-context

> **Given** a workspace with destinations and scheduled posts
> **When** its bot stops working or is disconnected, or a different Telegram bot is connected
> **Then** while the bot is not working, publishing and scheduling are refused with a way to the bot settings and posts whose time comes fail with "the bot was not working"; with a different working bot, only the old bot's destinations are unavailable until connected again with a code, and posts due to them fail with "this chat is not connected to the current bot"; while reconnecting the same bot keeps them; a group that Telegram upgraded keeps working as the same destination
>
> — `spec.md §5, AC-14, verbatim`

### AC-15 — happy path

> **Given** a post the bot published to "Acme Flowers News" less than 48 hours ago
> **When** a business owner deletes it from Telegram and confirms
> **Then** the message disappears from the channel, the post is marked deleted with the owner and time, and its text stays readable in the panel; after 48 hours, or if Telegram refuses, the panel says it can no longer be deleted by the bot
>
> — `spec.md §5, AC-15, verbatim`

## Checklist

- [ ] redeem: `lockPosts(tx, ws)` first; count live incl. a revival of a removed row; on limit record a code result (e.g. `destination_limit`) the dialog shows (add to the shared enum + contract note)
- [ ] store the chat kind (or needed right) with the code result; return `send_messages` for groups, `post_messages` for channels
- [ ] gateway: map Telegram 400 rights descriptions to `no_post_right`; a `migrate_to_chat_id` answer → move the destination to the new chat id (or `chat_gone`)
- [ ] gateway deleteMessage: timeout / network error → `no_answer` → `TelegramUnavailableError` (503)
- [ ] tests for each (gateway it.each + integration redeem race)

## Edge cases

| Case | Behaviour |
|---|---|
| the cited scenario | the fixed behaviour, asserted by a test that failed before the fix |

## Definition of Done

- [ ] a RED test reproduces each finding before the fix, then passes
- [ ] the gate (tests of the touched modules + `pnpm lint`) is clean
