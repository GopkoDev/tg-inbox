---
status: Draft
owner: "Dmytro Hopko"
updated_at: "2026-10-19"
feature_size: M
---

# API sync report — operator-notifications

This report is derived from these inputs:
- `data-model.md` and the staged `migrations/01–08`;
- the existing schema: `bots` (`state`, `username`), `memberships` (`role`, `state`, `active_since`), `conversations` (`status`, `assignee_account_id`, `last_message_received_at`), `read_marks`;
- `sad.md` §5, §7, §8 and §6 (seeded flows 1–3, flows 4–18);
- `spec.md` §4/§5 (and §6, §6.1);
- feature ADR-0001…0010;
- the shipped contracts this one is a delta over (`../../shared-inbox/contracts/*`, `../../assignment-statuses/contracts/*`, `../../workspace-operators/contracts/openapi.yaml`, `../../bot-connection/contracts/openapi.yaml`) and the live code they became (`packages/shared/src/{inbox,errors,workspaces,bots}.ts`, `apps/api/src/platform/{errors,realtime}.ts`, `apps/api/src/modules/inbox/http/routes.ts`, `apps/api/src/modules/workspaces/http/team-routes.ts`, `apps/api/src/app.ts` `LIVE_MAX_INBOUND_BYTES`, `apps/web/src/app/routes.tsx`).

Size **M**, route **standard** (from `.size` / `.route`).

**Contract forms** (from `sad.md` `target_surfaces: [backend-service, web-frontend]`):

- `backend-service` → [`openapi.yaml`](openapi.yaml), OpenAPI 3.1, a **delta**: 4 added + 4 changed operations. Unchanged pieces are external `$ref`s into the shared-inbox, assignment-statuses and workspace-operators contracts. Changed schemas are restated in full, because the shipped ones are closed objects, and tagged `x-delta: changed` + `x-delta-fields`. `redocly lint` (`@redocly/cli@1.34.5`) resolves the external refs and reports the document **valid**, with 3 accepted warnings:
  - no `info.license`, as in every precedent;
  - `openLiveSocket` has no `2XX` (it is a `101` upgrade, as in shared-inbox);
  - `ErrorCode` is never referenced. It documents the registry delta, as in the precedents; the `*Error` schemas pin each code with `const`.
- `backend-service` (async) → [`events.md`](events.md): the `presence` client frame, the `telegram_link.changed` frame and signal, the queues `notifications.schedule-pings`, `notifications.send-pings`, `notifications.send-bot-message` (+ `-dlq`), and the interceptor's effect on the unchanged webhook.
- `web-frontend` consumes both. It does not author a contract.

## Assumptions (autonomous run 2026-10-19)

Each can be vetoed at review.

1. **Paths.** Settings — Notifications is `GET /api/workspaces/{workspaceId}/notifications`, with action POSTs `…/notifications/telegram/connect-link` and `…/notifications/telegram/disconnect`, after the repo's action-POST style (`/bot/disconnect`, `/invitations/{id}/revoke`, `/memberships/{id}/deactivate`). The attention count is `GET …/inbox/attention`, because `inbox` serves it (sad.md §5 tree "`GET …/inbox/attention`").
2. **The Team mark rides the existing `listMemberships`** (dispatch brief; sad.md §5 construction order "notifications → the ports that `bots` and `team` take → team"). `Membership` gains `telegram_pings: boolean`, so `deactivateMembership` and `reactivateMembership`, which answer a `Membership`, change too (always `false` there). sad.md §5's http line "team on/off for owners" under `notifications/http` is therefore served by the `team` read through a port, not by a separate notifications route. See flag F-1.
3. **No server-side state for desktop notifications.** The opt-in is a per-browser flag and the service worker decides alone (flow 5 postcondition "nothing is sent to the service", ADR-0009). No operation.
4. **One settings object for the read, the Disconnect answer and both `409` refusals** (`NotificationSettings`), after the bot-connection precedent "the settings refusals hand back the current Bot settings so the panel can refresh". It carries `caller_role` and `bot` (the existing `InboxBotStatus`), which flow 8's refusal needs ("with the bot state and the caller's role").
5. **`pings` is derived** (`on` / `paused` / `not_reachable`), in flow 18's order: `not_reachable` wins over `paused`. `can_connect` is derived too (not connected and bot `connected`). Both are `medium`-confidence response-only fields.
6. **The answer never carries the Telegram user id**, not even to its owner. SCR-16 shows only the name and the date (spec §6.1, data minimisation).
7. **Error names fixed** (sad.md §5 "names fixed by `api`"): `CONNECT_LINK_LIMIT_REACHED` 429 (a specific-code subclass, as `REPLY_LIMIT_REACHED` / `CHANGE_LIMIT_REACHED`, not the generic `TooManyRequestsError` / `TOO_MANY_ATTEMPTS`, so the panel can tell it from sign-in throttling and read `retry_at`), `TELEGRAM_ALREADY_LINKED` 409, `PINGS_NEED_WORKING_BOT` 409.
8. **Connect-link check order follows flow 8 as drawn:** membership → limit → already linked → bot readiness. Refused requests create no `connect_links` row, so they never count toward the 5.
9. **Disconnect of nothing is `200`** with the current settings (sad.md §6 assumption "Disconnect on a link that is already gone is a success that changes nothing").
10. **No `400` on the new GETs and on the body-less POSTs**: they take no query or body. A malformed `workspaceId` answers `404` (the shared `WorkspaceId` parameter). This follows `listActiveMembers` (assignment-statuses).
11. **`IssuedConnectLink.url`** is the full `https://t.me/<username>?start=tgi_<token>` link, plus `bot_username`. The panel shows the URL with Copy and Open in Telegram buttons (SCR-17; no scannable code in v1).

## Operations

| operationId | Delta | Method + path (under `/api/workspaces/{workspaceId}`) | Flows | US | AC |
|---|---|---|---|---|---|
| `getAttentionCount` | added | `GET /inbox/attention` | 4, seeded 3 | US-01 | AC-01, AC-12 |
| `getNotificationSettings` | added | `GET /notifications` | 8, 18 | US-03, US-04 | AC-04, AC-06, AC-10, AC-12, AC-13 |
| `createConnectLink` | added | `POST /notifications/telegram/connect-link` | 8 (seeded 2 redeems it) | US-03 | AC-04, AC-05, AC-06, AC-12, AC-13 |
| `disconnectTelegram` | added | `POST /notifications/telegram/disconnect` | 9 | US-03 | AC-04, AC-12 |
| `listMemberships` | changed | `GET /memberships` | 15 | US-05 | AC-12 |
| `deactivateMembership` | changed | `POST /memberships/{membershipId}/deactivate` | 15 | US-05, US-03 | AC-05, AC-10 |
| `reactivateMembership` | changed | `POST /memberships/{membershipId}/reactivate` | 15 | US-03 | AC-10 |
| `openLiveSocket` | changed | `GET /inbox/live` (WebSocket) | 4, 7, 18, seeded 3 | US-01, US-04 | AC-01, AC-04, AC-07, AC-09 |

Unchanged and not restated: every other inbox read and action (shared-inbox, assignment-statuses). `getInboxBotStatus` is reused by the panel as before; `NotificationSettings.bot` refs its schema. bot-connection's `receiveTelegramUpdate` keeps its contract; its new interception behaviour is in events.md. `pasteBotToken` / `disconnectBot` keep their contract; the bot-connected hook (a different bot removes links) runs inside the existing transaction and surfaces only as `telegram_link.changed` (events.md).

US-02 (desktop notifications) and US-06 (the bot chat stays a notification channel) have **no operation**: US-02 lives in the browser (ADR-0009), consuming the existing `conversation.changed` frame and `getConversation`; US-06 is the interceptor on the existing webhook (events.md). US-04's ping and US-05's team reach are the `notifications.send-pings` job.

## Deviations from the api-skill defaults

| Default | Contract | Authority |
|---|---|---|
| `BearerAuth` global | `SessionCookie` global (restated locally only because a security requirement names a local scheme) | workspace-operators ADR-0002; precedents |
| `/api/v1/…` URL versioning | `/api/workspaces/{workspaceId}/…` | workspace-operators ADR-0003, ADR-0004 |
| Envelope `{code, message, details?}`, code `module.error_name` | `{ "error": { code, message, details? } }`, UPPER_SNAKE codes in `ErrorCode` | `CLAUDE.md`, `packages/shared/src/errors.ts`, precedents |
| `Idempotency-Key` on a mutating operation with an async actor | none. Disconnect is idempotent by state (`200`, nothing changed). A repeated `createConnectLink` is a new link that replaces the previous unused one, which is the intended "ask again" (AC-05, flow 8). The jobs the two operations enqueue are idempotent by job id / ledger (events.md) | sad.md §6 flows 8, 9; shared-inbox ADR-0004 |
| Cursor page on every list | no new list. `listMemberships` keeps its cursor paging | workspace-operators |
| Self-contained document | delta document with external `$ref`s into three earlier contracts | dispatch brief; assignment-statuses precedent |

## A. Field origins

| schema_path | origin | confidence |
|---|---|---|
| getAttentionCount.workspace_id | path parameter / `conversations.workspace_id` | high |
| getAttentionCount.count | data-model `attentionCount(workspaceId, accountId, activeSince)` over `conversations.status`, `assignee_account_id`, `last_message_received_at` + `read_marks.read_through_at` + `memberships.active_since` (ADR-0008; existing schema, unchanged columns) | high |
| NotificationSettings.workspace_id | path parameter | high |
| NotificationSettings.caller_role | existing schema — `memberships.role` (workspace-operators `Role`); sad.md flow 8 "whether I am an owner" | high |
| NotificationSettings.bot | existing schema — `bots.state` via `pingReadiness`, shape = shared-inbox `InboxBotStatus` | high |
| NotificationSettings.can_connect | derived from `telegram_links` live row absent + `bots.state = connected` (flow 8 alt branches, AC-13) | medium |
| TelegramLinkState.state | derived — live `telegram_links` row (`removed_at IS NULL`) exists or not | high |
| TelegramConnected.display_name | data-model → `telegram_links.display_name` (NULL ⇔ removed; no length CHECK, assumption 12) | high |
| TelegramConnected.linked_at | data-model → `telegram_links.linked_at` | high |
| TelegramConnected.blocked_at | data-model → `telegram_links.blocked_at` (assumption 2) | high |
| TelegramConnected.pings | derived from `blocked_at` + `bots.state` (flow 18 order) | medium |
| IssuedConnectLink.workspace_id | data-model → `connect_links.workspace_id` | high |
| IssuedConnectLink.bot_username | existing schema — `bots.username` via `pingReadiness` (sad.md §5 "username") | high |
| IssuedConnectLink.url | ADR-0004 — `tgi_` + base64url of 32 random bytes (43 chars); data-model `connect_links.token_hash` (`octet_length = 32`) stores only its hash | high |
| IssuedConnectLink.expires_at | data-model → `connect_links.expires_at` (`> created_at`, = +10 min domain constant) | high |
| ConnectLinkLimitReachedError.details.limit / window_seconds | sad.md §7 constants (5 per 10 min); spec AC-13, §6 | high |
| ConnectLinkLimitReachedError.details.retry_at | data-model → oldest `connect_links.created_at` in the window + 10 min (`connect_links_workspace_id_account_id_created_at_idx`) | high |
| TelegramAlreadyLinkedError.details.settings | `NotificationSettings` (assumption 4) | high |
| PingsNeedWorkingBotError.details.settings | `NotificationSettings` — flow 8 "with the bot state and the caller's role" | high |
| Membership.telegram_pings | data-model → live `telegram_links` row per `(workspace_id, account_id)` (`telegram_links_live_workspace_id_account_id_key`, access pattern "Team's on/off per member") | high |
| Membership.(other fields) | unchanged — workspace-operators `Membership` | high |
| openLiveSocket presence frame `on_screen` | data-model → `tab_presences.on_screen` (events.md assumption 1) | high |
| telegram_link.changed signal `workspace_id`, `account_id` | ADR-0010; data-model §intro "a `pg_notify`, needs no table" | high |
| notifications.send-pings.workspace_id | sad.md §7 (`singletonKey` = workspace id) | high |
| notifications.send-bot-message.kind | sad.md flow 10 answer list; TG-02 | high |
| notifications.send-bot-message.telegram_link_id | data-model assumption 3 → `telegram_links.id` | high |
| notifications.send-bot-message.telegram_user_id | data-model assumption 3 → `telegram_links.telegram_user_id` / the sender's id (bigint) | high |
| notifications.send-bot-message.reason | spec AC-06 two refusal texts; seeded flow 2 "cannot connect with the reason" | medium |

No `low` row: every field traces to a column, an ADR constant or a drawn branch.

## B. Drift checklist

1. **Endpoint ↔ data-model** *(core)* — ✓. `getAttentionCount` reads `conversations` + `read_marks`; `getNotificationSettings` reads `telegram_links` (+ `bots`); `createConnectLink` writes `connect_links`; `disconnectTelegram` writes `telegram_links.removed_at/removed_reason/display_name`; `listMemberships` reads `telegram_links`; deactivate writes `telegram_links` + `connect_links.replaced_at`; the socket writes `tab_presences` (+ `pings.opened_at`). Every new table has a reader or writer: `pings` / `ping_items` and `conversations.waiting_since` / `bots.send_paused_until` are written only by jobs and existing transactions (events.md) — intentionally internal, no endpoint (**accepted**, as the data-model access patterns say).
2. **Error code ↔ repo error definition** *(core)* — ✓ with the expected proposal. Registry form: the `ErrorCode` const object in `packages/shared/src/errors.ts` + `AppError` subclasses in `apps/api/src/platform/errors.ts`. Existing codes used (`UNAUTHENTICATED`, `ACCESS_REMOVED`, `OWNER_ONLY`, `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`, `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `LAST_ACTIVE_OWNER`) all exist. The three new codes `CONNECT_LINK_LIMIT_REACHED`, `TELEGRAM_ALREADY_LINKED`, `PINGS_NEED_WORKING_BOT` are this contract's proposal, named as sad.md §5/§8 asked; `implement` adds them to `ErrorCode`, `platform/errors.ts` (`ConnectLinkLimitReachedError` with `Retry-After`, after `ReplyLimitReachedError`) and the zod refusal schemas in `packages/shared/src/notifications.ts`.
3. **Validation ↔ constraint** *(core)* — ✓. `limit: 5`, `window_seconds: 600`, `Retry-After ≤ 600` ↔ sad.md §7 constants (data-model assumption 11: no CHECK encodes them); `url` token `[A-Za-z0-9_-]{43}` ↔ `token_hash octet_length = 32` (32 bytes → 43 base64url chars); `expires_at` ↔ `CHECK expires_at > created_at`; `blocked_at` nullable ↔ column NULL; `display_name` `minLength: 1`, no `maxLength` ↔ no length CHECK (data-model assumption 12; Telegram bounds it); `count minimum 0`; `bot_username` is a plain string, as `bots.username` (no CHECK) and bot-connection's `BotSettings` leave it. No conflict.
4. **OpenAPI ↔ sequence** *(supporting)* — ✓. Every `alt` branch with an HTTP outcome has a response:
   - flow 4 / 8 / 9 / 14 guard: signed out → `401`, another workspace → `404` (no hint), deactivated → `403 ACCESS_REMOVED`;
   - flow 8: membership no longer active → `403` (`CallerAccessRemoved`), 5 in 10 min → `429 CONNECT_LINK_LIMIT_REACHED` + retry time, connected meanwhile → `409 TELEGRAM_ALREADY_LINKED`, bot not ready → `409 PINGS_NEED_WORKING_BOT`, allowed → `201`; the "connected / not connected + bot not ready / bot ready" display branches → `pings`, `can_connect`, `caller_role`;
   - flow 9: no live link → `200` nothing changed; live link → `200` not connected;
   - flow 15: operator → `403 OWNER_ONLY`; owner → `telegram_pings` per member;
   - flow 18: connected+reachable / not reachable / bot not working / taken over / not connected → `TelegramConnected.pings` values and `TelegramNotConnected`;
   - flow 7: invalid presence frame → ignored (events.md); flows 1, 2, 10, 11, 13, 16, 17 → events.md jobs, signal and interceptor table.

**Back-feed (coverage):**

| Spec AC | Covered by |
|---|---|
| AC-01 | `getAttentionCount`; events.md attention consumers |
| AC-02 | no operation (browser); events.md desktop-notifier consumer of `conversation.changed` |
| AC-03 | no operation (browser, flow 5) — assumption 3 |
| AC-04 | `createConnectLink` 201, `getNotificationSettings`, `disconnectTelegram`; events.md `telegram_link.changed`, `connected` / `notifications_off` answers, interceptor |
| AC-05 | `createConnectLink` (newer replaces older); `deactivateMembership` (unused links replaced); events.md `link_expired` |
| AC-06 | `409 TELEGRAM_ALREADY_LINKED`; `can_connect: false` while connected; events.md `cannot_connect` + reason, `already_connected` |
| AC-07 | events.md `notifications.send-pings` (5 min, away, read rule, single-conversation link), presence frame |
| AC-08 | events.md `notifications.send-pings` (ledger, 10-min spacing, combined wording + lens links) |
| AC-09 | events.md `notifications.send-pings` (30 min / 5 min unpingable assignee), `blocked` outcome |
| AC-10 | `TelegramConnected.pings` (`paused`, `not_reachable`); `deactivateMembership` / `reactivateMembership` (removed, not restored); events.md send outcomes, bot-connected hook signal, 429 pause |
| AC-11 | events.md interceptor table, `chat_only_notifications` ≤ 1/hour |
| AC-12 | guard responses on every operation; no account id in any route; `Membership.telegram_pings` only, owner only; ping links through the guard (events.md) |
| AC-13 | `429 CONNECT_LINK_LIMIT_REACHED`; `409 PINGS_NEED_WORKING_BOT`; `can_connect` + `caller_role` |

Every operation maps to a §4 user story and ≥ 1 AC (Operations table). Every §6 `alt` branch with an HTTP or async outcome has a response or an events.md entry. **No sequence gap** was found that needs an upstream fix.

## C. Flags (supporting — none blocks the contract)

- **F-1 · sad.md §5 vs the Team mark's route** — sad.md §5's `notifications/http` line lists "team on/off for owners", while the same section's construction order gives `team` a port, and the brief asks for the mark on the existing memberships read. The contract follows the port: `listMemberships` gains `telegram_pings`. **Accepted** as the reading that adds no route and keeps `workspaces` free of a `notifications` import. Owner: `tasks` (wire the port in `buildDeps()`); a one-line §5 wording fix can follow at the next `design` touch.
- **F-2 · new error codes not yet in the registry** — expected for a not-yet-implemented feature (point 2). **Accepted**; `implement` adds them.
- **F-3 · Telegram user id in `notifications.send-bot-message` payloads** for `link_expired` / `cannot_connect`, and in the DLQ — carried over from data-model assumption 3 and sad.md §6 flags. **Accepted pending security review** (spec §6.1 marks review as required).

Total flags: 3 supporting, 0 core. Three flags reach the drift-check pause threshold (≥ 3 flags in one run). In this autonomous run each was resolved with the shared 4-state action **Accept as is**, with an owner, instead of pausing; any of them can be reopened at review.

## Self-check

Structural self-check (drift check + coverage): **pass** — 4/4 points ✓, every AC covered, every operation traced, no `low` field origin, `redocly lint` valid (3 accepted warnings). Spectral is not wired in the repo; `redocly` was used instead, as in the precedents.
