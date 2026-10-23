---
id: T24
title: "Build Settings — Notifications (SCR-16) with the TelegramPingsCard, the notifications store, the role-filtered SettingsLayout and the route"
layer: "ui"
deps: ["T22"]
blocks: ["T25", "T26"]
acs: ["AC-04", "AC-06", "AC-10", "AC-12", "AC-13"]
files_hint: ["apps/web/src/features/notifications/api.ts", "apps/web/src/features/notifications/store.ts", "apps/web/src/features/notifications/TelegramPingsCard.tsx", "apps/web/src/features/notifications/TelegramPingsCard.test.tsx", "apps/web/src/pages/NotificationSettingsPage.tsx", "apps/web/src/features/settings/SettingsLayout.tsx", "apps/web/src/features/settings/SettingsLayout.test.tsx", "apps/web/src/app/routes.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T24 — Build Settings — Notifications (SCR-16) with the TelegramPingsCard, the notifications store, the role-filtered SettingsLayout and the route

## Place in the sequence

- **Blocked by:** T22 — Move the live socket to the workspace frame as one per-tab connection with subscribers, send presence frames on open and on visibilitychange, and let the inbox store subscribe · **Blocks:** T25 — Build SCR-17, the ConnectTelegramDialog: the link with Copy and Open in Telegram, its expiry, waiting for Start, the live turn to Connected, new-link refusals and the bot-stopped state, T26 — Build the DesktopNotificationsCard on SCR-16: capability and permission checks, the click-only permission request (OS-01), worker registration and the per-browser flag · **Wave:** 3 — after T22.
- **Lane:** shares `apps/web/src/features/notifications/TelegramPingsCard.tsx` with T25; shares `apps/web/src/pages/NotificationSettingsPage.tsx` with T26 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
> **So that** the bot can ping me when I am away, and only after I chose so
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** the business bot to ping me in Telegram when a customer of mine, or an unassigned one, has waited 5 minutes and I am away from the web
> **So that** no customer waits because I closed my laptop
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It is where a member sees and changes their own Telegram link, and why connecting is not possible when the bot does not work.

## Inlined context

> 1. **Settings opens to both roles.** The frame's **Settings** nav item is shown to operators too. `SettingsLayout` filters its sections by role: an owner sees **Bot**, **Team**, **Notifications**; an operator sees **Notifications** only. `/w/<id>/settings` goes to `settings/bot` for an owner (unchanged) and to `settings/notifications` for an operator. An operator who opens the Bot or Team address still gets the existing «Only business owners manage …» card. The description line follows the role: owner «Manage your workspace's bot and team, and your notifications»; operator «Manage your notifications».
> 2. **SCR-16 is two `Card`s**, stacked with `space-y-4` in the section outlet: **Desktop notifications** (this browser) and **Telegram pings** (this workspace). Each has its own status `Badge`, one short explanation and at most one primary action, so the two opt-ins never block each other. The desktop card renders without any request; the Telegram card loads `getNotificationSettings`.
> 4. **Connect opens the dialog only on success.** **Connect Telegram** shows a spinner and calls `createConnectLink`; `201` opens SCR-17. Its refusals (`429`, both `409`s) are shown on SCR-16, as the contract says. Asking for a new link from inside the open dialog shows the same refusals inside the dialog, so the link already shown stays usable.
> 7. **Disconnect has no confirmation** (AC-04 «at once», ux-flows assumption). The button shows a spinner while `disconnectTelegram` runs; the answer re-renders the card.
>
> — `screens.md §Source, Decisions 1, 2, 4, 7, verbatim` · full text: [screens.md](../screens.md)

> | default: not connected | `telegram.state: not_connected`, `can_connect: true` — title «Telegram pings», `Badge` «Not connected» (outline); «Get a message from the Acme Flowers bot in your own Telegram when a customer has waited 5 minutes and you're away from the panel. Pings never include the customer's message or name.»; **Connect Telegram** (AC-04; flow 8; example `notConnectedBotReady`) | NEW: TelegramPingsCard (Card, Badge, Button) | wireframe «telegram not connected» |
> | no working bot: operator | `not_connected`, `can_connect: false`, `caller_role: operator` (bot `not_connected`, `needs_token` or `taken_over`) — `Badge` «Not connected»; «Telegram pings need a working bot that receives messages. Ask a business owner to fix the bot.»; no connect link, no button (AC-13; flow 8; example `noWorkingBot`) | NEW: TelegramPingsCard | wireframe «telegram no working bot» |
> | no working bot: owner | the same with `caller_role: owner` — «Telegram pings need a working bot that receives messages.» + **Open bot settings** (`outline`) → SCR-08 (AC-13; flow 8) | NEW: TelegramPingsCard, Button | wireframe «telegram no working bot» |
> | connected | `telegram.state: connected`, `pings: on` — `Badge` «Connected»; «Connected as <display_name> since <linked_at, e.g. 19 Oct, 09:12>.» + «You'll get a ping in Telegram when customers wait and you're away from the panel.»; **Disconnect** (`outline`); never a connect link (AC-04, AC-06; flow 8, flow 18; example `connected`) | NEW: TelegramPingsCard | wireframe «telegram connected» |
> | pings paused | `connected`, `pings: paused` — `Badge` «Pings paused» (secondary); «Pings paused — the bot is not working. They start again when it works.»; operator: «Ask a business owner to fix the bot.»; owner: **Open bot settings**; **Disconnect** stays (AC-10; flow 16, flow 18; example `pingsPaused`) | NEW: TelegramPingsCard | wireframe «telegram connected» (paused) |
> | not reachable | `connected`, `pings: not_reachable` — `Badge` «Not reachable» (destructive); «Not reachable — you blocked the bot in Telegram. Unblock it, or disconnect.»; **Disconnect** (AC-10; flow 18; example `notReachable`) | NEW: TelegramPingsCard | wireframe «telegram connected» (not reachable) |
> | error: link limit | `429 CONNECT_LINK_LIMIT_REACHED` — `Alert` under the status line «Connect links are limited to 5 per 10 minutes — try again at <details.retry_at, e.g. 09:26>.»; **Connect Telegram** disabled until `retry_at`, then the alert goes and the button is enabled; nothing was created (AC-13; flow 8; contract `ConnectLinkLimitReached`) | NEW: TelegramPingsCard, Alert | wireframe «telegram not connected» (limit) |
> | refused: already connected | `409 TELEGRAM_ALREADY_LINKED` (connected meanwhile, e.g. from another tab) — the card re-renders from `details.settings` as `connected`; an `Alert` «You're already connected — disconnect first to connect another Telegram account.» until the next re-read (AC-06; flow 8) | NEW: TelegramPingsCard, Alert | — |
> Also: loading (Skeleton), connecting (spinner, `createConnectLink`; `201` opens SCR-17 — T25), disconnecting, success: disconnected, refused: no working bot (`details.settings`), error: action failed («Couldn't create a connect link — try again.» / «Couldn't disconnect — try again.»), error: not loaded (+ Retry), live: link or bot changed, phone (buttons full width).
>
> — `screens.md §SCR-16, Telegram pings card, abridged` · full text: [screens.md](../screens.md)

> | `telegram_link.changed` (only this account's sockets) | SCR-16 and an open SCR-17 re-read `getNotificationSettings`; other pages ignore it | AC-04, AC-06, AC-10; flow 18; events.md |
> | `bot.changed` | SCR-16 and an open SCR-17 re-read `getNotificationSettings` («Pings paused», whether a link is offered) | AC-10, AC-13; flow 16, flow 18 |
>
> — `screens.md §Shared states, settings triggers, verbatim` · full text: [screens.md](../screens.md)

> Telegram display names are rendered as plain text in SCR-16.
>
> — `sad.md §8, Untrusted content, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

`getNotificationSettings` → `NotificationSettings`; `createConnectLink` → `201 IssuedConnectLink` | `429 CONNECT_LINK_LIMIT_REACHED` (`details.retry_at`) | `409 TELEGRAM_ALREADY_LINKED` / `PINGS_NEED_WORKING_BOT` (`details.settings`); `disconnectTelegram` → `200 NotificationSettings`. Parsed with the `@tg/shared` schemas in `shared/api/client.ts`. — `contracts/openapi.yaml, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

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

### AC-10 — cross-context

> **Given** a conversation of "Acme Flowers" whose ping is due
> **When** at that moment the conversation is closed, a reply was marked sent, the recipient's membership is no longer active, the bot is "not connected" or "not working", or the member blocked the bot in Telegram
> **Then** no ping reaches that member. A closed conversation or a sent reply ends the wait (AC-08). A deactivated member's Telegram link is removed as part of the deactivation, before any further ping, and is not restored when they are reactivated. While the bot does not work, no ping is sent and none is queued for later, and the member's panel shows "Pings paused — the bot is not working". Once the bot works again, conversations whose customers are still waiting and that were not pinged to a member in their current waiting period become due for that member again. They go out combined, under the one-per-10-minutes limit (AC-08), and the 30-minute team reach continues from the start of each wait. When the member has blocked the bot, their panel shows "Not reachable — you blocked the bot in Telegram, unblock it or disconnect" until a ping reaches them again. Pings to that member are still attempted when due. A failed attempt counts as that conversation's ping for this member in the waiting period and is not retried. A deactivated member's link is removed. A link made with the workspace's previous bot is removed when a different bot is connected, and its member sees "Not connected". A bot that is "taken over" can still send (shared-inbox AC-14), so pings for customers who were already waiting still go out. The panel says that new customer messages are not arriving (shared-inbox AC-14). Pings never delay or crowd out replies to customers: when the bot is at its Telegram sending limit, replies go first and pings wait or are combined.
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

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

- [ ] Notifications API + store: settings, connect (keeps the issued link for SCR-17), disconnect, limit countdown to `retry_at`, re-read on `telegram_link.changed` / `bot.changed` / `resync` from the frame connection — `apps/web/src/features/notifications/api.ts`, `apps/web/src/features/notifications/store.ts`
- [ ] `TelegramPingsCard` with every Telegram-card state; **Open bot settings** for owners → `settings/bot` — `apps/web/src/features/notifications/TelegramPingsCard.tsx`
- [ ] Page + route `settings/notifications`; `SettingsLayout` filters sections by role with the role's description line; `/settings` index → bot (owner) / notifications (operator) — `apps/web/src/pages/NotificationSettingsPage.tsx`, `apps/web/src/features/settings/SettingsLayout.tsx`, `apps/web/src/app/routes.tsx`
- [ ] Testing Library tests for every Telegram-card state and the role filter — `apps/web/src/features/notifications/TelegramPingsCard.test.tsx`, `apps/web/src/features/settings/SettingsLayout.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| `retry_at` passes | alert goes, Connect enabled |
| Display name with markup | rendered as text |
| Operator opens `/settings/bot` | existing «Only business owners manage the bot» card |
| Background re-read fails | last state stays, no error |

## Definition of Done

- [ ] Testing Library tests cover every Telegram-pings-card state of SCR-16 in screens.md (loading, not connected, connecting, no working bot for operator and owner, connected, pings paused, not reachable, disconnecting, disconnected, link limit with its countdown, both 409 re-renders, action failed, not loaded with Retry, live re-read, phone) and the role-filtered SettingsLayout with its index redirect.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
