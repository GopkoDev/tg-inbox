---
status: approved
feature_size: "M"
tool: "code"
updated_at: "2026-10-11"
---

# Screens — bot-connection

> The canonical **screen manifest** — every screen in every state — produced by `screens` (between
> `api` and `tasks`) and read by `tasks` (each `ui` task cites SCR ids + states), `implement`
> (builds the screen to the declared states) and `review` (the built screen must match this).
> Downstream stages reference **only this manifest** — never the raw Figma / `.pen` file.

## Source

- **Tool:** code (from `docs/design-system.md`: «Tool: code (no design-tool MCP)») — not a
  degradation.
- **File:** inline wireframes below (ASCII, one per state that needs a distinct layout).
- **Component inventory used:** the canon inventory (**AppShell**) plus the shadcn/ui primitives
  already installed in `apps/web/src/shared/ui` — **alert**, **alert-dialog**, **badge**,
  **Button**, **Card**, **dialog**, **dropdown-menu**, **input**, **label**, **skeleton** (the
  sanctioned source per `CLAUDE.md`). Every primitive this feature needs is already installed, so
  nothing new is added from the registry. Icons from `lucide-react`.
- **Posture:** responsive-both (ux-flows.md §Platform decisions) — every screen works at phone
  width (≥ 360 px, 16 px gutter) and desktop width; wireframes show the phone layout where it
  differs.
- **Address and structure** (sad.md §4 «UI architecture», ADR-0001): Bot settings is the page
  `/w/<workspaceId>/bot` (SCR-02); SCR-03, SCR-04 and SCR-05 are dialogs layered over it, so every
  action returns to it. SCR-01 and SCR-06 are the existing `workspace-operators` SCR-06 and SCR-10.
  State lives in `features/bot/store.ts`, loaded on page open and **replaced by the `BotSettings`
  of every action response** (and by `details.settings` of a refusal that carries it).
- **Freshness:** no polling, no push (ADR-0008, sad.md §8 «Live updates») — the page loads on open
  and after each action; it shows when the state was last checked with Telegram.
- **Copy:** user-facing error texts are the contract `message` strings
  (`contracts/openapi.yaml`); the panel shows the server message and does not invent its own
  wording for errors.
- **Token secrecy:** the token exists only in the SCR-03 input and, between a `409
  TAKEOVER_CONFIRMATION_REQUIRED` and the SCR-04 answer, in component memory; it is cleared on
  success, cancel or close, never written to the store, URL, storage or logs, and no state of any
  screen displays it back (AC-01, spec §6 token secrecy).

## Screens

**Shared guard states (every `/api/workspaces/<id>/bot…` call).** Handled once by the existing
workspace-area guard handler (`useShellGuard`, AppShell — `workspace-operators` §Shared guard
states), not re-implemented here. Each screen lists them as one row pointing here.

| Guard answer | What the panel does | Source |
|---|---|---|
| `401 UNAUTHENTICATED` | Shared handler → sign-in with «Sign in to continue», return to `/w/<id>/bot` afterwards | `Unauthenticated` response |
| `403 ACCESS_REMOVED` | Shared handler → clear that workspace's data (incl. the bot store), AC-07 workspace resolution with the `access-removed` notice | `OwnerRouteForbidden` (accessRemoved) |
| `404 NOT_FOUND` | Render SCR-06 in place | AC-03, flow 4 «no active membership», `WorkspaceNotFound` |
| `403 OWNER_ONLY` | **Not** a shared-handler case — SCR-02 state `owners only` | AC-03, flow 4 «member who is not a business owner» |

### SCR-01 — Workspace home

Existing screen (`workspace-operators` SCR-06, built on **AppShell**). This feature changes only
the AppShell header: a **Bot** entry next to **Team**, shown only to business owners, in the
desktop nav and in the phone ☰ menu (sad.md §4 closes the ux-flows design input). Every other state
of the existing screen is unchanged and not repeated here.

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default: owner | `role: owner` — header gains **Bot** (link to `/w/<id>/bot`) after **Team**; the link is marked current on SCR-02 | AppShell, Button (link) | wireframe «owner» |
| default: operator | `role: operator` — no **Bot** entry (and no Team, as before) | AppShell | wireframe «owner» minus Team and Bot |
| loading / error / access-removed / guard states | Unchanged from `workspace-operators` SCR-06 | AppShell | `workspace-operators` screens.md SCR-06 |
| empty | N/A: the home has no data of its own; this feature adds only a nav entry | — | — |

Sources: AC-03 (operators get no entry); sad.md §4 UI architecture; ux-flows SCR-01.

```text
owner — desktop                                        owner — phone
+----------------------------------------------------+ +----------------------------+
| tg-inbox | Acme Flowers ▾ | Team  Bot    ana@… ▾   | | ☰  Acme Flowers ▾          |
+----------------------------------------------------+ +----------------------------+
                                                        ☰ opens: Team · Bot · ana@… · Sign out
```

### SCR-02 — Bot settings

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| loading | Opening `/w/<id>/bot` — `getBotSettings` in flight (AppShell already entered the workspace) | AppShell, Card, skeleton | wireframe «loading» |
| default: not connected | `200 { state: not_connected }` (no bot, or the row kept after a disconnect) — «No bot is connected» + one line on what connecting does («Paste the token of your bot from BotFather; messages your customers send to it will arrive here») + **Connect bot** → SCR-03 | AppShell, Card, Button | wireframe «not connected» |
| default: connected | `200 { state: connected }` — bot name, `@username`, badge «Connected», «Last message received: <date, time>», «Contacts captured: <n>», «Checked with Telegram: <time>»; actions **New token** → SCR-03, **Disconnect** → SCR-05; never the token | AppShell, Card, badge (`default`), Button (`outline` / `ghost` destructive text) | wireframe «connected» |
| empty: no messages yet | `connected` with `last_message_received_at: null` and `contacts_count: 0` — «Last message received: none yet», «Contacts captured: 0» + hint «Write to @<username> in Telegram to test» | Card | wireframe «connected» (other values) |
| needs token | `200 { state: needs_token }` — badge «Not working — needs a new token»; destructive alert «Messages are not arriving. Paste a new token of @<username> from BotFather. Everything captured so far is kept.»; primary **Paste new token** → SCR-03; **Disconnect** → SCR-05; last message / contacts / checked lines as in connected | AppShell, Card, badge (`destructive`), alert (destructive), Button | wireframe «needs token» |
| taken over | `200 { state: taken_over }` — badge «Not receiving messages»; destructive alert «Another service took over this bot's messages. Reconnect to receive them here again; messages the other service received are not recovered.»; primary **Reconnect** (`reconnectBot {}`), secondary **Paste token again** → SCR-03, **Disconnect** → SCR-05 | AppShell, Card, badge (`destructive`), alert (destructive), Button | wireframe «taken over» |
| reconnecting | `reconnectBot` in flight — **Reconnect** shows a spinner, the other actions are disabled | Button (disabled + lucide `Loader2`) | — |
| success | An action answered `BotSettings` (connect, rotate, reconnect, disconnect) — the store is replaced, the page re-renders in that state, the dialog (if any) closes; no toast | — (re-render) | the state's wireframe |
| reconnect → takeover warning | `reconnectBot` → `409 TAKEOVER_CONFIRMATION_REQUIRED` → open SCR-04 with `details.bot` | — (→ SCR-04) | SCR-04 |
| reconnect → needs token | `reconnectBot` → `409 BOT_NEEDS_NEW_TOKEN` — store replaced by `details.settings` (`needs_token`), then SCR-03 opens with the server message as its notice (flow 6 «SCR-02, then SCR-03») | — (→ SCR-03) | SCR-03 «needs-token notice» |
| stale: nothing to do | `409 NOTHING_TO_RECONNECT` (reconnect) or `409 NO_BOT_CONNECTED` (disconnect) — the page was older than the bot's real state: store replaced by `details.settings`, notice alert with the server message above the card | alert (default) | wireframe «stale notice» |
| error: Telegram unavailable | `503 TELEGRAM_UNAVAILABLE` on reconnect — alert «Telegram is not responding — try again», state unchanged, **Reconnect** enabled again | alert (destructive) | — |
| owners only | `403 OWNER_ONLY` on `getBotSettings` (an operator opened the address) — body shows only «Only business owners manage the bot» + **Back to home**; no bot data | AppShell, Card, Button | wireframe «owners only» |
| guard states | `401` / `403 ACCESS_REMOVED` / `404` → shared guard table | — | §Shared guard states |
| error: unexpected | network failure / `500` on load — «Something went wrong» + **Retry**; on an action — alert, the page keeps its previous state | alert (destructive), Button | — |

Sources: AC-01, AC-03, AC-07, AC-15, AC-16, AC-16b, AC-18; sad.md §6 flow 4 (all branches), flow 6, flow 7; ADR-0008; `getBotSettings` 200/400/401/403/404, `reconnectBot` 200/409/503, `disconnectBot` 409.

The three times are shown in the viewer's locale and time zone (`Intl.DateTimeFormat`, date +
hours:minutes). The `@username` links to `https://t.me/<username>` (opens Telegram).

```text
loading                                  not connected
+------------------------------------+   +------------------------------------+
| (AppShell header)                  |   | (AppShell header)                  |
|  Bot                               |   |  Bot                               |
| ┌────────────────────────────────┐ |   | ┌────────────────────────────────┐ |
| │ [▒▒▒▒▒▒▒▒▒▒▒▒]  [▒▒▒▒▒]        │ |   | │ No bot is connected            │ |
| │ [▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒]         │ |   | │ Paste the token of your bot    │ |
| │ [▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒]             │ |   | │ from BotFather; messages your  │ |
| └────────────────────────────────┘ |   | │ customers send to it will      │ |
+------------------------------------+   | │ arrive here.                   │ |
                                         | │ [        Connect bot        ]  │ |
                                         | └────────────────────────────────┘ |
                                         +------------------------------------+
connected — desktop (card max-w-xl)
+------------------------------------------------------------------+
| tg-inbox | Acme Flowers ▾ | Team  Bot              ana@… ▾       |
+------------------------------------------------------------------+
|  Bot                                                             |
| ┌──────────────────────────────────────────────────────────────┐ |
| │ Acme Flowers Support   [Connected]                           │ |
| │ @acme_flowers_bot                                            │ |
| │                                                              │ |
| │ Last message received   11 Oct 2026, 09:58                   │ |
| │ Contacts captured       12                                   │ |
| │ Checked with Telegram   10:03                                │ |
| │                                                              │ |
| │ [ New token ]                               [ Disconnect ]   │ |
| └──────────────────────────────────────────────────────────────┘ |
+------------------------------------------------------------------+

needs token — phone                      taken over — phone
+------------------------------------+   +------------------------------------+
| ☰  Acme Flowers ▾                  |   | ☰  Acme Flowers ▾                  |
+------------------------------------+   +------------------------------------+
|  Bot                               |   |  Bot                               |
| ┌────────────────────────────────┐ |   | ┌────────────────────────────────┐ |
| │ Acme Flowers Support           │ |   | │ Acme Flowers Support           │ |
| │ @acme_flowers_bot              │ |   | │ @acme_flowers_bot              │ |
| │ [Not working — needs a new     │ |   | │ [Not receiving messages]       │ |
| │  token]                        │ |   | │ ┌────────────────────────────┐ │ |
| │ ┌────────────────────────────┐ │ |   | │ │ ! Another service took over│ │ |
| │ │ ! Messages are not arriving│ │ |   | │ │ this bot's messages.       │ │ |
| │ │ Paste a new token of       │ │ |   | │ │ Reconnect to receive them  │ │ |
| │ │ @acme_flowers_bot from     │ │ |   | │ │ here again; messages the   │ │ |
| │ │ BotFather. Everything      │ │ |   | │ │ other service received are │ │ |
| │ │ captured so far is kept.   │ │ |   | │ │ not recovered.             │ │ |
| │ └────────────────────────────┘ │ |   | │ └────────────────────────────┘ │ |
| │ Last message  11 Oct, 08:40    │ |   | │ Last message  11 Oct, 08:40    │ |
| │ Contacts      12               │ |   | │ Contacts      12               │ |
| │ Checked       10:03            │ |   | │ Checked       10:03            │ |
| │ [     Paste new token      ]   │ |   | │ [        Reconnect         ]   │ |
| │ [        Disconnect        ]   │ |   | │ [     Paste token again    ]   │ |
| └────────────────────────────────┘ |   | │ [        Disconnect        ]   │ |
+------------------------------------+   | └────────────────────────────────┘ |
                                         +------------------------------------+
stale notice (above the card)            owners only
| ┌────────────────────────────────┐ |   +------------------------------------+
| │ i No bot is connected          │ |   |  Only business owners manage the   |
| └────────────────────────────────┘ |   |  bot                               |
                                         |  [       Back to home       ]      |
                                         +------------------------------------+
```

On phone the action buttons stack full-width; on desktop they sit in one row with **Disconnect**
right-aligned. The primary action is the state's way out: **Connect bot** / **Paste new token** /
**Reconnect**; in `connected` no action is primary.

### SCR-03 — Paste token

A `dialog` over SCR-02. Title «Connect bot» (from not connected) or «New token» (from connected,
needs token, taken over); one field plus a two-line hint «Open @BotFather in Telegram → /mybots →
your bot → API Token, copy it and paste it here».

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | **Connect bot** / **New token** / **Paste new token** / **Paste token again** on SCR-02 — empty token field (`autoComplete="off"`, `spellCheck={false}`, plain text so the owner can check the paste), **Cancel**, **Connect** / **Save token** | dialog, input, label, Button | wireframe «default» |
| needs-token notice | Opened after `reconnectBot` → `409 BOT_NEEDS_NEW_TOKEN` — destructive alert with the server message above the field | dialog, alert (destructive) | wireframe «default» + alert |
| validation | Empty after trimming → «Paste the token from BotFather» under the field, checked client-side, no request; over 512 chars blocked client-side by the shared `BotTokenPaste` schema; a server `400 VALIDATION_ERROR` shows its message under the field | input (`aria-invalid`), label | field error line |
| submitting | `pasteBotToken` in flight — field and buttons disabled, submit spinner (up to ~3 s, NFR) | Button (disabled + `Loader2`) | — |
| error: token not valid | `400 BOT_TOKEN_INVALID` — alert «The token is not valid — copy it again from BotFather»; the field is cleared and focused; nothing changed on SCR-02 | alert (destructive) | wireframe «error» |
| error: another workspace | `409 BOT_BELONGS_TO_ANOTHER_WORKSPACE` — alert «This bot already belongs to another workspace» (no workspace named); field cleared | alert (destructive) | wireframe «error» (other text) |
| error: one bot — connected | `409 WORKSPACE_KEEPS_ONE_BOT`, `details.reason: connected` — alert with the server message («… disconnect the current bot first»); field cleared | alert (destructive) | wireframe «error» (other text) |
| error: one bot — history | `409 WORKSPACE_KEEPS_ONE_BOT`, `details.reason: history` — alert with the server message («… your customers know only the bot they wrote to»); field cleared | alert (destructive) | wireframe «error» (other text) |
| error: Telegram unavailable | `503 TELEGRAM_UNAVAILABLE` — alert «Telegram is not responding — try again»; the token **stays** in the field so **Connect** can be pressed again | alert (destructive) | wireframe «error» (other text) |
| takeover warning | `409 TAKEOVER_CONFIRMATION_REQUIRED` — the dialog hands the token (memory only) to SCR-04 and closes | — (→ SCR-04) | SCR-04 |
| success | `200 BotSettings` (connect AC-01, rotate AC-17 / AC-16, connect again AC-19, re-paste after takeover AC-16b) — store replaced, the field is cleared, the dialog closes, SCR-02 shows the new state | — (→ SCR-02) | SCR-02 «connected» |
| cancelled | **Cancel** / ✕ / Esc / outside click (not while submitting) — field cleared, back to SCR-02 unchanged | — (→ SCR-02) | — |
| owners only | `403 OWNER_ONLY` — not reachable from the UI; if returned the dialog closes and SCR-02 shows `owners only` | — (→ SCR-02) | SCR-02 «owners only» |
| guard states | `401` / `403 ACCESS_REMOVED` / `404` → shared guard table (the token is dropped) | — | §Shared guard states |
| error: unexpected | network failure / `413` / `415` / `500` — alert «Something went wrong — try again»; the token stays in the field | alert (destructive) | — |
| loading | N/A: opens instantly over the loaded SCR-02, no fetch of its own | — | — |
| empty | N/A: a single-field form | — | — |

Sources: AC-01, AC-02, AC-04, AC-05, AC-06, AC-16, AC-16b, AC-17, AC-19; sad.md §6 critical flow 1 (all branches), flow 5, flow 6; `pasteBotToken` 200/400/403/409/503.

```text
default (dialog; phone = full-width sheet-like dialog)   error
+------------------------------------------+   +------------------------------------------+
|  Connect bot                          ✕  |   |  Connect bot                          ✕  |
|                                          |   | ┌──────────────────────────────────────┐ |
|  Open @BotFather in Telegram → /mybots → |   | │ ! The token is not valid — copy it   │ |
|  your bot → API Token, copy it and paste |   | │   again from BotFather               │ |
|  it here.                                |   | └──────────────────────────────────────┘ |
|                                          |   |  Bot token                               |
|  Bot token                               |   |  [__________________________________]    |
|  [__________________________________]    |   |                                          |
|                                          |   |                  [ Cancel ] [ Connect ]  |
|                  [ Cancel ] [ Connect ]  |   +------------------------------------------+
+------------------------------------------+
```

### SCR-04 — Confirm takeover

An `alert-dialog` (a confirmation, as `workspace-operators` SCR-07's confirms). Opened from SCR-03
(paste) or from SCR-02 (**Reconnect**) when the server answers `409 TAKEOVER_CONFIRMATION_REQUIRED`.

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | Title «Take over @<username>?» (`details.bot`); text = the server message «Connecting will stop this bot delivering messages to another service» + «Only do this if you no longer use that service.»; **Cancel**, **Connect** (destructive) | alert-dialog, Button | wireframe «default» |
| submitting | Confirm sent — `pasteBotToken { token, confirm_takeover: true }` (from SCR-03) or `reconnectBot { confirm_takeover: true }` (from SCR-02); both buttons disabled, spinner on **Connect** | Button (disabled + `Loader2`) | — |
| success | `200 BotSettings` → store replaced, dialog closes, token dropped, SCR-02 «connected» | — (→ SCR-02) | SCR-02 «connected» |
| cancelled | **Cancel** / Esc — no request, token dropped, back to SCR-02 unchanged (still not connected / taken over / previous state) | — (→ SCR-02) | — |
| error: refused on re-check | The confirming request re-runs every check: `400 BOT_TOKEN_INVALID`, `409 BOT_BELONGS_TO_ANOTHER_WORKSPACE`, `409 WORKSPACE_KEEPS_ONE_BOT` (paste path) → the dialog closes and SCR-03 reopens in that error state; `409 BOT_NEEDS_NEW_TOKEN` (reconnect path) → SCR-02 «reconnect → needs token»; `409 NOTHING_TO_RECONNECT` → SCR-02 «stale» | — (→ SCR-03 / SCR-02) | SCR-03 errors, SCR-02 |
| error: Telegram unavailable | `503 TELEGRAM_UNAVAILABLE` — alert inside the dialog «Telegram is not responding — try again»; **Connect** enabled again, token kept | alert (destructive) | — |
| guard states | `401` / `403 ACCESS_REMOVED` / `404` → shared guard table (token dropped) | — | §Shared guard states |
| error: unexpected | network failure / `500` — alert «Something went wrong — try again» in the dialog; nothing changed | alert (destructive) | — |
| loading | N/A: opened with the bot already in hand from the `409` details | — | — |
| empty | N/A: a confirmation | — | — |

Sources: AC-06, AC-16b; sad.md §6 critical flow 1 «confirmation required», flow 5, flow 6; `pasteBotToken` / `reconnectBot` 409 `TakeoverConfirmationRequiredError`, 503.

```text
default (alert-dialog)
+------------------------------------------+
|  Take over @acme_flowers_bot?            |
|                                          |
|  Connecting will stop this bot           |
|  delivering messages to another service. |
|  Only do this if you no longer use that  |
|  service.                                |
|                                          |
|                  [ Cancel ] [ Connect ]  |
+------------------------------------------+
```

### SCR-05 — Confirm disconnect

An `alert-dialog` over SCR-02, opened by **Disconnect** in any live state (connected, needs token,
taken over).

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | «Disconnect @<username>?» — «Messages sent to the bot from now on will never reach tg-inbox. tg-inbox forgets the token. Contacts and conversations captured so far stay.»; **Cancel**, **Disconnect** (destructive) | alert-dialog, Button | wireframe «default» |
| submitting | `disconnectBot` in flight — buttons disabled, spinner on **Disconnect** | Button (disabled + `Loader2`) | — |
| success | `200 { state: not_connected }` → store replaced, dialog closes, SCR-02 «not connected» | — (→ SCR-02) | SCR-02 «not connected» |
| cancelled | **Cancel** / Esc — no request, SCR-02 unchanged | — (→ SCR-02) | — |
| error: Telegram unavailable | `503 TELEGRAM_UNAVAILABLE` — alert inside the dialog «Telegram is not responding — try again»; the bot is still connected; **Disconnect** enabled again | alert (destructive) | — |
| error: no bot connected | `409 NO_BOT_CONNECTED` — dialog closes, SCR-02 «stale» with `details.settings` | — (→ SCR-02) | SCR-02 «stale notice» |
| guard states | `401` / `403 ACCESS_REMOVED` / `404` → shared guard table; `403 OWNER_ONLY` → SCR-02 «owners only» | — | §Shared guard states |
| error: unexpected | network failure / `400` / `413` / `415` / `500` — alert «Something went wrong — try again»; nothing changed | alert (destructive) | — |
| loading | N/A: opens instantly over the loaded SCR-02 | — | — |
| empty | N/A: a confirmation | — | — |

Sources: AC-18; sad.md §6 flow 7 (all branches); `disconnectBot` 200/409/503.

```text
default (alert-dialog)
+------------------------------------------+
|  Disconnect @acme_flowers_bot?           |
|                                          |
|  Messages sent to the bot from now on    |
|  will never reach tg-inbox. tg-inbox     |
|  forgets the token. Contacts and         |
|  conversations captured so far stay.     |
|                                          |
|               [ Cancel ] [ Disconnect ]  |
+------------------------------------------+
```

### SCR-06 — Not found

Existing screen (`workspace-operators` SCR-10, `NotFoundPage`), rendered in place when the guard
answers `404 NOT_FOUND` for `/w/<id>/bot` — no workspace name, no hint the bot exists. Unchanged;
all its states (default; loading / empty / error N/A) are as declared in `workspace-operators`
screens.md SCR-10.

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | `getBotSettings` → `404 NOT_FOUND` (never a member, unknown or malformed id) | Card, Button | `workspace-operators` screens.md SCR-10 wireframe |
| loading / empty / error | N/A: as declared in `workspace-operators` SCR-10 — rendered after the guarded request answered; a message screen | — | — |

Sources: AC-03; sad.md §6 flow 4 «no active membership»; `WorkspaceNotFound` response.

## New components

None — all screens compose the existing inventory (AppShell, gaining an owner-only **Bot** nav
entry next to **Team**) and shadcn/ui primitives already installed in `apps/web/src/shared/ui`; no
registry primitive needs to be added. When `implement` touches AppShell, its row in
`docs/design-system.md` should mention the **Bot** link alongside the owner-only Team link.

| Component | Why no existing primitive fits | Registered in design-system |
|---|---|---|
| — | — | — |
