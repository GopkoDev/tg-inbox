---
id: T19
title: "Serve the notifications routes (settings, connect link, disconnect) and GET inbox/attention behind the workspace guard, and register the notifications module"
layer: "ports"
deps: ["T6", "T10", "T12"]
blocks: ["T21", "T30"]
acs: ["AC-01", "AC-04", "AC-12", "AC-13"]
files_hint: ["apps/api/src/modules/notifications/http/routes.ts", "apps/api/src/modules/notifications/http/routes.int.test.ts", "apps/api/src/modules/inbox/http/routes.ts", "apps/api/src/modules/inbox/http/reads.int.test.ts", "apps/api/src/deps.ts", "apps/api/src/app.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T19 — Serve the notifications routes (settings, connect link, disconnect) and GET inbox/attention behind the workspace guard, and register the notifications module

## Place in the sequence

- **Blocked by:** T6 — Add the conversations reads waitingForPings (period start, start kind, assignee, per-member read state) and attentionCount, T10 — Add the notifications use cases for my settings, creating a connect link (limit, already linked, bot readiness, replace) and disconnecting, T12 — Intercept every private update in bots before capture through a port: redeem connect-link starts, consume linked members' messages with the hourly notice, pass everyone else · **Blocks:** T21 — Add the API end-to-end notification stories, the integrity checks, the reply-under-ping-load test, and the secrecy assertions for pings, answers, logs and frames, T30 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the notifications module, the sixth tenancy exception, the new queues, the ports and the new components · **Wave:** 5 — after T6, T10, T12.
- **Lane:** shares `apps/api/src/deps.ts` with T7; shares `apps/api/src/deps.ts` with T12; shares `apps/api/src/app.ts`, `apps/api/src/deps.ts` with T14; shares `apps/api/src/app.ts` with T15; shares `apps/api/src/app.ts` with T17; shares `apps/api/src/deps.ts` with T18; shares `apps/api/src/deps.ts` with T20; shares `apps/api/src/app.ts` with T27 — serialized.

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

It puts the attention count and the member's own Telegram settings behind the panel's usual sign-in and membership checks.

## Inlined context

> - **Module wiring:** each module exports `register<Module>(app, deps)` from `modules/<m>/http/routes.ts`; only `buildDeps()` constructs module dependencies (shared by `buildApp()` and the CLI) and only `buildApp()` registers modules. No self-registration, no globals.
>
> — `CLAUDE.md §Rules, Module wiring, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> | Authorization | Every notifications route sits under `/api/workspaces/:workspaceId/…` behind the `workspaces` guard, with both roles allowed: another workspace's account gets not found with no hint, a deactivated member gets `ACCESS_REMOVED`, and a signed-out visitor is sent to sign in. A member reads and removes **only their own** link; the routes take no account id. The Team on/off read is `ownerOnly` and returns account ids with a boolean, never a Telegram id or name. A connect link redeems only for the membership it was issued to, re-checked as active under a share lock. Every send share-locks the recipient's membership (0 pings to non-members). | workspace-operators ADR-0003, [ADR-0004](adr/0004-issue-connect-links-as-random-single-use-tokens-stored-as-hashes-and-redeemed-through-the-start-payload.md), [ADR-0005](adr/0005-decide-pings-in-a-per-workspace-sweep-every-20-s-with-a-per-period-ledger-written-before-the-send.md) |
>
> — `sad.md §8, Authorization, verbatim` · full text: [sad.md](../sad.md)

> 1. **Paths.** Settings — Notifications is `GET /api/workspaces/{workspaceId}/notifications`, with action POSTs `…/notifications/telegram/connect-link` and `…/notifications/telegram/disconnect`, after the repo's action-POST style (`/bot/disconnect`, `/invitations/{id}/revoke`, `/memberships/{id}/deactivate`). The attention count is `GET …/inbox/attention`, because `inbox` serves it (sad.md §5 tree "`GET …/inbox/attention`").
> 10. **No `400` on the new GETs and on the body-less POSTs**: they take no query or body. A malformed `workspaceId` answers `404` (the shared `WorkspaceId` parameter). This follows `listActiveMembers` (assignment-statuses).
>
> — `contracts/api-sync-report.md §Assumptions, 1, 10, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> | `bots/app/accept-update.ts` captures `/start <payload>` as a customer message today. Until this feature ships, connect links must not be issued. | Low | The interceptor and connect routes ship together in one release (task ordering). | Tech Lead |
>
> — `sad.md §11, ship together, verbatim` · full text: [sad.md](../sad.md)

> | Connect link | single use, expires in 10 min, ≤ 5 requests per 10 min per member | integration tests (AC-05, AC-13) |
>
> — `spec.md §6, Connect link, verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `GET /api/workspaces/{workspaceId}/inbox/attention` (`getAttentionCount`) → `200 AttentionCount` · `401`, `403 ACCESS_REMOVED`, `404`.
- `GET …/notifications` (`getNotificationSettings`) → `200 NotificationSettings` · `401`, `403`, `404`.
- `POST …/notifications/telegram/connect-link` (`createConnectLink`) → `201 IssuedConnectLink` · `401`, `403 ACCESS_REMOVED`, `404`, `409 TELEGRAM_ALREADY_LINKED | PINGS_NEED_WORKING_BOT`, `415`, `429 CONNECT_LINK_LIMIT_REACHED` + `Retry-After`.
- `POST …/notifications/telegram/disconnect` (`disconnectTelegram`) → `200 NotificationSettings` · `401`, `403`, `404`, `415`.
- No route takes an account id; both roles allowed; `BackgroundRequest` header on the two GETs.

— `contracts/openapi.yaml, the four added operations, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" with the inbox open: 2 open conversations assigned to them and 1 unassigned open conversation have customer messages they have not read, while a teammate's conversation and a closed one also have unread messages
> **When** they look at the browser tab or move to Settings or Contacts
> **Then** the tab title starts with "(3)" and the Inbox item in the side navigation shows 3: the **attention count** includes only open conversations that are theirs or unassigned and have unread messages for them. It changes without reloading within the live-update target of §6 as messages arrive, as they read conversations and as conversations are assigned, closed or reopened. At 0 the title has no count and the navigation shows no number. Each tab shows the count of its own workspace. A business owner sees the same.
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-04 — happy path

> **Given** an active operator of "Acme Flowers", whose bot is connected, with no Telegram link
> **When** they choose "Connect Telegram" in the panel, open the link it shows on their phone and press Start in the chat with the "Acme Flowers" bot within 10 minutes
> **Then** the bot answers in that chat that it will notify them about waiting customers of "Acme Flowers", and how to stop: disconnect in the panel. The panel shows "Connected" with their Telegram name and since when, without reloading. Starting the bot through this link creates no contact and no conversation and shows nothing in the inbox. Choosing "Disconnect" removes the link at once: the bot sends no further pings and tells them in the chat that notifications are off.
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person who is not an active member of "Acme Flowers": an account of another workspace, a deactivated member, someone not signed in, or a Telegram user who got hold of a connect link
> **When** they try to get a connect link for "Acme Flowers", see or remove a member's Telegram link, or use a link issued to someone else
> **Then** the system refuses and changes nothing. An account of another workspace gets no hint that the workspace exists. A deactivated member gets the access-removed notice. Someone not signed in is asked to sign in first. A connect link works only for the membership it was issued to, only once and only for 10 minutes (AC-05). A member sees and removes only their own Telegram link. A business owner sees which members are connected ("Telegram pings on/off" in Team) but cannot link or unlink for them, and never sees the Telegram account itself. A ping opened by someone else leads to the panel's sign-in and the workspace's usual access rules. Only an active member of "Acme Flowers" reaches the conversation.
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — error

> **Given** a member of "Acme Flowers" who has requested 5 connect links within the last 10 minutes
> **When** they request another one
> **Then** no new link is made. The panel says that connect links are limited to 5 per 10 minutes and when they can try again. A newer link always replaces the previous unused one (AC-05). When the bot of "Acme Flowers" is not connected, not working or taken over, the panel offers no connect link. It explains that Telegram pings need a working bot that receives messages. A taken-over bot would never receive the Start. An operator is told to ask a business owner; a business owner gets the way to the bot settings.
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `registerNotifications(app, deps)` with the three routes, zod response schemas from `@tg/shared` — `apps/api/src/modules/notifications/http/routes.ts`
- [ ] `GET …/inbox/attention` calling `conversations.attentionCount` with the guard's `activeSince` — `apps/api/src/modules/inbox/http/routes.ts`
- [ ] Build notifications in `buildDeps()` and register it under `/api` in `buildApp()` — `apps/api/src/deps.ts`, `apps/api/src/app.ts`
- [ ] Route integration tests: guard trio, both roles, every refusal with `details.settings`, `Retry-After`, Disconnect idempotent, a foreign workspace id → `404` with no hint — `apps/api/src/modules/notifications/http/routes.int.test.ts`, `apps/api/src/modules/inbox/http/reads.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Account of another workspace | `404`, no hint the workspace exists |
| Deactivated member | `403 ACCESS_REMOVED` |
| Signed out | `401 UNAUTHENTICATED` |
| Body sent with a non-JSON content type | `415` |

## Definition of Done

- [ ] Route integration tests pass for getAttentionCount, getNotificationSettings, createConnectLink and disconnectTelegram with the guard trio (401, 403 ACCESS_REMOVED, 404 with no hint), both roles, every contract refusal including 429 with Retry-After and the 409s with details.settings, and the module is registered by buildApp only.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
