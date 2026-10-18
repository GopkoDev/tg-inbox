---
status: Draft
owner: "Dmytro Hopko"
updated_at: "2026-10-18"
feature_size: M
---

# API sync report — shared-inbox

This report is derived from these inputs:
- `data-model.md`, plus the staged `migrations/01–10`;
- the existing schema: `contacts`, `messages`, `bots`, `accounts`;
- `sad.md` §6 flows 1–10;
- `spec.md` §4/§5;
- feature ADR-0001…0008.

Size **M**, route **standard** (from `.size` / `.route`).

**Contract forms** (from `sad.md` `target_surfaces: [backend-service, web-frontend]`):

- `backend-service` → [`openapi.yaml`](openapi.yaml) has 11 operations in OpenAPI 3.1. `redocly lint` (1.34.5) reports it valid, with 2 warnings, both accepted:
  - no `info.license`, as in workspace-operators and bot-connection;
  - `openLiveSocket` has no `2XX`, because a WebSocket upgrade answers `101`.
- `backend-service` (async) → [`events.md`](events.md) covers three things:
  - the live socket frames (the panel's async contract);
  - the `NOTIFY realtime` signals;
  - the `inbox.deliver-replies` queue and its dead letter.
- `web-frontend` consumes both. It does not author a contract.

**Operations**

| operationId | Method + path (under `/api/workspaces/{workspaceId}/inbox`) | Flows | US |
|---|---|---|---|
| `listConversations` | `GET /conversations` | 4, 2 | US-01 |
| `getConversation` | `GET /conversations/{conversationId}` | 5, 2 | US-01, US-02 |
| `listThreadItems` | `GET /conversations/{conversationId}/items` | 5 | US-02 |
| `getThreadMessage` | `GET /conversations/{conversationId}/messages/{messageId}` | 2, 10 | US-06 |
| `openMessageMedia` | `GET /conversations/{conversationId}/messages/{messageId}/media` | 3 | US-02 |
| `markConversationRead` | `POST /conversations/{conversationId}/read` | 5, 2 | US-02, US-06 |
| `sendReply` | `POST /conversations/{conversationId}/replies` | 1, 6 | US-03, US-04, US-06 |
| `getThreadReply` | `GET /conversations/{conversationId}/replies/{replyId}` | 1, 2, 9 | US-05, US-06 |
| `resendReply` | `POST /conversations/{conversationId}/replies/{replyId}/resend` | 7 | US-05 |
| `getInboxBotStatus` | `GET /bot` | 4, 8 | US-07 |
| `openLiveSocket` | `GET /live` (WebSocket upgrade) | 2, 8, 10 | US-06, US-01, US-07 |

## Deviations from the api-skill defaults

| Default | Contract | Authority |
|---|---|---|
| `BearerAuth` global | `SessionCookie` global, which the socket upgrade uses too, plus an `Origin` check | workspace-operators ADR-0002; feature ADR-0002 |
| `/api/v1/…` URL versioning | `/api/workspaces/{workspaceId}/inbox/…` | workspace-operators ADR-0003, ADR-0004 |
| Envelope `{code, message, details?}`, code `module.error_name` | `{ "error": { code, message, details? } }`, code UPPER_SNAKE in `ErrorCode` | repo convention (`CLAUDE.md`, `packages/shared/src/errors.ts`), precedents |
| `Idempotency-Key` header on a mutating operation with an async actor | `sendReply`: `client_key` in the body, unique per conversation, kept as long as the reply (no TTL). `resendReply`: idempotent by state (a second press gets `409 REPLY_NOT_RESENDABLE`). `markConversationRead`: `GREATEST`, so repeats are harmless | data-model `replies_conversation_id_client_key_key`; ADR-0004 |
| Cursor `?after=&before=` as `uuid` | an opaque string cursor. The list has `after` only (newest first, forward only), and the thread has `before` and `after` | keyset over two columns: (`last_activity_at`, `id`), and (position time, type, tie-break, `id`) per ADR-0008 |
| Page wrapper `{items, has_next, has_prev, next_cursor}` | the same, plus `workspace_id`. The thread adds `prev_cursor`, `conversation_id` and `read_through_at` | AC-09/AC-18 workspace tagging (flows 4, 5); ADR-0005 server-issued watermark |

## A. Field origins

Confidence:
- **high**: a column, or a data-model/ADR rule, with a matching type and constraint.
- **medium**: projected from the `messages.telegram_message` jsonb, or a contract choice derived from a spec/ADR statement.
- **low**: inferred from a message name only. None here.

| schema_path | origin | confidence |
|---|---|---|
| *.workspaceId (path) | workspace-operators guard → `workspaces.id` | high |
| *.conversationId / messageId / replyId (path) | `conversations.id` / `messages.id` / `replies.id`, looked up with `workspace_id` (sad.md §8 *Tenancy*) | high |
| *.workspace_id (bodies) | each row's `workspace_id`. The page carries the request's workspace (flows 4, 5 "tagged with the workspace id") | high |
| listConversations.q | sad.md §4 "Search through contacts" + AC-02 (trim, leading `@`, case-folded, anywhere in "first + space + last" or username). maxLength 200 is a contract choice, because no column bounds it | medium |
| listConversations.after / next_cursor | data-model `conversations_workspace_id_last_activity_at_idx` keyset (`last_activity_at`, `id`) | high |
| *.limit | contract convention (1–100, default 50). Spec §6 sizes the first page only by its latency | medium |
| Conversation.id | `conversations.id` | high |
| Conversation.contact.id / first_name / last_name / username | existing schema — `1791681109980_create_contacts` (`id`, `first_name` NOT NULL, `last_name` NULL, `username` NULL), through the `contacts` app layer. No length CHECK (bot-connection: Telegram strings) | high |
| Conversation.last_activity_at | data-model → `conversations.last_activity_at` (NOT NULL after `10`) | high |
| Conversation.last_item | data-model "Last item shown in the row": the newest message by arrival (`messages_conversation_id_received_at_idx`) versus the newest sent reply (`replies_conversation_id_position_at_idx`) | high |
| LastMessageItem.kind / body | existing schema — `1791681109982_create_messages` (`kind` CHECK 15 values; `body` text or caption, NULL) | high |
| LastReplyItem.body | data-model → `replies.body` | high |
| Conversation.unread_count | data-model rule: `received_at > GREATEST(read_marks.read_through_at, memberships.active_since)` (ADR-0005) | high |
| Conversation.waiting_for_reply | data-model rule: `last_reply_sent_at IS NULL OR last_message_received_at > last_reply_sent_at` | high |
| listThreadItems.before / after / prev_cursor / next_cursor | data-model `messages_conversation_id_sent_at_idx` (`sent_at`, `telegram_message_id`) ∪ `replies_conversation_id_position_at_idx` (`position_at`, `id`); ADR-0008 cursor (position time, kind, id) | high |
| ThreadPage.has_prev / has_next | derived (cursor wrapper convention) | high |
| ThreadPage.read_through_at | ADR-0005 "the server issues the cursor" + data-model `conversations.last_message_received_at` (read in the page's snapshot) | high |
| ThreadMessage.id / kind / body / sent_at / received_at / edited_at | existing schema — `1791681109982_create_messages` (`edited_at` NULL; `sent_at`, `received_at` NOT NULL) | high |
| ThreadMessage.attachment.file_name / mime_type / file_size | existing schema — `messages.telegram_message` jsonb (Telegram `Message`: `document` / `audio` / `video` / `voice` / `animation` / `video_note` / `sticker` / the largest `photo` size → `file_name`, `mime_type`, `file_size`). The 20 MB rule comes from ADR-0006 | medium |
| ThreadMessage.location.latitude / longitude / venue.title / venue.address | existing schema — `messages.telegram_message` jsonb (`location`, `venue`) per AC-04 | medium |
| ThreadMessage.shared_contact.* | existing schema — `messages.telegram_message` jsonb (`contact.first_name`, `last_name`, `phone_number`) per AC-04 | medium |
| ThreadMessage.poll.question / options | existing schema — `messages.telegram_message` jsonb (`poll.question`, `poll.options[].text`) per AC-04 | medium |
| ThreadReply.id / client_key / body / state / failure_reason / position_at / sent_at / created_at | data-model → `replies.*` (body CHECK 1–4096 + `\S`; state CHECK 4 values; failure_reason CHECK 7 values, non-null ⇔ `not_delivered`; sent_at non-null ⇔ `sent`) | high |
| ThreadReply.author.account_id | data-model → `replies.author_account_id` | high |
| MemberRef.display_name | existing schema — `1791681109972_create_accounts` `display_name` (CHECK 1–200 after trim), through the `workspaces` app layer (sad.md §5 "member display names") | high |
| ReplySend.client_key | data-model → `replies.client_key` (uuid, UNIQUE per conversation) | high |
| ReplySend.body | data-model → `replies.body` | high |
| ReplySend.last_seen_reply_id | data-model "Teammate check: another author's reply after the one the composer saw" (`replies_conversation_id_position_at_idx`); sad.md §4 *Stateless teammate-collision check*. The **name** is this contract's choice | high |
| ReplySend.confirm_teammate_reply | sad.md §4 "send anyway repeats the send with an explicit confirmation flag". The **name** is this contract's choice | medium |
| ReplyResend.confirm_duplicate_risk | sad.md §4 "Send again needs an explicit confirmation flag". The **name** is this contract's choice | medium |
| ReadMarkRequest.read_through_at / ReadState.read_through_at | data-model → `read_marks.read_through_at` (`GREATEST` upsert) | high |
| ReadState.unread_count | the same rule as Conversation.unread_count | high |
| InboxBotStatus.state | existing schema — `1791681109979_create_bots` `state` CHECK (`connected`, `needs_token`, `taken_over`, `disconnected`); `disconnected` and no row → `not_connected` (bot-connection `BotSettings` precedent) | high |
| InboxBotStatus.can_reply / receiving | sad.md §4 "Bot state for every member" ("can carry replies / is receiving") + AC-13/AC-14: derived from `state` | medium |
| TeammateRepliedError.details.reply.* | data-model → `replies.id`, `author_account_id` (+ display name), `position_at`; sad.md §8 "teammate replied (with who / when)" | high |
| ReplyLimitReachedError.details.retry_at | data-model → `reply_attempts.created_at` of the oldest counted attempt + 60 s; sad.md §4 "the refusal says when the oldest of the 30 leaves the window" | high |
| ReplyLimitReachedError.details.limit / window_seconds | spec AC-12b, §6 (30 per rolling 60 s) | high |
| MediaUnavailableError.details.reason | ADR-0006 "bot disconnected, bot not working, file over 20 MB, Telegram no longer has the file"; AC-05 | high |
| ReplyNotResendableError.details.reply | `ThreadReply` (data-model `replies`) | high |
| openMessageMedia headers | ADR-0006 rules (allow-list, `nosniff`, sandbox CSP, `private, no-store`, `attachment` for documents) | high |
| openMessageMedia.Range | ADR-0006 "forwarding byte-range requests"; sad.md §11 | high |
| events.md socket frame fields | sad.md §8 *Events* (`conversation.changed`: conversation id, item kind + id, change created / edited / state / read; `bot.changed`; `membership.deactivated`) | high |
| events.md `resync` frame, close codes 4401 / 4403 | ADR-0003 "tells every socket to resynchronise"; ADR-0002 "close with an access removed reason". The codes are this contract's choice | medium |
| events.md `inbox.deliver-replies` payload / options | sad.md §7, §8 *Jobs* (`stately`, singleton = conversation id, `retryLimit` 3, expiry 60 s, polling 0.5 s) | high |

**Fields in `data-model.md` with no contract field** (accepted, internal):
- `reply_attempts.*` is the delivery log and limit counter, never shown to the panel. The limit surfaces only as `retry_at`.
- `memberships.active_since` is folded into `unread_count`.
- `conversations.last_message_received_at` / `last_reply_sent_at` are folded into `waiting_for_reply` and `read_through_at`.
- `replies.telegram_message_id` is Telegram's id. Nothing in the panel needs it.

None of them needs an `# unused-in-spec` flag, because each one serves an AC through a derived field.

## B. Drift findings (4-point checklist)

1. **Endpoint ↔ data-model** *(core)* — ✓.
   - The reads cover `conversations`, `messages`, `replies`, `read_marks` and `memberships` (unread floor), plus `contacts` and `bots` (existing schema).
   - `sendReply` / `resendReply` write `replies` + `reply_attempts` + the drain job.
   - `markConversationRead` writes `read_marks`.
   - `openLiveSocket` reads `memberships` and sessions.
   - `openMessageMedia` reads `messages.telegram_message` and `bots`.
   - No operation touches a table outside its owning module's app layer (ADR-0007).
2. **Error code ↔ repo error definition** *(core)* — ✓ with additions. The registry is `ErrorCode` in `packages/shared/src/errors.ts` (+ `AppError` subclasses in `apps/api/src/platform/errors.ts`).
   - **Existing codes used:** `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `ACCESS_REMOVED`, `NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `INTERNAL_ERROR`, `TELEGRAM_UNAVAILABLE`.
   - **New codes proposed by this contract** (to register in `tasks`, as bot-connection did):

   | Code | Status | `AppError` base (sad.md §8 *Error handling*) | Raised by |
   |---|---|---|---|
   | `BOT_CANNOT_REPLY` | 409 | `ConflictError` family | `sendReply`, `resendReply` |
   | `TEAMMATE_REPLIED` | 409 | `ConflictError` family | `sendReply` |
   | `DUPLICATE_RISK_CONFIRMATION_REQUIRED` | 409 | `ConflictError` family | `resendReply` |
   | `REPLY_NOT_RESENDABLE` | 409 | `ConflictError` family | `resendReply` |
   | `MEDIA_UNAVAILABLE` | 409 | `ConflictError` family (a typed answer, sad.md §8) | `openMessageMedia` |
   | `REPLY_LIMIT_REACHED` | 429 | `TooManyRequestsError` family, a specific-code subclass (the base code `TOO_MANY_ATTEMPTS` is the sign-in lockout) | `sendReply`, `resendReply` |

3. **Validation ↔ constraint** *(core)* — ✓.
   - `ReplyBody`: `minLength 1`, `maxLength 4096` and `pattern \S` = `replies_body` CHECK (`char_length BETWEEN 1 AND 4096 AND body ~ '\S'`). The domain's UTF-16 check is stricter than the schema's code-point count, and the stricter one wins at runtime. This matches data-model.
   - `ReplyState` and `ReplyFailureReason` enums = the `replies` CHECK lists (7 reasons, including `delivery_interrupted` — OQ-2).
   - `MessageKind` = `messages_kind_check` (15 values).
   - `InboxBotStatus.state` = `bots_state_check`, with `disconnected` mapped to `not_connected`.
   - `MemberRef.display_name` 1–200 = `accounts_display_name_length_check`.
   - The nullability of `failure_reason` / `sent_at` follows the data-model's ⇔ CHECKs. `client_key` uuid = column type.
   - No spec ↔ model contradiction.
4. **OpenAPI ↔ sequence** *(supporting)* — ✓, with notes N1–N6 below and the one sequence gap recorded as OQ-1.

**Every §6 `alt`-branch → response**

| Flow · branch | Response |
|---|---|
| 1 · bot not connected or needs a new token | sendReply → 409 `BOT_CANNOT_REPLY` |
| 1 · same client key already stored | sendReply → 200 (existing reply) |
| 1 · 30 member-initiated sends in 60 s | sendReply → 429 `REPLY_LIMIT_REACHED` |
| 1 · teammate replied, no confirmation flag | sendReply → 409 `TEAMMATE_REPLIED` |
| 1 · accepted | sendReply → 201 |
| 1 · panel rejects empty / blank / over 4096 | sendReply → 400 `VALIDATION_ERROR` (server-side mirror of the panel's check) |
| 1 · drain: accepted / refused permanently / not accepted ≤ 5 min / > 5 min / unknown | reply `state` + `failure_reason` (events.md outcome table), seen through `getThreadReply` |
| 2 · signal → refetch row and item | `getConversation`, `getThreadMessage` / `getThreadReply` |
| 2 · opt thread visible → mark read | `markConversationRead` |
| 2 · member deactivated | socket close `4403`; the next request → 403 `ACCESS_REMOVED` |
| 2 · workspace switch | client closes (`1000`) and opens `openLiveSocket` for the other workspace |
| 3 · no such message in this workspace | openMessageMedia → 404 `NOT_FOUND` |
| 3 · bot disconnected / not working / file over 20 MB | openMessageMedia → 409 `MEDIA_UNAVAILABLE` (`bot_not_connected` / `bot_not_working` / `file_too_large`) |
| 3 · Telegram no longer has the file / refuses its size | 409 `MEDIA_UNAVAILABLE` (`file_gone` / `file_too_large`) |
| 3 · byte stream | openMessageMedia → 200 / 206 |
| 4 · not signed in / another workspace / deactivated | 401 `UNAUTHENTICATED` / 404 `NOT_FOUND` / 403 `ACCESS_REMOVED` (every operation) |
| 4 · active member → page | listConversations → 200 |
| 4 · empty states (no conversations + bot connected / no bot + owner) | listConversations 200 with empty `items` + `getInboxBotStatus` |
| 4 · search: nothing matches / some match | listConversations `q` → 200 (empty / filtered) |
| 5 · guard branches | as flow 4 |
| 5 · no such conversation | getConversation / listThreadItems → 404 `NOT_FOUND` |
| 5 · found → latest page, older pages loop | listThreadItems (no cursor / `before`) |
| 5 · opt visible → mark read | markConversationRead → 200 |
| 6 · no newer teammate reply | sendReply → 201 |
| 6 · R2 newer → refused | sendReply → 409 `TEAMMATE_REPLIED` |
| 6 · keep editing | client only (takes `details.reply.id` as `last_seen_reply_id`) |
| 6 · send anyway | sendReply with `confirm_teammate_reply: true` → 201 |
| 7 · Try again / Send again | resendReply `{}` / `{confirm_duplicate_risk: true}` |
| 7 · 30 in window | resendReply → 429 `REPLY_LIMIT_REACHED` |
| 7 · not confirmed, no confirmation | resendReply → 409 `DUPLICATE_RISK_CONFIRMATION_REQUIRED` |
| 7 · bot cannot carry replies | resendReply → 409 `BOT_CANNOT_REPLY` |
| 7 · accepted | resendReply → 200 |
| 8 · token refused / taken over / fixed | `bot.changed` frame → getInboxBotStatus 200 (`needs_token` / `taken_over` / `connected`) |
| 9 · stale in-flight → not confirmed; author deactivated; bot not working; send outcomes | events.md `inbox.deliver-replies` work + outcome table |
| 9 · job re-runs exhausted | events.md dead-letter (OQ-2) |
| 10 · already captured / edit / late redelivery / capture fails | bot-connection `receiveTelegramUpdate` (unchanged) + `conversation.changed` frame (`edited` / `created`) → getThreadMessage |

**Supporting notes** (follow-ups, not blockers):

- **N1. Flow 1 checks the bot before the client key** (resolved: *Accept*, keep flow 1's order).
  - The rare case: the first press stored the reply, then the bot broke before a second press. That second press gets `409 BOT_CANNOT_REPLY`, not the stored reply.
  - Nothing is sent twice. The panel re-reads the thread after any refusal and finds the reply by its `client_key`.
- **N2. Transient Telegram failures on the media path** are not drawn in flow 3. These are a `getFile` / download timeout, a 5xx or a 429.
  - The contract answers `503 TELEGRAM_UNAVAILABLE`, the existing code, as bot-connection's N1.
  - A `416` from the file server is forwarded. Both are cosmetic for `sequences`, and no Open Question is raised.
- **N3. The guard branches (401 / 403 / 404)** are drawn in flows 4 and 5 only.
  - They apply to every operation and to the socket upgrade (sad.md §8 *Authorization*), as in the precedents.
  - The socket's `Origin` refusal (`403 FORBIDDEN`) comes from sad.md §8 *Authentication*, not from a flow.
- **N4. The bot state is a separate read.** Flow 4 draws the bot state being read with the list page. The contract reads it with `getInboxBotStatus` (flow 8's "read the inbox bot status"), so a `bot.changed` frame re-reads one small resource and the list stays a pure conversation read. The panel calls both on open. This is the same data and the same flow outcome.
- **N5. Any member may resend, and any `not_delivered` reason is accepted by `resendReply`.**
  - The spec does not limit Try again or Send again to the author. The reply keeps its `author_account_id`, and the attempt row records the presser (`initiated_by_account_id`), who is counted by the limit.
  - The drain's pre-checks end a resend again if its cause still holds. A deactivated author's reply therefore never goes out, even when a teammate resends it (AC-09).
  - Which states show the button is for `screens`. AC-12 names `telegram_not_accepted`, and flow 9 names `delivery_interrupted`.
- **N6. A `markConversationRead` time later than the newest arrival** is clamped to that arrival. This keeps a client clock from marking future messages read (ADR-0005 "the server issues the cursor").

## Back-feed (coverage cross-check)

- **Every §5 AC maps to ≥1 operation or response:** ✓.
  - AC-01 → listConversations (order, `last_item`, `unread_count`, `waiting_for_reply`); both roles have the same access.
  - AC-02 → listConversations `q` + empty `items` + getInboxBotStatus.
  - AC-03 → getConversation + listThreadItems (latest page, `before`) + markConversationRead + 404.
  - AC-04 → ThreadMessage (`attachment`, `location`, `shared_contact`, `poll`, `other`) + openMessageMedia.
  - AC-05 → openMessageMedia 409 `MEDIA_UNAVAILABLE`.
  - AC-06 → sendReply 201 + `state` frames.
  - AC-07 → sendReply 400.
  - AC-08 → 401 / 403 / 404 on every operation and the socket.
  - AC-09 → socket close `4403` + the 5 s re-check + `author_access_removed`.
  - AC-10 → `customer_blocked` / `customer_account_gone`.
  - AC-11 → `client_key` 200 + `not_confirmed` + resendReply `confirm_duplicate_risk`.
  - AC-12 → drain retry + `telegram_not_accepted` + resendReply.
  - AC-12b → 429 `REPLY_LIMIT_REACHED`.
  - AC-13 → 409 `BOT_CANNOT_REPLY` + `bot_not_working` + `bot.changed`.
  - AC-14 → InboxBotStatus `receiving: false`.
  - AC-15 → `conversation.changed` frames + getThreadMessage (`edited_at`, `received_at`).
  - AC-16 → 409 `TEAMMATE_REPLIED` + `confirm_teammate_reply`.
  - AC-17 → sendReply (plain text, the workspace's own bot, no author in the text).
  - AC-18 → `workspace_id` on every answer and frame + conversation scoping.
- **Every operation maps to a §4 story and ≥1 AC:** ✓. Each `summary` names its US, and each `description` names its ACs.
- **Every §6 `alt` branch maps to a response:** ✓ (table above).
- **Responses the contract needs but no §6 flow shows:**
  - **Sequence gap → OQ-1.** `resendReply` on a reply that is no longer `not_delivered` / `not_confirmed` (a double press, two members at once, a stale screen) → `409 REPLY_NOT_RESENDABLE`. This is a concurrent-state branch that flow 7 does not draw.
  - Everything else is cross-cutting (N2, N3, schema 400 / 413 / 415).

## Open questions

| # | Question | Owner (stage) | Due | Contract meanwhile |
|---|---|---|---|---|
| OQ-1 | Flow 7 has no branch for resending a reply that is already `sending` or `sent` (a concurrent or repeated press). Add an `alt` "reply no longer resendable → refused with its current state" to flow 7 | `sequences` (Dmytro Hopko) | before the contract is finalized | `resendReply` → `409 REPLY_NOT_RESENDABLE` with `details.reply`; nothing is queued |
| OQ-2 | Confirm the dead-letter handler for an exhausted `inbox.deliver-replies` job: in-flight → `not_confirmed`, never-attempted → `not_delivered` / `delivery_interrupted`, plus an alert. Confirm it as an ADR-0004 amendment or through `/sdd:decide-adr shared-inbox` (sad.md §6 "Flagged by `sequences`") | `design` (Dmytro Hopko) | before the contract is finalized (and before migration `05` is promoted) | `ReplyFailureReason` includes `delivery_interrupted` (= data-model CHECK); events.md describes the handler as pending. If `design` decides otherwise, drop the value from the contract and from `05_create_replies` together |

## Notes for `tasks` / `implement`

- **Error codes.** Register the 6 new codes in `ErrorCode` and add one `AppError` subclass each (table in B.2). The panel's error mapping switches on them:
  - `TEAMMATE_REPLIED` → SCR-04;
  - `DUPLICATE_RISK_CONFIRMATION_REQUIRED` → SCR-05;
  - `REPLY_LIMIT_REACHED` → the limit text with `retry_at`;
  - `BOT_CANNOT_REPLY` → the reply-box reason;
  - `MEDIA_UNAVAILABLE` → "content unavailable" by `reason`.
- **Shared schemas.** `packages/shared/src/inbox.ts` holds the zod mirrors of every schema here, including `LiveFrame` (events.md). `ThreadItem` and `LastItem` are `discriminatedUnion('type', …)`. `ReplySend.body` is bounded with `.max(4096)` + a non-blank refine in the shared schema, and the inbox domain re-checks 4096 in UTF-16 units.
- **The `messages.telegram_message` projection** (`attachment`, `location`, `shared_contact`, `poll`) is a pure function in `conversations/domain` (or `inbox/domain`), with a unit test per kind. It never copies the `file_id` / `file_unique_id` into a response. `openMessageMedia` reads the `file_id` through the `conversations` app layer (*media reference of a message*) and passes it to `bots` only.
- **The media route** answers its JSON errors before any byte is streamed. Once streaming has started, a failure aborts the connection; it never switches to a JSON body. Extend the bot-connection secrecy test to media responses and socket frames (QG-2).
- **The socket route** (`@fastify/websocket`): refuse in a `preValidation` hook with the normal envelope before the handshake (guard + `Origin`). Register it under the workspace prefix so the guard applies. The 5 s re-check and the `4401` / `4403` close codes live in `inbox/infra/hub.ts`.
- **Cursors** are base64url of the keyset tuple, decoded with zod. A bad cursor is `400 VALIDATION_ERROR`, never a 500.
- **`X-Background-Request: 1`** on every automatic call: refetches after a frame, and `markConversationRead`.
