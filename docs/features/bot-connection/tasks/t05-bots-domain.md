---
id: T5
title: "Implement the bots domain: token check, connection states, inbound filter, update normalisation, due rule"
layer: "domain"
deps: []
blocks: ["T10", "T14", "T15"]
acs: ["AC-01", "AC-02", "AC-09", "AC-12", "AC-15"]
files_hint: ["apps/api/src/modules/bots/domain/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T5 — Implement the bots domain: token check, connection states, inbound filter, update normalisation, due rule

## Place in the sequence

- **Blocked by:** — · **Blocks:** T10 — Build the bot repository, the AES-GCM token cipher and webhook secrets, with isolation tests incl. the two controlled exceptions, T14 — Implement the bots use case accept-webhook-update: secret check, inbound filter, capture epoch, hand-off to conversations, T15 — Implement the scheduled health check: run-health-check use case and the bots.schedule-health-checks / bots.check-health jobs · **Wave:** 1 — pure rules, no I/O.
- **Lane:** own lane (`modules/bots/domain/`).

## Why (user story)

> **As a** Business owner
> **I want** to connect the business bot to my workspace by pasting its token
> **So that** messages from our customers start arriving in tg-inbox without help from the tg-inbox team
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** End customer
> **I want** what I write to the business's bot to reach the business's team
> **So that** I get an answer without leaving Telegram or knowing who is on shift
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

This task encodes, without I/O, which pasted text is a token, which updates are captured, how each becomes a normalised message, and when a bot is due for a check.

## Inlined context

> domain/ — connection states + transitions, token format check, update filter (private chat, human sender, no business connection, not before the capture epoch), update → normalised message
>
> — `sad.md §5, Internal decomposition (bots), verbatim` · full text: [sad.md](../sad.md)

> The server trims surrounding spaces and then requires the bot-token form `^[0-9]{1,20}:[A-Za-z0-9_-]{30,100}$` (bots domain). Any other text is `400 BOT_TOKEN_INVALID`, the same answer as a token Telegram rejects (AC-02).
>
> — `contracts/openapi.yaml, BotTokenPaste.token, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

> Inbound filter: `allowed_updates` = message, edited_message; only `chat.type = private`, a non-bot sender and no `business_connection_id` are captured; anything else is acknowledged and dropped (AC-12)
> Message kinds: Text, photo, video, animation, voice, audio, video note, document, sticker, location, venue, contact, poll, dice; anything else is "other"; the caption is kept; Telegram's message object is stored for its media references […]; live-location updates change nothing
> Freshness budget: AC-15's 5 minutes = a check becomes due 3 minutes after the last one + up to 1 minute until the next cron tick + two Bot API calls of at most 10 s each + queue pickup […]; the due threshold lives in the `bots` domain, not in config
>
> — `sad.md §8, Inbound filter / Message kinds / Freshness budget, abridged` · full text: [sad.md](../sad.md)

> Capture epoch: connecting a bot that has no live connection (first connect, or after a disconnect) registers the webhook with `drop_pending_updates` and records the connection time; capture ignores messages dated before it. Rotation and reconnect after takeover keep pending updates
>
> — `sad.md §4, Supporting choices, abridged` · full text: [sad.md](../sad.md)

> Shared live-location updates arrive as edits without text and change nothing (AC-09).
>
> — `adr/0004, Decision outcome, abridged` · full text: [ADR-0004](../adr/0004-order-messages-by-telegram-message-id-and-apply-edits-by-telegram-edit-time.md)

Conversations owns the kind list (`conversations/domain`, T6) and the capture input type; to keep imports inward the normaliser here produces a plain object whose `kind` is a string literal from the same 15 values — T14 maps it into the capture call.

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. (States mirror `bots.state` CHECK: `connected`, `needs_token`, `taken_over`, `disconnected`; kinds mirror `messages_kind_check`.)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers", which has no connected bot, and the token of the business's bot "Acme Flowers Support", which is not connected to any workspace
> **When** the owner pastes the token (surrounding spaces are ignored) and confirms
> **Then** the system checks the token with Telegram, connects the bot, and shows the owner the bot's name and username with the state "connected"; from then on the bot's private messages are captured into "Acme Flowers", and the token itself is never shown again
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — error

> **Given** a business owner of "Acme Flowers" connecting a bot or giving the connected bot a new token
> **When** the pasted text is not a bot token, or Telegram does not accept it (mistyped, revoked, or the bot was deleted)
> **Then** the system changes nothing — an existing connection keeps working as before — and tells the owner the token is not valid — copy it again from BotFather
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — happy path

> **Given** a connected bot and an end customer with a conversation in "Acme Flowers"
> **When** the customer sends a photo with a caption, a voice note, a sticker, a file, a location, or any other kind of message
> **Then** each one appears in their conversation in the order sent (each item of an album as its own message), marked with its kind — a kind tg-inbox does not recognise is marked "other" — and carrying its caption when it has one, so the workspace holds a record that something arrived; viewing its content arrives with the inbox step; later updates of a shared live location do not change the captured location
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — domain invariant

> **Given** a connected bot of "Acme Flowers"
> **When** someone writes in a group or channel the bot belongs to, another bot writes to it, or the bot receives messages on behalf of someone's personal Telegram Business account
> **Then** the system captures nothing from it and creates no contact or conversation — only private chats between people and the bot are captured
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** a business owner of "Acme Flowers" with a connected bot that has captured messages from 12 end customers
> **When** they open the bot settings
> **Then** they see the bot's name and username, its state "connected", the time the last message was received and the number of contacts captured — but never the token; the state, name and username are checked with Telegram in the background and are never more than 5 minutes old, and a failed exchange with Telegram changes the state at once
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `parseBotToken(raw)` → trimmed token + `telegramBotId: bigint` (the part before the colon) or `invalid` — `bots/domain/token.ts`
- [ ] `BotState`, `decidePaste(row, pastedBotId)` → `connect` (no row) \| `connectAgain` (disconnected, same bot) \| `rotate` (live, same bot) \| `refuse(reason: connected|history)` (different bot) — `bots/domain/connection.ts`
- [ ] `classifyUpdate(update, { connectedAt })` → `capture(message)` \| `edit(edit)` \| `ignore(reason)`; reasons: `not_private`, `bot_sender`, `business`, `before_epoch`, `unsupported_update`, `malformed` — `bots/domain/inbound.ts`
- [ ] `normalise(message)`: kind by first present content field (text, photo, video, animation, voice, audio, video_note, document, sticker, location, venue, contact, poll, dice, else `other`), `body` = text or caption or null, `sentAt` from `date`, sender profile, `chatId`, `messageId`, raw object; an edit with no text/caption (live location) → `ignore`
- [ ] `isDueForCheck(lastCheckedAt, now)` with `DUE_AFTER = 3 min` — `bots/domain/health.ts`
- [ ] Unit tests for every function — `bots/domain/*.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `"  123:AAAA…  "` | trimmed, valid |
| `"123:short"` / `"abc:…"` / empty | invalid (same answer as a Telegram rejection) |
| `/start` text | captured as `text` |
| Message dated exactly at `connectedAt` | captured (only strictly before is ignored) |
| Photo without caption | kind `photo`, body null |
| Unknown content (e.g. `story`) | kind `other` |
| Group / channel / `is_bot: true` / `business_connection_id` | `ignore` with its reason |

## Definition of Done

- [ ] unit tests cover each transition, filter reason, every kind incl. `other`, the trim rule and the 3-minute boundary — no I/O in `bots/domain`
- [ ] lint + vet clean (`pnpm lint`)
