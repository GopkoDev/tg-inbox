---
status: Draft
owner: "Dmytro Hopko"
updated_at: "2026-10-11"
feature_size: M
---

# API sync report — bot-connection

This report is derived from `data-model.md` (+ the staged `migrations/01–04`), `sad.md` §6 flows 1–8, `spec.md` §4/§5 and feature ADR-0001…0008. Size **M**, route **standard** (from `.size` / `.route`).

**Contract forms** (from `sad.md` `target_surfaces: [backend-service, web-frontend]`):

- `backend-service` → [`openapi.yaml`](openapi.yaml) has 5 operations in OpenAPI 3.1. `redocly lint` reports it valid, with 1 warning (no `info.license`). The warning is accepted, as in workspace-operators.
- `backend-service` (async) → [`events.md`](events.md) describes the two pg-boss queues of the health check (flow 3). Inbound Telegram updates are the `receiveTelegramUpdate` HTTP operation, and they are not repeated there.
- `web-frontend` consumes `openapi.yaml`. It does not author a contract.

**Operations**

| operationId | Method + path | Flows | US |
|---|---|---|---|
| `getBotSettings` | `GET /api/workspaces/{workspaceId}/bot` | 4 | US-05, US-01 |
| `pasteBotToken` | `POST /api/workspaces/{workspaceId}/bot/token` | 1, 5 | US-01, US-06 |
| `reconnectBot` | `POST /api/workspaces/{workspaceId}/bot/reconnect` | 6 | US-05 |
| `disconnectBot` | `POST /api/workspaces/{workspaceId}/bot/disconnect` | 7 | US-06 |
| `receiveTelegramUpdate` | `POST /api/telegram/webhook/{botId}` | 2, 8 | US-02, US-03, US-04 |

**Carry-over from `sequences` is closed.** The separate reconnect action of flow 6 is `reconnectBot` (`POST …/bot/reconnect`). Pasting the stored token again on SCR-03 goes through `pasteBotToken` and ends in the same state (AC-16b).

## Deviations from the api-skill defaults

| Default | Contract | Authority |
|---|---|---|
| `BearerAuth` global | `SessionCookie` global. The webhook uses `TelegramSecretToken` (apiKey header `X-Telegram-Bot-Api-Secret-Token`) only | workspace-operators ADR-0002; feature ADR-0002 |
| `/api/v1/…` URL versioning | `/api/…`; owner routes under `/api/workspaces/{workspaceId}/bot…` | workspace-operators ADR-0003, ADR-0004 |
| Envelope `{code, message, details?}`, code `module.error_name` | `{ "error": { code, message, details? } }`, code UPPER_SNAKE in `ErrorCode` | repo convention (`CLAUDE.md`, `packages/shared/src/errors.ts`), workspace-operators precedent |
| Every error is the envelope | the webhook `401` has an **empty body** | feature ADR-0002 ("401 with an empty body") |
| `Idempotency-Key` on mutating operations whose flow has an external actor | not used | Every owner action is idempotent by its outcome: repeating a paste of the same token rotates to the same state, a repeated reconnect answers `NOTHING_TO_RECONNECT` with the current settings, and a repeated disconnect answers `NO_BOT_CONNECTED`. The webhook is idempotent through the unique keys (ADR-0003, ADR-0004) |
| Cursor pagination | no list operation in this feature | — |

## A. Field origins

Confidence: **high** means a column or a sad.md/ADR rule with a matching type and constraint. **medium** means a contract decision with no column, derived from a spec/ADR statement. **low** means inferred from a message name only.

| schema_path | origin | confidence |
|---|---|---|
| *.workspaceId | workspace-operators → `workspaces.id` (guard) | high |
| getBotSettings.state | data-model.md → `bots.state` (`connected`/`needs_token`/`taken_over`); `disconnected` **and** no row → `not_connected` (flow 4 "no row, or a row kept after a disconnect") | high |
| getBotSettings.bot.name | data-model.md → `bots.name` (text, no length CHECK) | high |
| getBotSettings.bot.username | data-model.md → `bots.username` (without `@`, no length CHECK) | high |
| getBotSettings.last_checked_at | data-model.md → `bots.last_checked_at` (NOT NULL unless `disconnected`) | high |
| getBotSettings.last_message_received_at | data-model.md → max `messages.received_at` per workspace, through the `conversations` app layer (`messages_workspace_id_received_at_idx`); null before the first message | high |
| getBotSettings.contacts_count | data-model.md → count of `contacts` per workspace, through the `contacts` app layer | high |
| pasteBotToken.token | data-model.md → `bots.token_encrypted` (stored only encrypted, ADR-0006); `telegram_bot_id` = the part before the colon. The raw bound of 512 and the post-trim pattern `^[0-9]{1,20}:[A-Za-z0-9_-]{30,100}$` are this contract's choice (no column holds the plain token) | medium |
| pasteBotToken.confirm_takeover | sad.md §4 "takeover confirmation is stateless … resubmits with an explicit confirmation flag"; the **name** is this contract's choice | medium |
| reconnectBot.confirm_takeover | sad.md §6 flow 6 "reconnect … with confirmation" | medium |
| WORKSPACE_KEEPS_ONE_BOT.details.reason | data-model.md → `bots.state` of this workspace's row: `disconnected` → `history`, otherwise `connected` (a kept `disconnected` row exists only when conversations exist, ADR-0007); sad.md §8 "connected / history variants" | high |
| TAKEOVER_CONFIRMATION_REQUIRED.details.bot | `getMe` result → the `bots.name` / `bots.username` shape; sad.md §6 flow 1 "confirmation required with bot name and username" | high |
| SettingsRefusalError.details.settings | `BotSettings` (above); sad.md §6 flows 6–7 "refusal with the current settings" | high |
| receiveTelegramUpdate.botId | data-model.md → `bots.id` ("also the webhook id", ADR-0002) | high |
| receiveTelegramUpdate → X-Telegram-Bot-Api-Secret-Token | data-model.md → `bots.webhook_secret_hash` (SHA-256, 32 B); ADR-0002 | high |
| receiveTelegramUpdate.update_id | data-model.md → `messages.edit_update_id` | high |
| receiveTelegramUpdate.message / edited_message (whole object) | data-model.md → `messages.telegram_message` (jsonb object) | high |
| …message_id | data-model.md → `messages.telegram_message_id` | high |
| …date | data-model.md → `messages.sent_at`, `contacts.profile_seen_at`; compared with `bots.connected_at` | high |
| …edit_date | data-model.md → `messages.edited_at` | high |
| …chat.id | data-model.md → `conversations.telegram_chat_id` | high |
| …chat.type, from.is_bot, business_connection_id | sad.md §8 inbound filter (AC-12); filter inputs only, no column | high |
| …from.id / first_name / last_name / username / language_code | data-model.md → `contacts.telegram_user_id` / `first_name` / `last_name` / `username` / `language_code` | high |
| …text, caption | data-model.md → `messages.body` (CHECK `kind <> 'text' OR body IS NOT NULL`) | high |
| events `bots.check-health`.bot_id / workspace_id | data-model.md → `bots.id`, `bots.workspace_id` | high |

There are no `low` rows and no field without an origin.

**Data-model fields with no HTTP exposure** (accepted, `# unused-in-spec` does not apply, because each is internal by design): `bots.telegram_bot_id`, `token_encrypted`, `webhook_secret_hash`, `connected_at` and `created_at`. The secret ones are never in a response. The rest are internal to capture and binding. `contacts`, `conversations` and `messages` have no read operation in this step, because their screens arrive with roadmap steps 4 and 7 (sad.md §5). The webhook writes them.

## B. Drift checklist

1. **Endpoint ↔ data-model** *(core)*: ✓.
   - `getBotSettings` reads `bots`, `messages` (newest `received_at`) and `contacts` (count).
   - `pasteBotToken` inserts or updates `bots`.
   - `reconnectBot` updates `bots`.
   - `disconnectBot` updates or deletes `bots` and reads `conversations` ("has conversations").
   - `receiveTelegramUpdate` reads `bots` and writes `contacts`, `conversations` and `messages`.
   - Every data-model entity is reachable.
2. **Error code ↔ repo error definition** *(core)*: ✓ (proposal). The registry is `ErrorCode` in `packages/shared/src/errors.ts`. VALIDATION_ERROR, UNAUTHENTICATED, ACCESS_REMOVED, OWNER_ONLY, NOT_FOUND, PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE and INTERNAL_ERROR exist already. sad.md §8 assigns this stage to fix the bot codes, so **8 are added by this contract**:

   | Code | Status | `AppError` subclass (implement) |
   |---|---|---|
   | `BOT_TOKEN_INVALID` | 400 | `BotTokenInvalidError` |
   | `BOT_BELONGS_TO_ANOTHER_WORKSPACE` | 409 | `BotBelongsToAnotherWorkspaceError` |
   | `WORKSPACE_KEEPS_ONE_BOT` | 409 | `WorkspaceKeepsOneBotError` (`details.reason`) |
   | `TAKEOVER_CONFIRMATION_REQUIRED` | 409 | `TakeoverConfirmationRequiredError` (`details.bot`) |
   | `NOTHING_TO_RECONNECT` | 409 | `NothingToReconnectError` (`details.settings`) |
   | `BOT_NEEDS_NEW_TOKEN` | 409 | `BotNeedsNewTokenError` (`details.settings`) |
   | `NO_BOT_CONNECTED` | 409 | `NoBotConnectedError` (`details.settings`) |
   | `TELEGRAM_UNAVAILABLE` | 503 | `TelegramUnavailableError`, the first 5xx `AppError`, as allowed by CLAUDE.md "specific-code subclass" |

   They follow the existing pattern: one class per code with a fixed status (e.g. `LastActiveOwnerError`).
3. **Validation ↔ constraint** *(core)*: ✓.
   - The `BotState` enum equals the `bots_state_check` list minus `disconnected`, which is projected to `not_connected`.
   - Name and username strings carry no `maxLength`, matching data-model.md ("strings that come from Telegram get no length CHECKs").
   - `contacts_count ≥ 0`.
   - `last_checked_at` is non-null in `ConnectedBotSettings`, matching `CHECK state = 'disconnected' OR last_checked_at IS NOT NULL`.
   - The webhook body is deliberately unvalidated at the HTTP layer (ADR-0003: a `4xx` would make Telegram redeliver a poison update for 24 h). The domain filter and the DB CHECKs (`kind` list, `body` for `text`, `jsonb_typeof = 'object'`) apply after that.
   - The token pattern is a domain rule, not a column constraint.
4. **OpenAPI ↔ sequence** *(supporting)*: ✓, with the notes below. Every `alt` branch maps to a response:

| Flow · branch | Operation → response |
|---|---|
| guard · no session | every owner route → 401 `UNAUTHENTICATED` |
| 4 (guard) · no active membership | every owner route → 404 `NOT_FOUND` |
| guard · deactivated member | every owner route → 403 `ACCESS_REMOVED` |
| 4 (guard) · member who is not a business owner | every owner route → 403 `OWNER_ONLY` |
| 4 · no row, or a row kept after a disconnect | getBotSettings → 200 `not_connected` |
| 4 · connected, needs a new token or taken over | getBotSettings → 200 with bot, times, count |
| 1 · not a bot token by format | pasteBotToken → 400 `BOT_TOKEN_INVALID` |
| 1, 5 · Telegram rejects the token | pasteBotToken → 400 `BOT_TOKEN_INVALID` |
| 1 · row holds a different bot / 5 · token of a different bot | pasteBotToken → 409 `WORKSPACE_KEEPS_ONE_BOT` (`connected` / `history`) |
| 1 · unique Telegram bot id violated | pasteBotToken → 409 `BOT_BELONGS_TO_ANOTHER_WORKSPACE` |
| 1, 5 · foreign webhook, no confirmation | pasteBotToken → 409 `TAKEOVER_CONFIRMATION_REQUIRED` |
| 1, 5 · setWebhook fails | pasteBotToken → 503 `TELEGRAM_UNAVAILABLE` |
| 5 prose · transient getMe / getWebhookInfo | pasteBotToken → 503 `TELEGRAM_UNAVAILABLE` |
| 1, 5 · registered | pasteBotToken → 200 `connected` |
| 6 · no bot or state is not taken over | reconnectBot → 409 `NOTHING_TO_RECONNECT` + settings |
| 6 · Telegram rejects the token | reconnectBot → 409 `BOT_NEEDS_NEW_TOKEN` + settings (`needs_token`) |
| 6 · transient failure / setWebhook fails | reconnectBot → 503 `TELEGRAM_UNAVAILABLE` |
| 6 · foreign webhook, no confirmation | reconnectBot → 409 `TAKEOVER_CONFIRMATION_REQUIRED` |
| 6 · registered | reconnectBot → 200 `connected` |
| 7 · no bot connected | disconnectBot → 409 `NO_BOT_CONNECTED` + settings |
| 7 · transient failure | disconnectBot → 503 `TELEGRAM_UNAVAILABLE` |
| 7 · rejected token / ours / foreign or empty → conversations exist / nothing captured | disconnectBot → 200 `not_connected` |
| 2, 8 · unknown bot or secret mismatch | receiveTelegramUpdate → 401 (empty body) |
| 2, 8 · filtered out | receiveTelegramUpdate → 200 |
| 2 · captured or already present | receiveTelegramUpdate → 200 |
| 8 · not captured / already applied / applied | receiveTelegramUpdate → 200 |
| 2, 8 note · database failure | receiveTelegramUpdate → 500 `INTERNAL_ERROR` |
| 3 · all branches | events.md `bots.check-health` outcome table |

**Supporting notes** (follow-ups, not blockers; resolved by the delegated default, Accept):

- **N1. Flow 1 does not draw the transient Telegram failure of `getMe` / `getWebhookInfo`.** The flow 5 prose and sad.md §8 "Side-effect ordering" state it, so the contract answers 503 `TELEGRAM_UNAVAILABLE` there too. This is cosmetic for `sequences`, and no Open Question is raised.
- **N2. The 401 / 403 `ACCESS_REMOVED` guard branches are cross-cutting.** They come from the workspace-operators guard (its flow 3), which sad.md §6 names "the guard". They are not drawn per flow, as in the precedent.
- **N3. Webhook `botId` that is not a UUID.** It answers 401, like an unknown bot, instead of 400, so the public route gives no hint. This is a contract decision, and the path param is declared as a bounded string for that reason.
- **N4. Confirmation flag on a clean bot.** `confirm_takeover: true` with no foreign webhook is harmless and connects normally. The flag only skips the warning, never a check.

## Back-feed (coverage cross-check)

- **Every §5 AC maps to ≥1 operation or response:** ✓.
  - AC-01 → pasteBotToken 200.
  - AC-02 → 400 `BOT_TOKEN_INVALID`.
  - AC-03 → 403 `OWNER_ONLY` / 404 `NOT_FOUND`.
  - AC-04 → 409 `BOT_BELONGS_TO_ANOTHER_WORKSPACE`.
  - AC-05 → 409 `WORKSPACE_KEEPS_ONE_BOT`.
  - AC-06 → 409 `TAKEOVER_CONFIRMATION_REQUIRED` + `confirm_takeover`.
  - AC-07, AC-08, AC-09, AC-10, AC-11, AC-12, AC-13 → receiveTelegramUpdate 200. AC-07 also maps to getBotSettings `last_message_received_at`.
  - AC-14 → receiveTelegramUpdate 401.
  - AC-15 → getBotSettings + events.md.
  - AC-16 → `needs_token` + pasteBotToken (rotate).
  - AC-16b → `taken_over` + reconnectBot.
  - AC-17 → pasteBotToken (rotate).
  - AC-18 → disconnectBot.
  - AC-19 → pasteBotToken after a disconnect.
- **Every operation maps to a §4 story and ≥1 AC:** ✓. Each `summary` names its US, and each `description` names its AC.
- **Every §6 `alt` branch maps to a response:** ✓ (table above).
- **Responses the contract needs but no §6 flow shows:** only the cross-cutting ones (N1, N2, schema 400/413/415). None of them is an authorization branch that no flow shows, so no sequence gap is raised and no Open Question is added.

## Upstream sync done by this stage

- **sad.md §5** (table ownership, "names indicative; `data-model` fixes them") and **§8** "Idempotency and order" now carry the two data-model decisions: `conversations` is unique on `contact_id` (a contact belongs to one workspace) **and** on (`workspace_id`, `telegram_chat_id`). Before, they said "unique (`workspace_id`, `contact_id`)".
- **sad.md §6** "Flagged for later stages": the reconnect item now names `reconnectBot`.
- **sad.md §8** "Error handling": now points to the codes fixed here.

## Notes for `tasks` / `implement`

- Register the 8 new codes in `ErrorCode` and add one `AppError` subclass each (table in B.2). Extend the web client's error mapping for `TELEGRAM_UNAVAILABLE` (503).
- **Owner guard message.** `modules/workspaces/http/guard.ts` hard-codes `OwnerOnlyError('Only business owners manage the team')`. The bot routes need "Only business owners manage the bot" (AC-03), so let the guard take the message, or a capability name, from the route.
- **Webhook route.**
  - Authenticate in an `onRequest` hook, before the body is parsed (ADR-0002 "refused before parsing").
  - Answer 401 with `reply.code(401).send()` and no envelope.
  - Declare no zod body schema beyond "JSON object". The bots domain parses the update and never throws a 4xx for an authentic request.
  - Register it under `/api/telegram/webhook/:botId` outside the workspace prefix and outside the session resolver.
- Redact `X-Telegram-Bot-Api-Secret-Token` in the request log (sad.md §8). Never put the token in an error message or detail. QG-2b asserts this over every response body, including every 409 and 503.
- `BotSettings` is a zod `discriminatedUnion('state', …)` in `packages/shared/src/bots.ts`, next to `BotTokenPaste` and `BotReconnect`. The shared `BotTokenPaste.token` only bounds (≤ 512) and trims. The token pattern is checked in the bots domain, so a malformed token answers `BOT_TOKEN_INVALID`, the same as a token Telegram rejects (AC-02), and never `VALIDATION_ERROR`. `packages/shared` may export the pattern for the panel's inline hint.
- The `bots.check-health` payload schema stays in `modules/bots/infra/jobs.ts` (events.md).
