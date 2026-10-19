---
status: draft
feature_size: "M"
tool: "code"
updated_at: "2026-10-19"
---

# Screens — operator-notifications

> The canonical **screen manifest** — every screen in every state — produced by `screens` (between
> `api` and `tasks`) and read by `tasks` (each `ui` task cites SCR ids + states), `implement`
> (builds the screen to the declared states) and `review` (the built screen must match this).
> Downstream stages reference **only this manifest** — never the raw Figma / `.pen` file.

## Source

- **Tool:** code (from `docs/design-system.md`) — inline wireframes below, one per state that needs a distinct layout. No degradation: the canon's tool is `code`, so no Figma / Pencil MCP was needed.
- **File:** inline wireframes below.
- **Inventory:** SCR ids from [`ux-flows.md`](ux-flows.md) §Screen inventory — SCR-01, SCR-02, SCR-06, SCR-07, SCR-08, SCR-09, SCR-13, SCR-14, SCR-15, SCR-16, SCR-17, all covered. SCR-16 and SCR-17 are new. SCR-15 is the shipped workspace frame (ui-redesign SCR-07), SCR-13 / SCR-14 the shipped Team screen and its confirmation (assignment-statuses ids). Every state those screens already list stays as is and is **not repeated** here: this manifest lists only the states this feature adds or changes. SCR-01, SCR-02, SCR-06, SCR-07, SCR-08 and SCR-09 are landings with no new layout. The surfaces outside the panel (OS-01, OS-02, TG-01…TG-03) get no SCR id; they are specified as **copy and behaviour specs** in §Outside the panel, because the panel does not draw them but the code builds their content.
- **Component names:** names from the canon inventory (`AppShell`, `Sidebar` incl. its `SidebarMenuBadge` part, `Breadcrumb`, `SettingsLayout`, `Card`, `Badge`, `Button`, `Alert`, `Dialog`, `AlertDialog`, `Separator`, `Skeleton`, `Table`, `Avatar`, `DropdownMenu`, `DataTableToolbar`, `NotFoundCard`, `AuthLayout`, `InboxList`, `ConversationList`, `Thread`); `extended: <name>` = an existing inventory component that gains states (its canon row is updated, not duplicated); `NEW: <name>` = a part listed under §New components. No primitive from the canon's _Not yet in the repo_ list is needed (no toast: every outcome is shown in place).
- **Sources per row:** spec §5 ACs, sad.md §6 flows (`flow N`), contract responses (`openapi.yaml` `operationId` + status / code) and live frames (`contracts/events.md`). Every non-default state names at least one.
- **Copy:** existing texts stay word for word. New texts are quoted below; `implement` may polish them without changing their meaning. The Telegram display name, contact names and the workspace name render as plain text everywhere (spec §6.1, sad.md §8 _Untrusted content_). Times use the existing helpers: relative times from `features/inbox/relative-time.ts`, dates and clock times from `features/bot/settings/format.ts`.
- **Decisions taken at this stage** (the contract and the SAD leave them to `screens`; recorded here, not elsewhere):
  1. **Settings opens to both roles.** The frame's **Settings** nav item is shown to operators too. `SettingsLayout` filters its sections by role: an owner sees **Bot**, **Team**, **Notifications**; an operator sees **Notifications** only. `/w/<id>/settings` goes to `settings/bot` for an owner (unchanged) and to `settings/notifications` for an operator. An operator who opens the Bot or Team address still gets the existing «Only business owners manage …» card. The description line follows the role: owner «Manage your workspace's bot and team, and your notifications»; operator «Manage your notifications».
  2. **SCR-16 is two `Card`s**, stacked with `space-y-4` in the section outlet: **Desktop notifications** (this browser) and **Telegram pings** (this workspace). Each has its own status `Badge`, one short explanation and at most one primary action, so the two opt-ins never block each other. The desktop card renders without any request; the Telegram card loads `getNotificationSettings`.
  3. **The attention count sits on the Inbox item as `SidebarMenuBadge`** and in the tab title as a `(N) ` prefix to the existing title (`(3) tg-inbox`). Both show the exact number, uncapped, as the contract returns it. With the sidebar collapsed to icons, the badge is hidden and the Inbox tooltip reads «Inbox (3)». At phone width, where the nav is in a drawer, the same number also shows as a small `Badge` next to the sidebar trigger in the header row, so the count is visible without opening the drawer.
  4. **Connect opens the dialog only on success.** **Connect Telegram** shows a spinner and calls `createConnectLink`; `201` opens SCR-17. Its refusals (`429`, both `409`s) are shown on SCR-16, as the contract says. Asking for a new link from inside the open dialog shows the same refusals inside the dialog, so the link already shown stays usable.
  5. **SCR-17 is a `Dialog`, not an `AlertDialog`.** Nothing is confirmed or lost by closing it: Esc, the close button or a click outside close it; the link stays valid for its 10 minutes and SCR-16 still turns «Connected» if Start is pressed later (ux-flows assumption). Focus returns to **Connect Telegram**.
  6. **The scannable code** is drawn in the browser from `url` as an SVG (`NEW: QrCode`). Nothing leaves the browser for it, and no image is served (sad.md §4 _Routes_). On desktop the code is the main way; at phone width **Open in Telegram** comes first and the code sits below it.
  7. **Disconnect has no confirmation** (AC-04 «at once», ux-flows assumption). The button shows a spinner while `disconnectTelegram` runs; the answer re-renders the card.
  8. **The Team mark is a column** «Telegram pings» with the plain text «On» / «Off» in the members table (no colour meaning, since off is not an error). It is read when Team opens and taken from every deactivate / reactivate answer; it is **not** live (flow 15, sad.md §6 flag «`screens` should not promise a live mark»).
  9. **Telegram texts are plain text** (no Markdown / HTML parse mode), so a workspace name can never inject formatting, and links are bare URLs on their own line with the link preview off. Waits are whole minutes below an hour («12 min») and hours plus minutes from 60 («1 h 5 min», «2 h»).

### Assumptions (autonomous run 2026-10-19)

- Depth = medium, posture desktop-first per the canon; the per-screen confirmations were made by the pipeline itself (Accept on every screen) and can be vetoed at review. Decisions 1–9 above are this stage's own picks.
- «Pings paused» on SCR-16 also gives a business owner **Open bot settings**, as AC-13 does for the not-connected case; an operator gets «Ask a business owner to fix the bot.» The AC fixes only the status line.
- A connected member with a taken-over bot sees plain «Connected» on SCR-16 (flow 18, PingsState `on`); the inbox's existing taken-over notice tells them new customer messages are not arriving. SCR-16 adds no second notice.
- SCR-14's deactivate text gains one sentence about Telegram pings **only when that member's row shows «On»** — nothing to say otherwise.
- A ping whose whole due set is teammates' conversations is not listed in `events.md`'s wording table (it lists one / own / unassigned / mixed). TG-03 gives it its own sentence and the open-lens link; the mixed sentence names only the non-zero parts.
- The desktop notification replaces an earlier one of the same conversation **and alerts again** (`renotify: true`): each replacement is a new customer message the member has not seen.
- The OS-02 icon is the panel's existing favicon. The contact name follows the inbox list's display rule (name, else `@username`, else the list's fallback text).

## Screens

**Shared states (SCR-15, SCR-16, SCR-17, and the attention store).** The shared-inbox guard table (shared-inbox `screens.md` §Shared inbox states: 401 → SCR-09, 403 → SCR-07, guard 404 → SCR-06, socket close codes, resync, foreign-workspace frames dropped, workspace switch reset) applies unchanged. This feature adds the rows below; each screen lists them as one row pointing here.

| Trigger | What the panel does | Source |
| --- | --- | --- |
| `401 UNAUTHENTICATED` on `getAttentionCount` / `getNotificationSettings` / `createConnectLink` / `disconnectTelegram` | an open SCR-17 closes; as the inherited 401 row → SCR-09, then back to the same address (`/w/<id>/settings/notifications` included) | AC-12; flow 4, flow 8, flow 9 |
| `403 ACCESS_REMOVED` on the same routes, or the socket closes `4403` (`membership.deactivated`) | an open SCR-17 closes; as the inherited 403 row → SCR-07; the frame's count and title prefix go | AC-12; flow 4, flow 8, flow 9, flow 15 |
| `404 NOT_FOUND` on the same routes (another workspace's address, unknown workspace) | the frame shows `NotFoundCard` (inherited); no count, no hint the workspace exists | AC-12; flow 4, flow 8 |
| `conversation.changed` (`created` / `message`, `created` / `activity`, `read`) of this workspace | the attention store re-reads `getAttentionCount`, debounced 300 ms (SCR-15); the desktop notifier evaluates `created` / `message` only (OS-02) | AC-01, AC-02; flow 4, flow 6; events.md |
| `telegram_link.changed` (only this account's sockets) | SCR-16 and an open SCR-17 re-read `getNotificationSettings`; other pages ignore it | AC-04, AC-06, AC-10; flow 18; events.md |
| `bot.changed` | SCR-16 and an open SCR-17 re-read `getNotificationSettings` («Pings paused», whether a link is offered) | AC-10, AC-13; flow 16, flow 18 |
| `resync` / reconnect | the attention store and SCR-16 re-read; inherited inbox resync unchanged | AC-01, AC-04; flow 4, flow 18 |
| a frame that fails to parse | dropped; reconnect + resync (inherited rule; an old bundle ignores `telegram_link.changed`) | events.md «Old bundles» |
| a background re-read fails (network / `500`) | the last count / the last SCR-16 state stays on screen; the next frame or resync asks again; no error shown | flow 4 «keep the last count» |
| workspace switched | the outlet remounts keyed on the workspace (inherited); the count and title prefix clear until the new workspace's answer; SCR-16 re-reads for the new workspace; the desktop card shows that workspace's per-browser flag | AC-01; flow 4 |

### SCR-15 — Workspace frame

Every ui-redesign SCR-07 state is kept. The frame now also opens the tab's one live socket (sad.md §4) — no visible change. Added or changed:

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default: count above 0 | workspace entered and `getAttentionCount` `200` with `count` N > 0 — the tab title is `(N) tg-inbox`; the **Inbox** nav item shows N in a `SidebarMenuBadge` on its right, with `aria-label` «N conversations need you»; the same on Inbox, Contacts and every Settings page; each tab shows only its own workspace (AC-01; flow 4) | extended: AppShell, Sidebar (`SidebarMenuBadge`) | wireframe «frame desktop» |
| default: count 0 | `count: 0` — title `tg-inbox`, no badge (AC-01) | extended: AppShell | — |
| role: operator (changed) | an operator's nav now shows **Settings** too (Decision 1); it leads to Settings — Notifications (AC-12; ux-flows «one personal place») | extended: AppShell, Sidebar | wireframe «frame desktop» |
| loading | before the first `getAttentionCount` answer — no count in the title, no badge (no skeleton: a missing number is the same as 0 until known) (flow 4) | — | — |
| live: count changes | a `conversation.changed` / `resync` frame → re-read, debounced 300 ms → title and badge change without a reload: a customer writes in a conversation that is mine or unassigned, I read one, one is assigned to me / unassigned / to a teammate, closed or reopened; a teammate's or closed conversation never adds to it (AC-01; flow 4) | extended: AppShell | — |
| error: count not read | the read fails — the last count stays; no error shown (Shared states) (flow 4) | — | — |
| collapsed (desktop) | sidebar collapsed to icons — the badge is hidden; the Inbox tooltip reads «Inbox (N)» (Decision 3) | Sidebar, Tooltip | — |
| phone (< md) | the drawer's Inbox item shows the badge; with N > 0 the header row also shows N in a `Badge` after the sidebar trigger (`aria-hidden`, the drawer item carries the label) (Decision 3; canon posture) | Sidebar, Sheet, Badge | wireframe «frame phone» |
| entering / not found / error / access removed | inherited states; no count and no title prefix in any of them (AC-12) | Skeleton, NotFoundCard, Alert | — |
| empty | N/A: the frame has no list; «nothing needs me» is `default: count 0` | — | — |
| guard / live states | → §Shared states | — | §Shared states |

```text
frame desktop (owner; operator sees the same items)       browser tab: "(3) tg-inbox"
+--------------------+-------------------------------------------------------+
| [◼] Acme Flowers ▾ | [≡] |  Acme Flowers › Settings › Notifications        |
|     Operator       |-------------------------------------------------------|
|                    |                                                       |
|  Workspace         |              (outlet: the current screen)             |
|  ▸ Inbox      [3]  |                                                       |
|  ▸ Contacts        |                                                       |
|  ▸ Settings   ●    |                                                       |
|                    |                                                       |
| (AN) ana@acme.test▾|                                                       |
+--------------------+-------------------------------------------------------+

frame phone (drawer closed)
+--------------------------------+
| [≡] [3] | Acme Flowers › Inbox |
|--------------------------------|
| (outlet)                       |
+--------------------------------+
```

### SCR-16 — Settings — Notifications

New. `/w/<id>/settings/notifications`, breadcrumb «Acme Flowers › Settings › Notifications», open to both roles. Inside `SettingsLayout` (extended: role-filtered sections, Decision 1), two cards (Decision 2).

**Desktop notifications card** — no server state; the per-browser flag is kept in `localStorage` per account and workspace, read in try/catch (sad.md §4 _Stores_, flow 5).

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default: off | the browser supports notifications, storage works, permission `default` (not asked) or `granted`, flag off — title «Desktop notifications», `Badge` «Off» (outline); «Get a notification on this computer when a customer writes in a conversation that is yours or unassigned and you're not looking at Acme Flowers.»; **Turn on desktop notifications** (AC-02, AC-03; flow 5) | NEW: DesktopNotificationsCard (Card, Badge, Button) | wireframe «notifications desktop» |
| asking | the button clicked with permission `default` — the browser's own prompt (OS-01) is open; the button shows a spinner and is disabled. The panel never asks without this click (AC-03; flow 5) | NEW: DesktopNotificationsCard | — |
| success: on | allowed (or already `granted`) and the worker registered — flag stored; `Badge` «On»; «On for Acme Flowers in this browser. Notifications show the customer's name, never the message.»; **Turn off** (`outline`) (AC-02; flow 5) | NEW: DesktopNotificationsCard | wireframe «notifications desktop» (on) |
| error: blocked | the member blocks or dismisses OS-01, or permission is already `denied` (also when it was revoked in the browser while the flag was on) — `Badge` «Off»; «Desktop notifications are blocked for this site in your browser. To allow them, open the site settings from the icon next to the address bar, set Notifications to Allow, and come back here.»; no button that asks again; «The count in the tab title and next to Inbox keeps working.» (AC-03; flow 5, flow 6) | NEW: DesktopNotificationsCard, Alert | wireframe «notifications desktop» (blocked) |
| error: not available | the browser cannot show notifications (no Notification API or service worker), the flag cannot be stored, or the worker registration fails — `Badge` «Not available»; «This browser can't show desktop notifications. The count in the tab title and next to Inbox keeps working.»; no button (AC-03; flow 5) | NEW: DesktopNotificationsCard | — |
| turned off | **Turn off** — flag cleared at once; the worker is unregistered when no workspace in this browser keeps the flag; back to `default: off` (flow 5) | NEW: DesktopNotificationsCard | — |
| loading | N/A: the card reads only the browser (synchronous capability and permission checks) — no request | — | — |
| empty | N/A: a settings card with no list | — | — |

**Telegram pings card** — `getNotificationSettings` (contract `NotificationSettings`).

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| loading | the page opens — `getNotificationSettings` in flight; the card shows its title and a `Skeleton` for the status line and the button (flow 8) | NEW: TelegramPingsCard (Card, Skeleton) | — |
| default: not connected | `telegram.state: not_connected`, `can_connect: true` — title «Telegram pings», `Badge` «Not connected» (outline); «Get a message from the Acme Flowers bot in your own Telegram when a customer has waited 5 minutes and you're away from the panel. Pings never include the customer's message or name.»; **Connect Telegram** (AC-04; flow 8; example `notConnectedBotReady`) | NEW: TelegramPingsCard (Card, Badge, Button) | wireframe «telegram not connected» |
| connecting | **Connect Telegram** pressed — spinner on the button, disabled; `createConnectLink` (Decision 4) | NEW: TelegramPingsCard | — |
| success: link created | `201` — SCR-17 opens over the page with the answer (AC-04; flow 8) | — | — |
| no working bot: operator | `not_connected`, `can_connect: false`, `caller_role: operator` (bot `not_connected`, `needs_token` or `taken_over`) — `Badge` «Not connected»; «Telegram pings need a working bot that receives messages. Ask a business owner to fix the bot.»; no connect link, no button (AC-13; flow 8; example `noWorkingBot`) | NEW: TelegramPingsCard | wireframe «telegram no working bot» |
| no working bot: owner | the same with `caller_role: owner` — «Telegram pings need a working bot that receives messages.» + **Open bot settings** (`outline`) → SCR-08 (AC-13; flow 8) | NEW: TelegramPingsCard, Button | wireframe «telegram no working bot» |
| connected | `telegram.state: connected`, `pings: on` — `Badge` «Connected»; «Connected as <display_name> since <linked_at, e.g. 19 Oct, 09:12>.» + «You'll get a ping in Telegram when customers wait and you're away from the panel.»; **Disconnect** (`outline`); never a connect link (AC-04, AC-06; flow 8, flow 18; example `connected`) | NEW: TelegramPingsCard | wireframe «telegram connected» |
| pings paused | `connected`, `pings: paused` — `Badge` «Pings paused» (secondary); «Pings paused — the bot is not working. They start again when it works.»; operator: «Ask a business owner to fix the bot.»; owner: **Open bot settings**; **Disconnect** stays (AC-10; flow 16, flow 18; example `pingsPaused`) | NEW: TelegramPingsCard | wireframe «telegram connected» (paused) |
| not reachable | `connected`, `pings: not_reachable` — `Badge` «Not reachable» (destructive); «Not reachable — you blocked the bot in Telegram. Unblock it, or disconnect.»; **Disconnect** (AC-10; flow 18; example `notReachable`) | NEW: TelegramPingsCard | wireframe «telegram connected» (not reachable) |
| disconnecting | **Disconnect** pressed (no confirmation, Decision 7) — spinner, both actions disabled; `disconnectTelegram` (AC-04; flow 9) | NEW: TelegramPingsCard | — |
| success: disconnected | `200` — the card re-renders from the answer: «Not connected» at once, **Connect Telegram** again while the bot is ready (or the no-working-bot state); a second Disconnect (already removed elsewhere) is the same `200` (AC-04; flow 9) | NEW: TelegramPingsCard | — |
| error: link limit | `429 CONNECT_LINK_LIMIT_REACHED` — `Alert` under the status line «Connect links are limited to 5 per 10 minutes — try again at <details.retry_at, e.g. 09:26>.»; **Connect Telegram** disabled until `retry_at`, then the alert goes and the button is enabled; nothing was created (AC-13; flow 8; contract `ConnectLinkLimitReached`) | NEW: TelegramPingsCard, Alert | wireframe «telegram not connected» (limit) |
| refused: already connected | `409 TELEGRAM_ALREADY_LINKED` (connected meanwhile, e.g. from another tab) — the card re-renders from `details.settings` as `connected`; an `Alert` «You're already connected — disconnect first to connect another Telegram account.» until the next re-read (AC-06; flow 8) | NEW: TelegramPingsCard, Alert | — |
| refused: no working bot | `409 PINGS_NEED_WORKING_BOT` (the bot stopped working meanwhile) — the card re-renders from `details.settings` as `no working bot: operator / owner` (AC-13; flow 8) | NEW: TelegramPingsCard | — |
| error: action failed | network / `500` on `createConnectLink` — destructive `Alert` «Couldn't create a connect link — try again.»; on `disconnectTelegram` — «Couldn't disconnect — try again.»; buttons enabled again; the state shown is kept | NEW: TelegramPingsCard, Alert (destructive) | — |
| error: not loaded | the first `getNotificationSettings` fails (network / `500`) — destructive `Alert` «Couldn't load your Telegram settings» + **Retry** in the card; the desktop card is unaffected | Alert (destructive), Button | — |
| live: link or bot changed | `telegram_link.changed` / `bot.changed` / `resync` → re-read → the card switches state without a reload: «Connected» after a Start (also with SCR-17 closed), «Not reachable» after a blocked ping and back to «Connected» after an accepted one, «Pings paused» and back, «Not connected» after a disconnect in another tab, a deactivation-then-reactivation or a different bot (AC-04, AC-06, AC-10; flow 15, flow 16, flow 18) | NEW: TelegramPingsCard | — |
| validation | N/A: no input — every request has no body and names no account (contract) | — | — |
| empty | N/A: «not connected» is a state of the card, not an empty list | — | — |
| phone (< md) | the section menu stacks above (inherited `SettingsLayout`); each card's button goes full width under its text | NEW: DesktopNotificationsCard, NEW: TelegramPingsCard | — |
| guard / live states | → §Shared states | — | §Shared states |

```text
notifications desktop (owner; ≥ lg)
+----------------------------------------------------------------------------+
| Settings                                                                   |
| Manage your workspace's bot and team, and your notifications               |
| ---------------------------------------------------------------------------|
|    Bot        | +------------------------------------------------------+   |
|    Team       | | Desktop notifications                       [Off]    |   |
|  > Notifica-  | | Get a notification on this computer when a customer  |   |
|    tions      | | writes in a conversation that is yours or unassigned |   |
|               | | and you're not looking at Acme Flowers.              |   |
|               | | [Turn on desktop notifications]                      |   |
|               | +------------------------------------------------------+   |
|               | +------------------------------------------------------+   |
|               | | Telegram pings                      [Not connected]  |   |
|               | | Get a message from the Acme Flowers bot in your own  |   |
|               | | Telegram when a customer has waited 5 minutes and    |   |
|               | | you're away from the panel. Pings never include the  |   |
|               | | customer's message or name.                          |   |
|               | | [Connect Telegram]                                   |   |
|               | +------------------------------------------------------+   |
+----------------------------------------------------------------------------+

notifications desktop (on)                    notifications desktop (blocked)
+-----------------------------------------+   +-----------------------------------------+
| Desktop notifications            [On]   |   | Desktop notifications           [Off]   |
| On for Acme Flowers in this browser.    |   | ⚠ Desktop notifications are blocked for |
| Notifications show the customer's name, |   |   this site in your browser. To allow   |
| never the message.                      |   |   them, open the site settings from the |
| [Turn off]                              |   |   icon next to the address bar, set     |
+-----------------------------------------+   |   Notifications to Allow, and come back.|
                                              | The count in the tab title and next to  |
                                              | Inbox keeps working.                    |
                                              +-----------------------------------------+

telegram not connected (limit)
+-----------------------------------------+
| Telegram pings          [Not connected] |
| Get a message from the Acme Flowers bot |
| …                                       |
| ⚠ Connect links are limited to 5 per 10 |
|   minutes — try again at 09:26.         |
| [Connect Telegram]  (disabled)          |
+-----------------------------------------+

telegram no working bot (operator)            telegram no working bot (owner)
+-----------------------------------------+   +-----------------------------------------+
| Telegram pings          [Not connected] |   | Telegram pings          [Not connected] |
| Telegram pings need a working bot that  |   | Telegram pings need a working bot that  |
| receives messages. Ask a business owner |   | receives messages.                      |
| to fix the bot.                         |   | [Open bot settings]                     |
+-----------------------------------------+   +-----------------------------------------+

telegram connected                   (paused)                         (not reachable)
+---------------------------------+  +---------------------------------+  +---------------------------------+
| Telegram pings     [Connected]  |  | Telegram pings  [Pings paused]  |  | Telegram pings [Not reachable]  |
| Connected as Test User since    |  | Pings paused — the bot is not   |  | Not reachable — you blocked the |
| 19 Oct, 09:12.                  |  | working. They start again when  |  | bot in Telegram. Unblock it, or |
| You'll get a ping in Telegram   |  | it works.                       |  | disconnect.                     |
| when customers wait and you're  |  | [Open bot settings] (owner)     |  | [Disconnect]                    |
| away from the panel.            |  | [Disconnect]                    |  +---------------------------------+
| [Disconnect]                    |  +---------------------------------+
+---------------------------------+

notifications phone (operator)
+--------------------------------+
| Settings                       |
| Manage your notifications      |
| [Notifications]                |
| +----------------------------+ |
| | Desktop notifications [Off]| |
| | Get a notification on this | |
| | computer when …            | |
| | [Turn on desktop notific…] | |
| +----------------------------+ |
| +----------------------------+ |
| | Telegram pings             | |
| |            [Not connected] | |
| | …                          | |
| | [     Connect Telegram   ] | |
| +----------------------------+ |
+--------------------------------+
```

### SCR-17 — Connect Telegram

New. A `Dialog` over SCR-16 (Decision 5), opened by a `201 IssuedConnectLink`.

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default: waiting for Start | `201` — title «Connect Telegram»; «Scan the code with your phone, or open the link, then press **Start** in the chat with @<bot_username>.»; the code (`NEW: QrCode`, 192 px) drawn from `url`; **Open in Telegram** (link to `url`, new tab); the link as selectable muted text; «This link works once, until <expires_at, e.g. 09:22>.»; a muted line with a spinner «Waiting for you to press Start in Telegram…»; footer **Get a new link** (`ghost`) and **Close** (AC-04; flow 8; contract `createConnectLink` `201`) | NEW: ConnectTelegramDialog (Dialog, Button, Separator), NEW: QrCode | wireframe «connect dialog» |
| success: connected | `telegram_link.changed` → re-read → `connected` — the code and link are replaced by a check icon and «Connected as <display_name>.» + «The Acme Flowers bot sent you a message in Telegram.»; footer **Done** only; SCR-16 behind shows `connected` (AC-04; flow 18) | NEW: ConnectTelegramDialog | wireframe «connect dialog» (connected) |
| expired | the panel's clock passes `expires_at` with no change — the code is hidden; «This link has expired.»; **Get a new link** becomes the primary button. A Start pressed on the old link is answered «link expired» in Telegram (TG-02) (AC-05; flow 8) | NEW: ConnectTelegramDialog | wireframe «connect dialog» (expired) |
| getting a new link | **Get a new link** — spinner on it, the current code stays; `createConnectLink` again (AC-13; flow 8 «asks again») | NEW: ConnectTelegramDialog | — |
| success: new link | `201` — the code, link and expiry are replaced; the previous link now answers «link expired» in Telegram (AC-05, AC-13; flow 8) | NEW: ConnectTelegramDialog, NEW: QrCode | — |
| error: link limit | `429` on a new link — `Alert` in the dialog «Connect links are limited to 5 per 10 minutes — try again at <retry_at>.»; **Get a new link** disabled until then; the link shown stays valid (refused requests create nothing) (AC-13; Decision 4) | NEW: ConnectTelegramDialog, Alert | — |
| refused: already connected | `409 TELEGRAM_ALREADY_LINKED` on a new link — the dialog shows `success: connected` from `details.settings` (AC-06) | NEW: ConnectTelegramDialog | — |
| bot stopped working | `409 PINGS_NEED_WORKING_BOT` on a new link, or a `bot.changed` re-read that gives `can_connect: false` while still not connected — the code and link are hidden; «Telegram pings need a working bot that receives messages.» + the role's guidance (operator: ask a business owner; owner: **Open bot settings**, which closes the dialog → SCR-08); footer **Close** (AC-13; flow 16, flow 18) | NEW: ConnectTelegramDialog | — |
| error: new link failed | network / `500` on a new link — destructive `Alert` «Couldn't create a new link — try again.»; the current link stays | NEW: ConnectTelegramDialog, Alert (destructive) | — |
| closed early | Esc / close / outside click — the dialog closes; the link keeps working for its 10 minutes; a later Start turns SCR-16 «Connected» live (ux-flows assumption; flow 18) | — | — |
| refused in Telegram | the Start is refused (teammate's account, already connected elsewhere, already connected from this account) — the bot answers in Telegram (TG-02); the panel changes only if the link state changed: «already connected from this account» leaves the member connected, so the dialog stays `success: connected`; the other two leave it `default: waiting for Start` until it expires (AC-06; seeded flow 2) | NEW: ConnectTelegramDialog | — |
| loading | N/A: the dialog opens only with a `201` answer in hand (Decision 4); its own re-reads keep the content shown | — | — |
| empty / validation | N/A: no list, no input | — | — |
| phone (< md) | the dialog is full width; **Open in Telegram** is the first, full-width button; the code shrinks to 160 px under it (Decision 6) | NEW: ConnectTelegramDialog | wireframe «connect dialog phone» |
| guard / live states | → §Shared states (`401` / `403` / `404` close the dialog) | — | §Shared states |

```text
connect dialog (waiting for Start)              connect dialog (connected)
+------------------------------------------+    +------------------------------------------+
| Connect Telegram                     [x] |    | Connect Telegram                     [x] |
| Scan the code with your phone, or open   |    |                                          |
| the link, then press Start in the chat   |    |               ✓                          |
| with @test_flowers_bot.                  |    |     Connected as Test User.              |
|                                          |    |     The Acme Flowers bot sent you a      |
|            ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓               |    |     message in Telegram.                 |
|            ▓▓  QR code   ▓▓               |    |                                          |
|            ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓               |    |                                 [Done]   |
|                                          |    +------------------------------------------+
|          [Open in Telegram]              |
| https://t.me/test_flowers_bot?start=tgi… |    connect dialog (expired)
| This link works once, until 09:22.       |    +------------------------------------------+
| ◌ Waiting for you to press Start in      |    | Connect Telegram                     [x] |
|   Telegram…                              |    | This link has expired.                   |
|------------------------------------------|    |                                          |
|                 [Get a new link] [Close] |    |              [Close] [Get a new link]    |
+------------------------------------------+    +------------------------------------------+

connect dialog phone
+--------------------------------+
| Connect Telegram           [x] |
| Open the link, or scan the     |
| code, then press Start …       |
| [      Open in Telegram      ] |
|        ▓▓▓▓▓▓▓▓▓▓▓▓            |
|        ▓▓ QR code ▓▓            |
|        ▓▓▓▓▓▓▓▓▓▓▓▓            |
| This link works once, until    |
| 09:22.                         |
| ◌ Waiting for you to press     |
|   Start in Telegram…           |
| [Get a new link]      [Close]  |
+--------------------------------+
```

At phone width the first sentence reads «Open the link, or scan the code, then press **Start** in the chat with @<bot_username>.», matching the button order.

### SCR-13 — Settings — Team

Every ui-redesign §SCR-12 / assignment-statuses §SCR-13 state is kept. Added or changed:

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default (changed) | owner opens Team — `listMemberships` items carry `telegram_pings`; the members table gains a column «Telegram pings» after «State» with «On» / «Off» as plain muted text per member (Decision 8); a deactivated member always «Off»; no Telegram name or id anywhere, no link / unlink action in the row menu (AC-12; flow 15) | Table, DataTableToolbar, Card, Avatar, Badge, DropdownMenu | wireframe «team members» |
| success: deactivated / reactivated | the deactivate / reactivate answer `Membership` (`telegram_pings: false`) replaces the row — «Deactivated» / «Active» and «Off»; reactivation never shows «On» again until the member connects (AC-10; flow 15) | Table | — |
| not live | a member connecting or disconnecting while Team is open changes nothing here until Team is opened again (flow 15; sad.md §6 flag) | — | — |
| invitations table | unchanged — no column: an invitation has no Telegram link | Table | — |
| phone (< md) | as before, email moves under the name; «Telegram pings: On / Off» joins it on that line instead of a column (AC-12) | Table | — |
| owners only, loading, empty: no match, error, other states | inherited verbatim — unchanged by this feature (an operator still gets «Only business owners manage the team») | Card, Button, Skeleton, EmptyFilterState, Alert | — |

```text
team members (desktop)
+--------------------------------------------------------------------------+
| [ Search members          ]  [Role ▾]                                    |
|--------------------------------------------------------------------------|
| Name                       | Role            | State      | Telegram pings | ⋯ |
| (AS) Ana Shevchenko        | Business owner  | [Active]   | On             | ⋯ |
|      ana@acme.test         |                 |            |                |   |
| (BP) Bob Petrenko          | Operator        | [Active]   | Off            | ⋯ |
| (IM) Ivan Melnyk           | Operator        | [Deactiv.] | Off            | ⋯ |
+--------------------------------------------------------------------------+
```

### SCR-14 — Confirm member action

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default: confirm deactivate (changed) | inherited text (assignment-statuses §SCR-14 Decision 8); when the row shows «Telegram pings: On», one sentence is added before «You can reactivate them later.»: «Bob's Telegram pings stop, and reactivating does not turn them back on.» Cancel / Deactivate (AC-10; flow 15) | AlertDialog, Button | — |
| pending, errors (last active owner, stale row), confirm revoke | inherited verbatim | AlertDialog, Alert, Button | — |

### SCR-01 — Inbox — conversation list (landing)

Every shared-inbox and assignment-statuses SCR-01 state is kept; no new layout. New entries into existing states:

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default: lens from a combined ping | a TG-03 link `/w/<id>/inbox?assignee=mine`, `?assignee=unassigned` or `/w/<id>/inbox` (open · all) — the existing «lens from the address» state opens that lens (AC-08; flow 14) | extended: InboxList, ConversationList | — |
| default: from the bot's notice | the TG-02 «reply in the panel» link `/w/<id>/inbox` — open · all (AC-11; flow 10) | InboxList | — |
| empty: lens | the conversations were handled before the link was opened — the existing per-lens empty text (e.g. «No open conversations are assigned to you.») (AC-08) | Card | — |
| frame count | the attention count is the frame's (SCR-15); the list itself is unchanged — its unread badges and the count come from the same reads (AC-01) | — | — |
| error, loading, guard / live states | inherited; a signed-out / foreign / deactivated visitor → SCR-09 / SCR-06 / SCR-07 (AC-12; flow 14) | — | §Shared states |

### SCR-02 — Inbox — conversation thread (landing)

Every shared-inbox and assignment-statuses SCR-02 state is kept; no new layout. New entries:

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default: from a single-conversation ping | a TG-03 link `/w/<id>/inbox/<conversationId>` — the thread opens (the existing «opened outside the lens» state when it is not in the default lens) (AC-07, AC-09; flow 14) | Thread, InboxList | — |
| default: from a desktop notification | an OS-02 click — the workspace tab most recently in focus comes forward and navigates to `/w/<id>/inbox/<conversationId>` in place, from whatever workspace page it showed; with no tab of the workspace left, a new window opens that address (through SCR-09 if needed) (AC-02; flow 6) | Thread | — |
| default: assignee unchanged | a team ping (AC-09) never changes the assignee or the status; the header shows them as they are | extended: Thread | — |
| not found | the conversation of another workspace or unknown → SCR-06 in the pane (inherited, no hint) (AC-12; flow 14) | NotFoundCard | — |
| loading, error, guard / live states | inherited | — | §Shared states |

### SCR-06 — Not found (in frame)

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim: shared-inbox `screens.md` §SCR-06. New entries only: a ping or notification link of a workspace the account is not a member of, and `404` on `getAttentionCount` / `getNotificationSettings` / `createConnectLink` / `disconnectTelegram` — no hint that the workspace or conversation exists (AC-12; flow 4, flow 8, flow 14) | AppShell, NotFoundCard | — |
| error / empty | N/A: a static card with no data load | — | — |

### SCR-07 — Access-removed landing

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim: shared-inbox `screens.md` §SCR-07. New entries only: `403 ACCESS_REMOVED` on the four new routes, the socket close `4403` on any workspace page (Settings — Notifications included), and a ping link opened by a deactivated member; nothing of the workspace — count, link state — is shown (AC-10, AC-12; flow 4, flow 8, flow 14, flow 15) | AuthLayout, Alert, Button, Badge | — |
| loading, error, guard states | inherited: shared-inbox §SCR-07 | Skeleton, Alert, Button | — |

### SCR-08 — Settings — Bot

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim: ui-redesign §SCR-11 / bot-connection §SCR-02. New entry only: **Open bot settings** on SCR-16 / SCR-17 (owner) opens `/w/<id>/settings/bot`; the section menu now also lists **Notifications** (Decision 1) (AC-13; flow 8) | SettingsLayout, Card, Badge, Alert, Button | — |
| owners only | inherited: an operator on the Bot address sees «Only business owners manage the bot» + **Back to inbox**; their section menu shows only Notifications (Decision 1) | Card, Button | — |
| loading, error, other states | inherited verbatim — a different bot connected here removes members' links (their SCR-16 → «Not connected»), a disconnect or a lost token pauses pings (their SCR-16 → «Pings paused»); nothing new on this screen (AC-10; flow 16) | Card, Badge, Alert, Button, Skeleton | — |

### SCR-09 — Sign-in

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim: shared-inbox `screens.md` §SCR-09. New entries only: a signed-out visit to a ping link, a desktop-notification address or `/w/<id>/settings/notifications`; the return address keeps the path and lens parameters, so the same conversation, lens or settings page opens after sign-in (AC-12; flow 8, flow 14) | AuthLayout, Field, Input, Label, Button | — |
| validation, error, other states | inherited verbatim | Field, Alert, Button | — |

## Outside the panel

Not panel screens: the panel draws none of them, but the code builds their content, so their copy and behaviour are fixed here. `tasks` cites them like SCR ids; `review` checks the texts against this section. Spec §6 «0 pings containing customer message text or a contact name» applies to TG-02 and TG-03 by construction (the text builders take no such field).

### OS-01 — Browser permission prompt

| State | Trigger / condition | What the panel controls | Source-ref |
| --- | --- | --- | --- |
| default | **Turn on desktop notifications** clicked while permission is `default` — the browser's own prompt; the panel calls `Notification.requestPermission()` only inside that click handler, never on page load or on any other event (AC-03; flow 5) | only the moment it appears; its look and text are the browser's | — |
| answered | allow → SCR-16 `success: on` (after the worker registers); block or dismiss → SCR-16 `error: blocked` (AC-03) | — | — |
| not shown | permission already `granted` (turned on without a prompt) or `denied` (SCR-16 `error: blocked`, no prompt is possible) (AC-03) | — | — |

### OS-02 — Desktop notification

| State | Trigger / condition | Content / behaviour | Source-ref |
| --- | --- | --- | --- |
| default | a `conversation.changed` `created` / `message` frame for an open conversation that is mine or unassigned, the flag on and permission `granted` in this browser, and no tab of this workspace in this browser in focus (a visible tab behind another window does not hold it back) (AC-02; flow 6) | title «<contact name> · Acme Flowers»; body «New message»; icon: the panel favicon; `tag` = `<workspaceId>:<conversationId>`; no message text, no media | wireframe «desktop notification» |
| replaced | another new message in the same conversation before it was dismissed — the same `tag` replaces it, `renotify: true` (alerts again); never a stack (AC-02) | same content | — |
| one per browser | several tabs post the same candidate — the worker drops a message id it has handled, so one notification (AC-02; ADR-0009) | — | — |
| not shown | a teammate's or closed conversation; an edit, a reply or an activity entry; a tab of this workspace in focus; no tab of this workspace open in this browser; flag off or permission no longer granted (AC-02; flow 6) | nothing | — |
| clicked | → SCR-02 `default: from a desktop notification`; the notification closes (AC-02; flow 6) | — | — |

```text
desktop notification (operating system's own style)
+----------------------------------------+
| [icon]  Olena Kravets · Acme Flowers   |
|         New message                    |
+----------------------------------------+
```

### TG-01 — Telegram: start the bot

| State | Trigger / condition | What we control | Source-ref |
| --- | --- | --- | --- |
| default | the SCR-17 link or code opened on the phone — Telegram's own chat screen with the workspace's bot and its **Start** button; the start payload is `tgi_<token>` and is never shown to the member as a message of ours (AC-04; ADR-0004) | nothing visible: the bot's name, photo and description are the business owner's bot profile in BotFather | — |
| already started | the member has chatted with this bot before — Telegram sends `/start tgi_<token>` on opening the link or shows **Start** / **Restart** per its own rules; the outcome is TG-02 either way (AC-04) | — | — |

### TG-02 — Telegram: the bot's answers

Plain text, no parse mode; links are bare URLs on their own line, link preview off (Decision 9). `<panel>` is `PUBLIC_WEB_URL`, `<ws>` the workspace id; «Acme Flowers» stands for the workspace name.

| Kind (`notifications.send-bot-message`) | When | Text | Source-ref |
| --- | --- | --- | --- |
| `connected` | a valid Start linked the account (AC-04) | «You're connected to Acme Flowers. I'll message you here when customers are waiting for a reply.<br>To stop, disconnect Telegram in the panel:<br>`<panel>/w/<ws>/settings/notifications`» | events.md; seeded flow 2 |
| `already_connected` | Start from the account the member is already linked with; the link is used up (AC-06) | «You're already connected to Acme Flowers with this Telegram account.» | events.md |
| `cannot_connect` / `telegram_linked_to_teammate` | this Telegram account is linked to another member of the workspace (AC-06) | «This Telegram account can't be connected: it already receives notifications for another member of Acme Flowers.» | events.md |
| `cannot_connect` / `member_linked_elsewhere` | the member is linked from another Telegram account (AC-06) | «This Telegram account can't be connected: you're already connected from another Telegram account — disconnect it in the panel first.<br>`<panel>/w/<ws>/settings/notifications`» | events.md |
| `link_expired` | no such link, older than 10 min, used, replaced, or the membership is not active (AC-05) | «This connect link has expired. Get a new one in the panel, in Settings → Notifications.» (no link and no workspace detail: the sender may not be a member) | events.md; flow 15 |
| `notifications_off` | Disconnect on SCR-16 (AC-04) | «Notifications from Acme Flowers are off. You can connect again in the panel at any time.» | events.md; flow 9 |
| `chat_only_notifications` | anything a linked member writes, at most once per hour per link (AC-11) | «This chat only sends notifications from Acme Flowers. Replies to customers are written in the panel:<br>`<panel>/w/<ws>/inbox`» | events.md; flow 11 |
| not sent | deactivation, a different bot connected, the bot not working, the person blocked the bot (AC-10; flows 10, 15, 16) | — | events.md |

### TG-03 — Telegram: ping

Plain text as TG-02. The first line is the sentence, the second the link (`<panel>` + the path). Waits per Decision 9. Never a contact name, message text or teammate name (AC-07, AC-09; spec §6).

| Due set | Text | Link | Source-ref |
| --- | --- | --- | --- |
| one, mine | «Acme Flowers: 1 customer is waiting for your reply (5 min)» | `/w/<ws>/inbox/<conversationId>` | AC-07; events.md |
| one, unassigned | «Acme Flowers: an unassigned customer is waiting for a reply (5 min)» | `/w/<ws>/inbox/<conversationId>` | AC-07; events.md |
| one, a teammate's | «Acme Flowers: a teammate's customer is waiting for a reply (31 min)» | `/w/<ws>/inbox/<conversationId>` | AC-09; events.md |
| several, all mine | «Acme Flowers: 4 customers are waiting for your reply, the longest 12 min» | `/w/<ws>/inbox?assignee=mine` | AC-08; events.md |
| several, all unassigned | «Acme Flowers: 4 unassigned customers are waiting, the longest 12 min» | `/w/<ws>/inbox?assignee=unassigned` | AC-08; events.md |
| several, all teammates' | «Acme Flowers: 3 of your teammates' customers are waiting for a reply, the longest 34 min» | `/w/<ws>/inbox` | AC-09; assumption |
| mixed | «Acme Flowers: 4 customers are waiting for a reply (2 yours, 1 unassigned, 1 a teammate's), the longest 1 h 5 min» — only the non-zero parts are listed, in that order | `/w/<ws>/inbox` | AC-08; events.md |
| not sent | the wait ended, the member read it or came back, membership not active, bot not working (Pings paused on SCR-16), an empty set at send time (AC-10; seeded flow 1) | — | events.md |

```text
TG-02 / TG-03 in the member's chat with the Acme Flowers bot
+------------------------------------------------------+
| Acme Flowers Bot                                     |
|------------------------------------------------------|
|                                        /start  ✓✓    |
| You're connected to Acme Flowers. I'll message you   |
| here when customers are waiting for a reply.         |
| To stop, disconnect Telegram in the panel:           |
| https://app.example/w/0192…/settings/notifications   |
|                                                      |
| Acme Flowers: 4 customers are waiting for a reply    |
| (2 yours, 1 unassigned, 1 a teammate's), the longest |
| 12 min                                               |
| https://app.example/w/0192…/inbox                    |
|                                           ok  ✓✓     |
| This chat only sends notifications from Acme         |
| Flowers. Replies to customers are written in the     |
| panel:                                               |
| https://app.example/w/0192…/inbox                    |
+------------------------------------------------------+
```

## New components

| Component | Why no existing primitive fits | Registered in design-system |
| --- | --- | --- |
| DesktopNotificationsCard | SCR-16's browser-only opt-in: capability check, permission state (`default` / `granted` / `denied`), the click-only permission request, worker registration and the per-account-and-workspace `localStorage` flag, with its off / asking / on / blocked / not-available states. No primitive owns this state; composes Card, Badge, Button, Alert | pending |
| TelegramPingsCard | SCR-16's Telegram state machine over `NotificationSettings`: not connected / no working bot (per role) / connected / paused / not reachable, connect and disconnect pending, the limit countdown to `retry_at`, the two `409` re-renders from `details.settings`, and live re-reads. Composes Card, Badge, Button, Alert, Skeleton, ConnectTelegramDialog | pending |
| ConnectTelegramDialog | SCR-17: a `Dialog` holding the issued link, its code, the expiry and its client-side expiry, «waiting for Start», the live turn to «Connected», new-link refusals in place and the bot-stopped state. Like `MediaViewer`, a fixed composition over Dialog; composes Dialog, Button, Separator, Alert, QrCode | pending |
| QrCode | Draws a scannable code for a URL as an inline SVG in the browser (Decision 6). No primitive or shadcn component draws one; `implement` adds a small QR-encoding dependency (or an encoder module) and states it in the task. Props: `value`, `size`, an accessible label («Code for the connect link») | pending |
| AppShell (extended) | Existing component; gains the attention store subscription, the `(N) ` title prefix, the Inbox `SidebarMenuBadge`, the phone header badge, the collapsed tooltip text, the Settings item for operators, and owns the tab's live socket — canon row updated, not duplicated | pending |
| SettingsLayout (extended) | Existing component; gains the **Notifications** section and role-filtered sections with the role's description line and index redirect (Decision 1) — canon row updated | pending |
