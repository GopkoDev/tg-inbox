---
id: T19
title: "Add the openMessageMedia route that streams a customer's media with forced safe headers and typed unavailability"
layer: "ports"
deps: ["T9", "T15", "T16"]
blocks: ["T21"]
acs: ["AC-04", "AC-05", "AC-08"]
files_hint: ["apps/api/src/modules/inbox/app/open-media.ts", "apps/api/src/modules/inbox/http/routes.ts", "apps/api/src/modules/inbox/http/media.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T19 — Add the openMessageMedia route that streams a customer's media with forced safe headers and typed unavailability

## Place in the sequence

- **Blocked by:** T9 — Build the conversations read side: list page with unread counts, summary, thread page, single items, media reference and mark read, T15 — Add the media stream to the bots gateway: getFile, size check and a ranged byte stream with typed unavailability, T16 — Create the inbox module with its read use cases and routes (list, search, conversation, thread, items, mark read, bot status) and wire it into buildDeps and buildApp · **Blocks:** T21 — Add the API end-to-end inbox stories and extend the token-secrecy suite to inbox responses, media, socket frames and logs · **Wave:** 6 — after T9, T15, T16.
- **Lane:** shares `modules/inbox/http/routes.ts` with T16, T17, T20 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to open a conversation and read everything the customer sent and everything the team replied, including the customer's photos, voice notes and files
> **So that** I answer with the full context, without asking the customer to repeat themselves
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It is the only way the panel gets a customer's photo, voice note or file — guarded like the thread, with no Telegram address in sight.

## Inlined context

> Rules: responses carry a content type chosen from the message kind (an allow-list of image, video and audio types; everything else `application/octet-stream`), `Content-Disposition: attachment` with the captured file name for documents (inline only for the allow-listed kinds), `X-Content-Type-Options: nosniff`, a sandboxing `Content-Security-Policy`, and `Cache-Control: private, no-store`.
>
> — `adr/0006, Decision outcome, verbatim` · full text: [ADR-0006](../adr/0006-stream-customer-media-through-a-guarded-api-route-addressed-by-message.md)

> Http->>Http: guard the workspace
> Http->>Inbox: open media for this member
> Inbox->>Conv: media reference of the message in this workspace
> alt no such message in this workspace
>     Conv-->>Inbox: not found
>     Inbox-->>Web: not found, no hint it exists
>
> — `sad.md §6, critical flow 3, abridged` · full text: [sad.md](../sad.md)

> Customer text, captions, names, file names, poll and venue text and reply texts are rendered as plain text (React escaping, no HTML rendering, links only as plain-text map links built by us from coordinates); replies go to Telegram without `parse_mode`; media served with an allow-listed content type, `nosniff`, a sandboxing CSP and `attachment` for documents
>
> — `sad.md §8, Untrusted content, verbatim` · full text: [sad.md](../sad.md)

> Bot tokens are secrets — encrypted at rest, never logged, never returned. Tests use the fake Bot API in `src/test/fake-telegram.ts`.
>
> — `CLAUDE.md §Rules, Telegram, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> Everything under `/api/workspaces/:workspaceId/…` behind the `workspaces` guard — another workspace's account → not found with no hint, deactivated → `ACCESS_REMOVED`, signed out → sign in (AC-08); both roles have the same inbox rights
>
> — `sad.md §8, Authorization, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `GET …/conversations/{conversationId}/messages/{messageId}/media` (`openMessageMedia`, optional `Range: bytes=…` ≤ 100 chars) → `200` or `206` byte stream with `Content-Type` (allow-list by kind, never Telegram's), `Content-Disposition` (`inline` for allow-listed kinds; `attachment; filename*=UTF-8''…` for documents and anything else), `Content-Length`, `Accept-Ranges: bytes` / `Content-Range`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: private, no-store`.
- `404 NOT_FOUND` — no such message in this conversation of this workspace, or a kind with no file.
- `409 MEDIA_UNAVAILABLE` `details.reason`: `bot_not_connected` · `bot_not_working` · `file_too_large` · `file_gone`.
- `416` (empty body), `503 TELEGRAM_UNAVAILABLE`, `400`/`401`/`403`.

— `contracts/openapi.yaml, openMessageMedia, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

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

### AC-08 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member of "Acme Flowers", or someone not signed in
> **When** they try to open the inbox of "Acme Flowers", one of its conversations or one of its customers' media, or to send a reply in it (for example through a saved link)
> **Then** the system refuses and shows no conversation, message, media or customer of "Acme Flowers"; an account of another workspace gets no hint that the workspace or the conversation exists; a deactivated member gets the access-removed notice they already get elsewhere in the panel (they know the workspace, but see nothing of it); someone not signed in is asked to sign in first; nothing is sent to any end customer
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `openMessageMedia` use case: `conversations` media reference (T9) → `bots.openMedia` (T15) → stream or typed refusal — `modules/inbox/app/open-media.ts`
- [ ] Route: Range header schema, forced headers, stream piping with abort on client disconnect — `modules/inbox/http/routes.ts`
- [ ] `app.inject` tests: photo inline with image type, document as attachment with an RFC 5987 file name, 206 range, every 409 reason, 416, 503, kind without file → 404, foreign message → 404, deactivated → 403, and no token / Telegram URL in any header or body — `modules/inbox/http/media.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| File name with quotes or `<script>` | encoded in `filename*`, never interpreted |
| Telegram declares `text/html` for a document | served as `application/octet-stream`, `attachment` |
| Message of another workspace's conversation | `404`, same body as unknown |
| Client aborts mid-stream | upstream download aborted |

## Definition of Done

- [ ] route tests prove the forced headers per kind, ranged reads, every unavailable reason, 404 / 403 guarding and the absence of the token and any Telegram URL
- [ ] media open of a 5 MB file under 3 s against the fake (timed in the test)
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
