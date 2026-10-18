---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: "M"
ticket: "roadmap step 4 — shared-inbox"
---

# 0006 — Stream customer media through a guarded API route, addressed by message

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

Members must see, play or download the customer's photos, stickers, videos, voice notes, audio and files (AC-04), with plain-language reasons when content cannot be opened (AC-05). tg-inbox keeps no copies (spec §3): media is fetched from Telegram each time, while the same bot is connected, within Telegram's 20 MB bot download limit. Telegram's file download URL contains the bot token, so it must never reach the browser (spec §6 token exposure; §6.1 abuse case). Serving customer-supplied bytes from the panel's own origin also opens a script-injection path if a file is ever rendered as a page.

## Decision drivers

- Spec §6: media open p95 ≤ 3 s for a ≤ 5 MB file; 0 bot-token occurrences in anything the panel receives or in logs.
- Spec §6.1: confidential data; cross-tenant media read refused without a hint; markup in file names shown as plain text.
- Spec §3 non-goal: no stored copies of media.
- Module rules: only `bots` holds and uses the token.

## Considered options

1. **Stream through the API, addressed by message** — the browser requests the media of a message id inside a conversation it may see; the API resolves the Telegram file reference from the captured message, `bots` calls `getFile` and pipes the download through the API, forwarding byte-range requests.
2. **Buffer then serve** — the API downloads the whole file (≤ 20 MB) into memory, then answers.
3. **Proxy addressed by Telegram file id** — the browser receives each message's `file_id` and asks the API for that file id.

## Decision outcome

**Chosen:** Option 1. Streaming keeps memory flat and first bytes fast (option 2 holds up to 20 MB per open and delays playback); addressing by message means every media request passes the same guard and conversation scoping as the thread itself, and Telegram's file ids never become a browser-visible handle that could be replayed across workspaces (option 3).

Rules: responses carry a content type chosen from the message kind (an allow-list of image, video and audio types; everything else `application/octet-stream`), `Content-Disposition: attachment` with the captured file name for documents (inline only for the allow-listed kinds), `X-Content-Type-Options: nosniff`, a sandboxing `Content-Security-Policy`, and `Cache-Control: private, no-store`. Unavailable content answers with a typed reason the thread renders as "content unavailable": bot disconnected, bot not working, file over 20 MB (from the captured size, or Telegram's refusal), Telegram no longer has the file. The gateway never logs or returns the download URL; the `getFile` path is cached in memory per file for less than its one-hour validity at most.

## Consequences

**Positive**
- The token stays inside `bots` infra; media access is exactly as scoped as the thread.
- No storage, retention or deletion rules (spec §3).

**Negative**
- Every open costs a `getFile` and a download through our process; a popular video re-downloads each time.
- Video seeking depends on Telegram's file server honouring byte ranges (§11).

**Neutral**
- Adding a short-lived cache or stored copies later changes only the `bots` media adapter.

## Links

- Spec: [[../spec.md]] AC-04, AC-05, AC-08; §3; §6; §6.1
- UX flows: [[../ux-flows.md]] flow US-02 (SCR-03 media viewer)
- SAD: [[../sad.md]] §4, §6, §8, §11
- Related ADR: [[0007-add-an-inbox-module-that-orchestrates-conversations-contacts-bots-and-workspaces]]
