---
id: T2
title: "Add the notifications zod contracts, the three error codes, the presence client frame and the telegram_link.changed frame and signal"
layer: "ports"
deps: []
blocks: ["T10", "T11", "T14", "T18", "T22"]
acs: ["AC-01", "AC-06", "AC-13"]
files_hint: ["packages/shared/src/notifications.ts", "packages/shared/src/notifications.test.ts", "packages/shared/src/index.ts", "packages/shared/src/errors.ts", "packages/shared/src/inbox.ts", "packages/shared/src/inbox.test.ts", "apps/api/src/platform/errors.ts", "apps/api/src/platform/errors.test.ts", "apps/api/src/platform/realtime.ts", "apps/api/src/platform/realtime.test.ts", "apps/web/src/features/inbox/store.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T2 — Add the notifications zod contracts, the three error codes, the presence client frame and the telegram_link.changed frame and signal

## Place in the sequence

- **Blocked by:** — · **Blocks:** T10 — Add the notifications use cases for my settings, creating a connect link (limit, already linked, bot readiness, replace) and disconnecting, T11 — Redeem a connect-link start: share-lock the membership, lock and re-check the link, enforce both uniqueness rules, link, signal and enqueue the answer, T14 — Teach the inbox hub to read presence frames and report socket lifecycle to notifications, and deliver telegram_link.changed only to that account's sockets, T18 — Remove links on deactivation through the composed onMembershipDeactivated port and on a different bot through the bot-connected hook, both in the existing transactions, T22 — Move the live socket to the workspace frame as one per-tab connection with subscribers, send presence frames on open and on visibilitychange, and let the inbox store subscribe · **Wave:** 1 — no upstream task.
- **Lane:** shares `apps/web/src/features/inbox/store.ts` with T22 — serialized.

## Why (user story)

> **As an** Operator
> **I want** the browser tab and the navigation to show how many conversations need me
> **So that** I notice new customer messages while I work on another page or another tab
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
> **So that** the bot can ping me when I am away, and only after I chose so
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It gives the API and the panel one typed vocabulary for the attention count, the notification settings, the connect link and its refusals, and the two new live frames.

## Inlined context

> - **Contracts:** request/response bodies are zod schemas in `packages/shared`, validated by `fastify-type-provider-zod`; the web client parses responses with the same schemas (`apps/web/src/shared/api/client.ts`).
>
> — `CLAUDE.md §Rules, Contracts, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> - **Errors:** throw `ValidationError` / `NotFoundError` / `ForbiddenError` / `ConflictError` / `UnauthenticatedError` / `TooManyRequestsError` (or a specific-code subclass such as `InvalidCredentialsError`) from `src/platform/errors.ts`. `TelegramUnavailableError` (503) is the one 5xx `AppError`: an upstream failure, logged by code only. The one error handler returns `{ "error": { "code", "message", "details"? } }`; codes are declared in `packages/shared/src/errors.ts`.
>
> — `CLAUDE.md §Rules, Errors, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> 7. **Error names fixed** (sad.md §5 "names fixed by `api`"): `CONNECT_LINK_LIMIT_REACHED` 429 (a specific-code subclass, as `REPLY_LIMIT_REACHED` / `CHANGE_LIMIT_REACHED`, not the generic `TooManyRequestsError` / `TOO_MANY_ATTEMPTS`, so the panel can tell it from sign-in throttling and read `retry_at`), `TELEGRAM_ALREADY_LINKED` 409, `PINGS_NEED_WORKING_BOT` 409.
>
> — `contracts/api-sync-report.md §Assumptions, 7, error names, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> - Socket frames: `LiveFrame` in `packages/shared/src/inbox.ts` gains `TelegramLinkChangedFrame`. The client frame `PresenceFrame` is a new zod schema next to it, parsed by the hub and built by `apps/web/src/shared/api/realtime.ts`.
> - Signals: `realtimeSignalSchema` in `apps/api/src/platform/realtime.ts` gains `telegram_link.changed`. The hub (`modules/inbox/infra/hub.ts`) maps it to the frame for that account's sockets only.
>
> — `contracts/events.md §Schema registry, frames and signal, verbatim` · full text: [events.md](../contracts/events.md)

> ```json
> { "type": "presence", "v": 1, "on_screen": true }
> ```
> parsed with zod; a frame that fails (unknown type, extra or wrong fields, over the existing 1024-byte inbound cap `LIVE_MAX_INBOUND_BYTES`) is ignored;
> ```json
> { "type": "telegram_link.changed", "v": 1, "workspace_id": "<uuid — telegram_links.workspace_id>" }
> ```
> Signal payload: `workspace_id`, `account_id` (the frame carries no `account_id`, events.md assumption 2).
>
> — `contracts/events.md §Frame: presence, server handling, abridged` · full text: [events.md](../contracts/events.md)

> `Membership` gains `telegram_pings` (x-delta: changed) — **not in this task**: it breaks the shipped team types and lands with the team port (T20).
>
> — `contracts/openapi.yaml §components, contract split, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `AttentionCount` `{ workspace_id, count ≥ 0 }` (`getAttentionCount` `200`).
- `NotificationSettings` `{ workspace_id, caller_role, bot: InboxBotStatus, telegram: TelegramLinkState, can_connect }`; `TelegramLinkState` = `TelegramNotConnected { state: not_connected }` | `TelegramConnected { state: connected, display_name (minLength 1), linked_at, blocked_at | null, pings: PingsState }`; `PingsState` = `on | paused | not_reachable` (`getNotificationSettings` / `disconnectTelegram` `200`).
- `IssuedConnectLink` `{ workspace_id, bot_username, url ^https://t\.me/[A-Za-z0-9_]+\?start=tgi_[A-Za-z0-9_-]{43}$, expires_at }` (`createConnectLink` `201`).
- Errors: `CONNECT_LINK_LIMIT_REACHED` 429 `details { limit: 5, window_seconds: 600, retry_at }` + `Retry-After` 1–600; `TELEGRAM_ALREADY_LINKED` 409 and `PINGS_NEED_WORKING_BOT` 409, both `details { settings: NotificationSettings }`.

— `contracts/openapi.yaml, components.schemas + ConnectLinkLimitReached, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" with the inbox open: 2 open conversations assigned to them and 1 unassigned open conversation have customer messages they have not read, while a teammate's conversation and a closed one also have unread messages
> **When** they look at the browser tab or move to Settings or Contacts
> **Then** the tab title starts with "(3)" and the Inbox item in the side navigation shows 3: the **attention count** includes only open conversations that are theirs or unassigned and have unread messages for them. It changes without reloading within the live-update target of §6 as messages arrive, as they read conversations and as conversations are assigned, closed or reopened. At 0 the title has no count and the navigation shows no number. Each tab shows the count of its own workspace. A business owner sees the same.
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — domain invariant

> **Given** an operator of "Acme Flowers" who is already connected, or a Telegram account that is already connected to another member of "Acme Flowers"
> **When** they open a new connect link in a different Telegram account, or a teammate opens their own connect link from that same Telegram account
> **Then** nothing changes. A member has at most one Telegram link per workspace, and a Telegram account is linked to at most one member of a workspace. The bot answers that this Telegram account cannot be connected and why ("already receives notifications for another member of Acme Flowers" / "you are already connected from another Telegram account — disconnect it in the panel first"). An existing link is never replaced silently. A connected member who opens a new connect link from the Telegram account they are already connected with is told "you are already connected", and the link is used up. While a member is connected, the panel offers "Disconnect" and no connect link. Connecting another Telegram account means disconnecting first.
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — error

> **Given** a member of "Acme Flowers" who has requested 5 connect links within the last 10 minutes
> **When** they request another one
> **Then** no new link is made. The panel says that connect links are limited to 5 per 10 minutes and when they can try again. A newer link always replaces the previous unused one (AC-05). When the bot of "Acme Flowers" is not connected, not working or taken over, the panel offers no connect link. It explains that Telegram pings need a working bot that receives messages. A taken-over bot would never receive the Start. An operator is told to ask a business owner; a business owner gets the way to the bot settings.
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Add `AttentionCount`, `NotificationSettings`, `TelegramLinkState` (discriminated on `state`), `PingsState`, `IssuedConnectLink` and the three refusal schemas, with the contract examples as fixtures — `packages/shared/src/notifications.ts`, `packages/shared/src/notifications.test.ts`, export from `packages/shared/src/index.ts`
- [ ] Add `CONNECT_LINK_LIMIT_REACHED`, `TELEGRAM_ALREADY_LINKED`, `PINGS_NEED_WORKING_BOT` — `packages/shared/src/errors.ts`
- [ ] Add `ConnectLinkLimitReachedError` (429 + `Retry-After`, after `ReplyLimitReachedError`), `TelegramAlreadyLinkedError`, `PingsNeedWorkingBotError` (409, `details.settings`) — `apps/api/src/platform/errors.ts`
- [ ] Add `TelegramLinkChangedFrame` to `LiveFrame` and the client `PresenceFrame` (strict, `on_screen` boolean) — `packages/shared/src/inbox.ts`
- [ ] Add `telegram_link.changed { workspace_id, account_id }` to `realtimeSignalSchema` — `apps/api/src/platform/realtime.ts`
- [ ] Keep the web inbox store compiling with the widened `LiveFrame` (ignore the new type there) — `apps/web/src/features/inbox/store.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `presence` frame with an extra field or a string `on_screen` | fails `PresenceFrame.safeParse` |
| `TelegramConnected` with an empty `display_name` | rejected (`minLength: 1`) |
| Connect URL with a 42-character token | rejected by the pattern |
| Old bundle receiving `telegram_link.changed` | unknown frame → ignored by the existing rule (events.md «Old bundles») |

## Definition of Done

- [ ] packages/shared and platform unit tests pass for every new schema and the contract examples, the three codes map to their AppError subclasses and statuses with Retry-After on the limit, and a telegram_link.changed frame and signal and a presence frame parse while malformed ones are rejected.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
