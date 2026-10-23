---
id: T10
title: "Add the notifications use cases for my settings, creating a connect link (limit, already linked, bot readiness, replace) and disconnecting"
layer: "app"
deps: ["T2", "T4", "T8"]
blocks: ["T19", "T20"]
acs: ["AC-04", "AC-06", "AC-12", "AC-13"]
files_hint: ["apps/api/src/modules/notifications/app/settings.ts", "apps/api/src/modules/notifications/app/connect-link.ts", "apps/api/src/modules/notifications/app/disconnect.ts", "apps/api/src/modules/notifications/app/ports.ts", "apps/api/src/modules/notifications/app/fakes.ts", "apps/api/src/modules/notifications/app/settings.test.ts", "apps/api/src/modules/notifications/app/connect-link.test.ts", "apps/api/src/modules/notifications/app/disconnect.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T10 — Add the notifications use cases for my settings, creating a connect link (limit, already linked, bot readiness, replace) and disconnecting

## Place in the sequence

- **Blocked by:** T2 — Add the notifications zod contracts, the three error codes, the presence client frame and the telegram_link.changed frame and signal, T4 — Add the ping text builder (TG-03), the bot answer texts (TG-02) and the connect-link rules: token and start payload, usable, 5 per 10 minutes and its retry time, T8 — Build the telegram-link and connect-link repositories with cross-workspace isolation tests, including the sixth-exception read of workspaces with a live link · **Blocks:** T19 — Serve the notifications routes (settings, connect link, disconnect) and GET inbox/attention behind the workspace guard, and register the notifications module, T20 — Add telegram_pings to Membership on the Team reads and the deactivate / reactivate answers through a notifications port that team takes · **Wave:** 3 — after T2, T4, T8.
- **Lane:** shares `apps/api/src/modules/notifications/app/ports.ts` with T8; shares `apps/api/src/modules/notifications/app/ports.ts` with T9; shares `apps/api/src/modules/notifications/app/settings.ts` with T20 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
> **So that** the bot can ping me when I am away, and only after I chose so
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It is the member-side logic behind Settings — Notifications: read my state, get a link, remove my link.

## Inlined context

> 4. **One settings object for the read, the Disconnect answer and both `409` refusals** (`NotificationSettings`), after the bot-connection precedent "the settings refusals hand back the current Bot settings so the panel can refresh". It carries `caller_role` and `bot` (the existing `InboxBotStatus`), which flow 8's refusal needs ("with the bot state and the caller's role").
> 5. **`pings` is derived** (`on` / `paused` / `not_reachable`), in flow 18's order: `not_reachable` wins over `paused`. `can_connect` is derived too (not connected and bot `connected`). Both are `medium`-confidence response-only fields.
> 8. **Connect-link check order follows flow 8 as drawn:** membership → limit → already linked → bot readiness. Refused requests create no `connect_links` row, so they never count toward the 5.
> 9. **Disconnect of nothing is `200`** with the current settings (sad.md §6 assumption "Disconnect on a link that is already gone is a success that changes nothing").
>
> — `contracts/api-sync-report.md §Assumptions, 4, 5, 8, 9, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> "Connect Telegram" re-checks everything in one transaction under the member's connect-link lock: the membership, the 5-per-10-minutes limit with the retry time, a link made meanwhile and the bot's readiness. Then it marks the previous unused link replaced and stores only the new token's hash, with a 10-minute expiry (ADR-0004).
> In one transaction the service marks the link removed by the member and clears the Telegram id and name, keeping the times for the §7 KPIs. It publishes the account-scoped `telegram_link.changed` and enqueues the "notifications are off" answer.
>
> — `sad.md §6, flow 8 + flow 9 prose, abridged` · full text: [sad.md](../sad.md)

> a link **the member removed** keeps `telegram_user_id` after `removed_at` until that job has finished […] The job then clears it. The display name is always cleared at removal.
>
> — `data-model.md §Assumptions, 3, notifications off keeps the id, abridged` · full text: [data-model.md](../data-model.md)

> **Chosen:** Option 1. 256 bits of randomness cannot be guessed, the stored hash is useless if the database leaks, and the row gives single use, replacement and the 5-per-10-minutes count (under the `connect-links:<ws>:<account>` advisory lock, the reply-limit precedent). The 47-character payload fits Telegram's limit. The link records the bot's **Telegram bot id**, so a token rotation keeps it and a different bot removes it (ADR-0003). A deactivated member's unused connect links are marked replaced in the deactivation transaction, and the membership check at redeem is the second line.
>
> — `adr/0004-issue-connect-links-as-random-single-use-tokens-stored-as-hashes-and-redeemed-through-the-start-payload.md §Decision outcome, ADR-0004, verbatim` · full text: [ADR-0004](../adr/0004-issue-connect-links-as-random-single-use-tokens-stored-as-hashes-and-redeemed-through-the-start-payload.md)

> | Secrets | Connect tokens: 32 bytes from `crypto.randomBytes`, base64url, shown once, only the SHA-256 hash stored and compared. Bot tokens never leave `bots`. `sendMemberMessage` takes a workspace id, a Telegram user id and text. | [ADR-0004](adr/0004-issue-connect-links-as-random-single-use-tokens-stored-as-hashes-and-redeemed-through-the-start-payload.md), bot-connection ADR-0006 |
>
> — `sad.md §8, Secrets, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Table | Change |
|---|---|
| `connect_links` | insert (hash only, `expires_at = created_at + 10 min`); previous unused one `replaced_at` |
| `telegram_links` | Disconnect: `removed_at`, `removed_reason = 'member'`, `display_name` cleared, `telegram_user_id` kept for the answer job |

— `data-model.md §Entities, abridged` · full text: [data-model.md](../data-model.md)

## API contract

- `getNotificationSettings` → `200 NotificationSettings` (caller's own live link only, never the Telegram user id).
- `createConnectLink` → `201 IssuedConnectLink` · `403 ACCESS_REMOVED` (membership no longer active), `429 CONNECT_LINK_LIMIT_REACHED` (`retry_at`), `409 TELEGRAM_ALREADY_LINKED` / `409 PINGS_NEED_WORKING_BOT` with `details.settings`; refused requests create no row.
- `disconnectTelegram` → `200 NotificationSettings` (also when there was no live link).

— `contracts/openapi.yaml, getNotificationSettings / createConnectLink / disconnectTelegram, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-04 — happy path

> **Given** an active operator of "Acme Flowers", whose bot is connected, with no Telegram link
> **When** they choose "Connect Telegram" in the panel, open the link it shows on their phone and press Start in the chat with the "Acme Flowers" bot within 10 minutes
> **Then** the bot answers in that chat that it will notify them about waiting customers of "Acme Flowers", and how to stop: disconnect in the panel. The panel shows "Connected" with their Telegram name and since when, without reloading. Starting the bot through this link creates no contact and no conversation and shows nothing in the inbox. Choosing "Disconnect" removes the link at once: the bot sends no further pings and tells them in the chat that notifications are off.
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — domain invariant

> **Given** an operator of "Acme Flowers" who is already connected, or a Telegram account that is already connected to another member of "Acme Flowers"
> **When** they open a new connect link in a different Telegram account, or a teammate opens their own connect link from that same Telegram account
> **Then** nothing changes. A member has at most one Telegram link per workspace, and a Telegram account is linked to at most one member of a workspace. The bot answers that this Telegram account cannot be connected and why ("already receives notifications for another member of Acme Flowers" / "you are already connected from another Telegram account — disconnect it in the panel first"). An existing link is never replaced silently. A connected member who opens a new connect link from the Telegram account they are already connected with is told "you are already connected", and the link is used up. While a member is connected, the panel offers "Disconnect" and no connect link. Connecting another Telegram account means disconnecting first.
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

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

- [ ] `mySettings(ws, account)` → `NotificationSettings` with `pings` derived (`not_reachable` > `paused` > `on`) and `can_connect` = not connected ∧ bot `connected` — `apps/api/src/modules/notifications/app/settings.ts`
- [ ] `createConnectLink(ws, account)`: one transaction — lock the membership, advisory lock, limit → already linked → bot readiness (via the bots port), mark previous replaced, insert the hash, return the URL — `apps/api/src/modules/notifications/app/connect-link.ts`
- [ ] `disconnect(ws, account)`: lock my live link, remove as `member`, publish `telegram_link.changed`, enqueue `notifications.send-bot-message { kind: notifications_off, telegram_link_id }` through `jobDb(tx)` — `apps/api/src/modules/notifications/app/disconnect.ts`
- [ ] Ports for conversations, workspaces, bots, signals, jobs, clock, random + in-memory fakes — `apps/api/src/modules/notifications/app/ports.ts`, `apps/api/src/modules/notifications/app/fakes.ts`
- [ ] Unit tests over every outcome in check order — `apps/api/src/modules/notifications/app/settings.test.ts`, `connect-link.test.ts`, `disconnect.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| 6th request within 10 min | `429`, no row; `retry_at` = oldest + 10 min |
| Connected meanwhile in another tab | `409 TELEGRAM_ALREADY_LINKED` with the connected settings |
| Bot `taken_over` | `409 PINGS_NEED_WORKING_BOT` (it would never receive the Start) |
| Second Disconnect | `200`, nothing changed, no signal, no job |
| Token in logs | never — neither the token nor its hash is logged |

## Definition of Done

- [ ] Unit tests prove mySettings derives pings and can_connect for every link and bot state, createConnectLink refuses in the contract's order (membership, limit with retry_at, already linked, bot not ready) creating nothing, replaces the previous unused link and stores only the hash, and disconnect removes only the caller's own link with its signal and notifications_off job, idempotently.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
