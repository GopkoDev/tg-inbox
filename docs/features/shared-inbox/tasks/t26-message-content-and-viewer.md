---
id: T26
title: "Build MessageContent for every message kind with media fetched through the API client, and SCR-03, the media viewer"
layer: "ui"
deps: ["T25"]
blocks: ["T22", "T28"]
acs: ["AC-04", "AC-05"]
files_hint: ["apps/web/src/features/inbox/MessageContent.tsx", "apps/web/src/features/inbox/MessageContent.test.tsx", "apps/web/src/features/inbox/MediaViewer.tsx", "apps/web/src/features/inbox/MediaViewer.test.tsx", "apps/web/src/features/inbox/media.ts", "apps/web/src/features/inbox/MessageBubble.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T26 — Build MessageContent for every message kind with media fetched through the API client, and SCR-03, the media viewer

## Place in the sequence

- **Blocked by:** T25 — Build SCR-02's reading side: thread header, paged history, mark read when visible, live items, edits, late redeliveries and phone layout · **Blocks:** T22 — Update CLAUDE.md, the architecture map and the design-system canon for the inbox module, platform/realtime, the delivery queue and the new components, T28 — Build ReplyDeliveryState with Try again and Send again, and SCR-05, the duplicate-risk confirmation · **Wave:** 4 — after T25.
- **Lane:** shares `MessageBubble.tsx` with T25 and T28 — serialized after T25.

## Why (user story)

> **As an** Operator
> **I want** to open a conversation and read everything the customer sent and everything the team replied, including the customer's photos, voice notes and files
> **So that** I answer with the full context, without asking the customer to repeat themselves
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It shows the customer's photos, voice notes, files, locations, contacts and polls in the thread — and says plainly when something cannot be opened.

## Inlined context

> | content: photo / sticker / video / animation / video note | shown in the bubble, fetched through `openMessageMedia` with the API client (never a Telegram address); photo and video open SCR-03 on click; sticker per Decision 3; caption under it (AC-04) |
> | content: voice / audio | inline audio player (play, pause, seek — `Range` forwarded); caption under it (AC-04) |
> | content: file | file row: icon, captured file name (or «File»), size; **Download** saves it under that name (`Content-Disposition: attachment`) (AC-04) |
> | content: location / venue | «Location» + coordinates (venue: its title and address first) + **Open in map** — an external link built from the coordinates, `target="_blank" rel="noopener noreferrer"`; no map image, nothing is loaded from a map service until the click (AC-04) |
> | content: contact / poll / dice | contact: «Contact» + name + phone; poll: «Poll» + question + options as a plain list; dice: «Dice» (AC-04) |
> | content: unsupported | kind `other` — «Unsupported message — tg-inbox cannot show this kind yet» (AC-04) |
>
> — `screens.md §SCR-02, content rows, verbatim` · full text: [screens.md](../screens.md)

> | content: unavailable | `openMessageMedia` `409 MEDIA_UNAVAILABLE` — the kind and caption + «Content unavailable — » and the reason by `details.reason`: `bot_not_connected` «the bot is disconnected», `bot_not_working` «the bot is not working — it needs a new token», `file_too_large` «the file is too large to open in tg-inbox», `file_gone` «Telegram no longer keeps this file»; the rest of the thread stays readable (AC-05; flow 3) |
> | content: Telegram not responding | `openMessageMedia` `503 TELEGRAM_UNAVAILABLE` (or `416` on a seek) — «Telegram is not responding — try again» + **Try again** on that message only (contract `TelegramUnavailable`) |
>
> — `screens.md §SCR-02, content rows, verbatim` · full text: [screens.md](../screens.md)

> **Stickers by type:** `image/webp` → shown as an image; `video/webm` → a muted looping video; animated `.tgs` (`application/x-tgsticker`) or no type → the kind label «Sticker» (+ caption). […] `animation` plays as a muted looping video, `video_note` as a round video, `dice` shows the kind label «Dice».
>
> — `screens.md §Source, Decision 3, abridged` · full text: [screens.md](../screens.md)

> SCR-03 — default: photo (`Dialog`, full size fit to viewport, header = contact name + time, caption; ✕ / Esc / backdrop; focus returns to the photo) · default: video (player, seek; the inline player pauses) · loading (skeleton) · error (`503`/`416` → «Telegram is not responding — try again» + **Try again**; `409` → the SCR-02 «Content unavailable — <reason>» text) · a `403` closes the dialog with the rest of the workspace.
>
> — `screens.md §SCR-03, abridged` · full text: [screens.md](../screens.md)

> Because the error is JSON, the panel fetches media with the API client and checks the status before it shows the bytes.
>
> — `contracts/openapi.yaml, openMessageMedia, verbatim` · full text: [openapi.yaml](../contracts/openapi.yaml)

> Customer text, captions, names, file names, poll and venue text and reply texts are rendered as plain text (React escaping, no HTML rendering, links only as plain-text map links built by us from coordinates); replies go to Telegram without `parse_mode`; media served with an allow-listed content type, `nosniff`, a sandboxing CSP and `attachment` for documents
>
> — `sad.md §8, Untrusted content, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

`GET …/messages/{messageId}/media` (`openMessageMedia`) fetched with the API client into an object URL (revoked on unmount); `409 MEDIA_UNAVAILABLE` `details.reason`, `503 TELEGRAM_UNAVAILABLE`, `416`, `403`. Message fields from `ThreadMessage`: `kind`, `body`, `attachment {file_name, mime_type, file_size}`, `location {latitude, longitude, venue}`, `shared_contact`, `poll`. — `contracts/openapi.yaml, abridged`

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

- [ ] `media.ts`: fetch media via the client, map 409 reasons / 503 / 416 to view states, object-URL lifecycle — `features/inbox/media.ts`
- [ ] `MessageContent` for all 15 kinds + caption, loading skeleton, unavailable and not-responding variants with **Try again** — `features/inbox/MessageContent.tsx`
- [ ] Plug `MessageContent` into the inbound `MessageBubble` slot — `features/inbox/MessageBubble.tsx`
- [ ] `MediaViewer` (`Dialog`) for photo and video — `features/inbox/MediaViewer.tsx`
- [ ] Tests: each kind, each unavailable reason, map link only on click (no request before), file download name, viewer open/close/focus — `features/inbox/MessageContent.test.tsx`, `MediaViewer.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| Location message rendered | no request to any map service until **Open in map** is clicked |
| File name `<img onerror>` | shown as text |
| Media 409 `file_gone` | «Content unavailable — Telegram no longer keeps this file»; rest of thread readable |
| Animated `.tgs` sticker | kind label «Sticker» |

## Definition of Done

- [ ] Testing Library tests cover every content row of SCR-02 and every SCR-03 state
- [ ] no `<img>`/`<video>`/`<audio>` `src` ever points outside our origin's media route (asserted)
- [ ] web lint + typecheck clean
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
