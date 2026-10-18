---
id: T15
title: "Add the media stream to the bots gateway: getFile, size check and a ranged byte stream with typed unavailability"
layer: "infra"
deps: ["T4", "T14"]
blocks: ["T19"]
acs: ["AC-04", "AC-05"]
files_hint: ["apps/api/src/modules/bots/infra/telegram-gateway.ts", "apps/api/src/modules/bots/infra/media.int.test.ts", "apps/api/src/modules/bots/app/ports.ts", "apps/api/src/modules/bots/app/fakes.ts", "apps/api/src/modules/bots/app/open-media.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T15 — Add the media stream to the bots gateway: getFile, size check and a ranged byte stream with typed unavailability

## Place in the sequence

- **Blocked by:** T4 — Extend the fake Bot API with sendMessage, getFile and the file download, scriptable per call, T14 — Add sendMessage to the bots gateway as send text, classifying every answer into a typed outcome · **Blocks:** T19 — Add the openMessageMedia route that streams a customer's media with forced safe headers and typed unavailability · **Wave:** 3 — after T4, T14.
- **Lane:** serialized after T14 (same `telegram-gateway.ts`, `ports.ts`, `fakes.ts`).

## Why (user story)

> **As an** Operator
> **I want** to open a conversation and read everything the customer sent and everything the team replied, including the customer's photos, voice notes and files
> **So that** I answer with the full context, without asking the customer to repeat themselves
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It fetches a customer's file from Telegram on demand, through the bot, without the token or a Telegram address ever leaving the gateway.

## Inlined context

> **Customer media streamed through a guarded API route, addressed by message** — the browser asks for the media of a message it may see; the API checks membership, resolves the Telegram file reference from the captured message, and `bots` streams the bytes from Telegram's file download through the API with forced safe headers. Nothing is stored, no Telegram URL or redirect reaches the browser
>
> — `sad.md §4, choice 5, abridged` · full text: [sad.md](../sad.md)

> Unavailable content answers with a typed reason the thread renders as "content unavailable": bot disconnected, bot not working, file over 20 MB (from the captured size, or Telegram's refusal), Telegram no longer has the file. The gateway never logs or returns the download URL; the `getFile` path is cached in memory per file for less than its one-hour validity at most.
>
> — `adr/0006, Decision outcome, verbatim` · full text: [ADR-0006](../adr/0006-stream-customer-media-through-a-guarded-api-route-addressed-by-message.md)

> `getFile` 5 s, download streamed with a 30 s idle timeout
>
> — `sad.md §8, Telegram calls, abridged` · full text: [sad.md](../sad.md)

> | Media open p95 — a ≤ 5 MB file, bot connected | ≤ 3 s | request timing log on the media path |
>
> — `spec.md §6, NFR table, verbatim` · full text: [spec.md](../spec.md)

> Video seeking and long audio rely on Telegram's file server honouring byte-range requests; without it Safari may refuse to play video | Medium | Forward `Range` and verify against the real Bot API before the first pilot; fall back to a full download for video if ranges are not honoured
>
> — `sad.md §11, Risks, abridged` · full text: [sad.md](../sad.md)

> Bot tokens are secrets — encrypted at rest, never logged, never returned. Tests use the fake Bot API in `src/test/fake-telegram.ts`.
>
> — `CLAUDE.md §Rules, Telegram, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface here (served by `openMessageMedia` in T19). `openMedia({ workspaceId, fileReference, fileSize, range? })` → `stream { body, status 200|206, contentLength, contentRange? } | unavailable { reason: bot_not_connected | bot_not_working | file_too_large | file_gone } | telegram_unavailable | range_not_satisfiable`.

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

## Checklist

- [ ] Gateway `getFile` (5 s) and a streamed download of `file_path` forwarding a single `Range`, 30 s idle timeout, URL kept inside the gateway — `modules/bots/infra/telegram-gateway.ts`
- [ ] In-memory `file_path` cache per file reference, TTL < 1 h — same file
- [ ] `openMedia` use case: bot state → `bot_not_connected` / `bot_not_working`; captured size > 20 971 520 → `file_too_large` without calling Telegram; `getFile` too big → `file_too_large`; not found → `file_gone`; 5xx / timeout / 429 → `telegram_unavailable`; 416 forwarded — `modules/bots/app/open-media.ts`, `ports.ts`, `fakes.ts`
- [ ] Integration tests incl. a 5 MB stream, a ranged read and each unavailable reason; assert no token in any returned value or log — `modules/bots/infra/media.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Captured `file_size` 21 MB | `file_too_large` without a Telegram call |
| Telegram answers file not found | `file_gone` |
| Bot `needs_token` | `bot_not_working` |
| `getFile` times out | `telegram_unavailable` (→ 503) |
| Range beyond the end | `range_not_satisfiable` (→ 416) |

## Definition of Done

- [ ] integration tests prove a 5 MB stream, a ranged 206 read and every unavailable reason against the fake Bot API
- [ ] no returned value, error or log line contains the token or the download URL
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
