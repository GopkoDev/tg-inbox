---
id: T4
title: "Extend the fake Bot API with sendMessage, getFile and the file download, scriptable per call"
layer: "tests"
deps: []
blocks: ["T14", "T15"]
acs: ["AC-04", "AC-05", "AC-10", "AC-11", "AC-12"]
files_hint: ["apps/api/src/test/fake-telegram.ts", "apps/api/src/test/fake-telegram.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T4 — Extend the fake Bot API with sendMessage, getFile and the file download, scriptable per call

## Place in the sequence

- **Blocked by:** — · **Blocks:** T14 — Add sendMessage to the bots gateway as send text, classifying every answer into a typed outcome, T15 — Add the media stream to the bots gateway: getFile, size check and a ranged byte stream with typed unavailability · **Wave:** 1 — nothing upstream.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** every reply I send to show whether it reached Telegram, and if not, why
> **So that** no customer is left believing they were answered when they were not
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to open a conversation and read everything the customer sent and everything the team replied, including the customer's photos, voice notes and files
> **So that** I answer with the full context, without asking the customer to repeat themselves
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It lets every delivery and media test script Telegram's answers — accepted, blocked, 429, 5xx, a hang past the timeout, a missing or oversized file — without the network.

## Inlined context

> integration tests against the fake Bot API in `src/test/fake-telegram.ts` (extended with `sendMessage`): double submit with one client key → one `sendMessage`; a fake that hangs past the 10 s timeout → "not confirmed" and no second call; a job killed between "in flight" and the answer → re-run resolves "not confirmed"; scripted 429 then success → order kept per conversation while a second conversation delivers
>
> — `sad.md §10, QG-1 How verify, verbatim` · full text: [sad.md](../sad.md)

> `sendMessage` returns the sent message (its id) or an error with a code — 403 when the user blocked the bot or the account is deactivated, 400 "chat not found", 429 with `retry_after`, 5xx; `getFile` returns a `file_path` valid for at least one hour and refuses files over 20 MB; file bytes are downloaded from a URL that contains the bot token
>
> — `sad.md §2, Telegram Bot API behaviour, abridged` · full text: [sad.md](../sad.md)

> a media test streaming a 5 MB file from the fake Bot API
>
> — `sad.md §10, QG-3 How verify, abridged` · full text: [sad.md](../sad.md)

> A `Range` header is forwarded to Telegram's file server for seeking (sad.md §11).
>
> — `contracts/openapi.yaml, openMessageMedia, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface (test double of `sendMessage`, `getFile`, `GET /file/bot<token>/<file_path>`).

## Acceptance criteria

### AC-04 — happy path

> **Given** a conversation in "Acme Flowers", whose bot is connected, holding a photo, a sticker, a video, a voice note, an audio track, a file, a location, a shared contact and a poll from the customer
> **When** an operator opens the conversation
> **Then** the photo, sticker and video are shown in the thread, the voice note and audio can be played, the file can be downloaded under its name, the location is shown as its coordinates (and a venue's name and address) with a link that opens it in a map service only when the operator clicks it — no outside map service receives the customer's location just because the thread was opened, the shared contact as its name and phone, the poll as its question and options, and any caption is shown with its message; a message tg-inbox did not recognise is shown as "unsupported message — tg-inbox cannot show this kind yet" (marked "other", as captured); every piece of media is opened through the web panel, and nothing the panel shows or links to reveals the bot's token
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — error

> **Given** a captured photo, voice note or file in a conversation of "Acme Flowers"
> **When** an operator tries to open it while the bot is not connected or not working, or the file is larger than Telegram lets a bot download (20 MB), or Telegram no longer has it
> **Then** the thread shows the message's kind and caption with "content unavailable" and the reason in plain language (the bot is disconnected / the bot is not working — needs a new token / the file is too large to open in tg-inbox / Telegram no longer keeps this file), and the rest of the conversation stays readable
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — error

> **Given** an operator of "Acme Flowers" replying to an end customer who has blocked the bot (or deleted their Telegram account)
> **When** they send the reply
> **Then** the reply stays in the thread marked "not delivered — the customer blocked the bot" (or "the customer's Telegram account no longer exists"), the conversation keeps its "waiting for a reply" marker, and the operator understands the customer can be reached again only after they unblock the bot and write to it; the reply box stays usable, and each further reply fails the same way until the customer writes again
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — domain invariant

> **Given** an operator of "Acme Flowers" sending a reply
> **When** they press send twice quickly, lose their connection right after sending, or tg-inbox cannot learn whether Telegram accepted the reply
> **Then** the customer receives the reply at most once: a double press of one send sends one reply (two replies a member deliberately sends, even with the same text, are both sent); when the outcome is unknown the reply is marked "not confirmed — it may or may not have reached the customer" and is never resent automatically; the operator can send it again only after a warning that the customer may receive it twice — a reply is never delivered twice without a member choosing so
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — error

> **Given** an operator of "Acme Flowers" sending a reply while Telegram is temporarily unavailable or asks the bot to slow down
> **When** Telegram answers that it did not accept the reply (it is unavailable or asks the bot to slow down)
> **Then** the reply stays "sending" and tg-inbox keeps trying on its own for up to 5 minutes; within one conversation replies reach the customer in the order they were written, and a later reply waits while an earlier one of the same conversation is still sending — other conversations are not held up; if it is still not accepted, it is marked "not delivered — Telegram did not accept it, try again" with a "Try again" action that sends it once more (it then moves to the end of the thread, at the time it was sent again); a send whose answer never came back is never retried on its own — it follows AC-11 ("not confirmed")
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Add `sendMessage` with a per-call script: `ok(message_id)`, `blocked` (403), `deactivated` (403), `chatNotFound` (400), `unauthorized` (401), `tooMany(retry_after)` (429), `serverError` (5xx), `hang(ms)`, `resetAfterWrite`; record every call (chat id, text, `parse_mode`) — `apps/api/src/test/fake-telegram.ts`
- [ ] Add `getFile` (path, `file_size`, `file too big`, `file not found`) and the file download route honouring a single `Range` with `206`/`416` — `apps/api/src/test/fake-telegram.ts`
- [ ] Self-tests for each scripted answer and for a 5 MB ranged download — `apps/api/src/test/fake-telegram.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Script exhausted | falls back to `ok` with the next message id |
| `Range: bytes=0-99` on a 5 MB file | `206`, `Content-Range: bytes 0-99/5242880`, 100 bytes |
| Range beyond the end | `416` |

## Definition of Done

- [ ] fake self-tests pass for every scripted `sendMessage` answer, `getFile` outcome and ranged download
- [ ] existing bot-connection tests using the fake still pass
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
