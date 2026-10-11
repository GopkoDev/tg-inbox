---
id: T24
title: "Build SCR-02 Bot settings with every declared state"
layer: "ui"
deps: ["T23"]
blocks: ["T25"]
acs: ["AC-03", "AC-07", "AC-15", "AC-16", "AC-16b"]
files_hint: ["apps/web/src/pages/BotSettingsPage.tsx", "apps/web/src/pages/BotSettingsPage.test.tsx", "apps/web/src/features/bot/settings/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T24 — Build SCR-02 Bot settings with every declared state

## Place in the sequence

- **Blocked by:** T23 — store, API client, route stub · **Blocks:** T25 — Build SCR-03 Paste token dialog with every declared state · **Wave:** 4.
- **Lane:** shares `apps/web/src/pages/BotSettingsPage.tsx` with T23, T25, T26 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to see which bot is connected, whether it is working and when the last message arrived
> **So that** I notice a broken connection before customers do
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

This task delivers the page an owner opens to see whether the bot works and what to do if it does not.

## Inlined context

| State | Trigger / condition | Components |
|---|---|---|
| loading | `getBotSettings` in flight | AppShell, Card, skeleton |
| default: not connected | `200 { state: not_connected }` — «No bot is connected» + «Paste the token of your bot from BotFather; messages your customers send to it will arrive here» + **Connect bot** → SCR-03 | Card, Button |
| default: connected | bot name, `@username`, badge «Connected», «Last message received: <date, time>», «Contacts captured: <n>», «Checked with Telegram: <time>»; **New token** → SCR-03, **Disconnect** → SCR-05; never the token | Card, badge, Button |
| empty: no messages yet | `connected`, `last_message_received_at: null`, `contacts_count: 0` — «Last message received: none yet», «Contacts captured: 0» + «Write to @<username> in Telegram to test» | Card |
| needs token | badge «Not working — needs a new token»; destructive alert «Messages are not arriving. Paste a new token of @<username> from BotFather. Everything captured so far is kept.»; primary **Paste new token**; **Disconnect** | badge (destructive), alert |
| taken over | badge «Not receiving messages»; destructive alert «Another service took over this bot's messages. Reconnect to receive them here again; messages the other service received are not recovered.»; primary **Reconnect** (`reconnectBot {}`), **Paste token again**, **Disconnect** | badge, alert, Button |
| reconnecting | **Reconnect** spinner, other actions disabled | Button + `Loader2` |
| success | store replaced, re-render, dialog closes; no toast | — |
| reconnect → takeover warning | `409 TAKEOVER_CONFIRMATION_REQUIRED` → open SCR-04 with `details.bot` | → SCR-04 (T26) |
| reconnect → needs token | `409 BOT_NEEDS_NEW_TOKEN` — store ← `details.settings`, then SCR-03 opens with the server message | → SCR-03 (T25) |
| stale: nothing to do | `409 NOTHING_TO_RECONNECT` / `NO_BOT_CONNECTED` — store ← `details.settings`, notice alert with the server message | alert |
| error: Telegram unavailable | `503` on reconnect — alert «Telegram is not responding — try again», **Reconnect** enabled | alert |
| owners only | `403 OWNER_ONLY` on load — «Only business owners manage the bot» + **Back to home**; no bot data | Card, Button |
| guard states | `401` / `403 ACCESS_REMOVED` / `404` → shared guard table | — |
| error: unexpected | load fails — «Something went wrong» + **Retry**; on an action — alert, previous state kept | alert, Button |

Times in the viewer's locale (`Intl.DateTimeFormat`, date + hours:minutes); `@username` links to `https://t.me/<username>`. Phone: buttons stacked full-width; desktop: one row, **Disconnect** right-aligned.

— `screens.md §SCR-02, abridged` · full text: [screens.md](../screens.md) (wireframes there)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

`getBotSettings` 200/403/404/401; `reconnectBot` 200 / 409 ×3 / 503 — via `features/bot/api.ts` (T23). Copy: error texts are the contract `message` strings; the panel does not invent wording for errors.

## Acceptance criteria

### AC-03 — authorization

> **Given** an operator of "Acme Flowers" who is not a business owner
> **When** they try to connect, rotate or disconnect the bot, or open the bot settings
> **Then** the system refuses and tells them that only business owners manage the bot; a person with no active membership in "Acme Flowers" gets no hint that the workspace or its bot exists
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-07 — happy path

> **Given** "Acme Flowers" has a connected bot and an end customer who has never written to it
> **When** the end customer starts the bot or sends it a first message in a private chat (starting the bot is captured as a message like any other text)
> **Then** within the capture-latency target of §6 (2 seconds at p95) "Acme Flowers" holds a new contact built from the customer's Telegram profile (name, username, language) and a new conversation with that contact containing the message, and the bot settings show the time of that message as the last message received
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** a business owner of "Acme Flowers" with a connected bot that has captured messages from 12 end customers
> **When** they open the bot settings
> **Then** they see the bot's name and username, its state "connected", the time the last message was received and the number of contacts captured — but never the token; the state, name and username are checked with Telegram in the background and are never more than 5 minutes old, and a failed exchange with Telegram changes the state at once
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — error

> **Given** a connected bot whose token was revoked in BotFather, or which was deleted there
> **When** a business owner of "Acme Flowers" opens the bot settings
> **Then** the system shows the state "not working — needs a new token", explains that messages are not arriving until the owner pastes a new token of the same bot, and keeps every contact and conversation already captured; once a new token is pasted (AC-17), messages customers sent meanwhile that Telegram still holds (up to 24 h) are captured in order
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

### AC-16b — cross-context

> **Given** a connected bot of "Acme Flowers" whose messages another service has since taken over
> **When** a business owner opens the bot settings and then chooses to reconnect the bot (with the token already stored — no paste needed; pasting that same token again does the same)
> **Then** the settings show the state "not receiving messages — another service took them over"; on reconnecting, the system gives the warning of AC-06, and after the owner confirms the bot is connected again and new messages are captured into their existing conversations; messages the other service received meanwhile are not recovered
>
> — `spec.md §5, AC-16b, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Replace the stub with the page: load on mount (with `X-Background-Request` off — this is a user open), render by `store.status` / `settings.state` — `pages/BotSettingsPage.tsx`
- [ ] Card body components per state — `features/bot/settings/`
- [ ] Reconnect action wired; dialog hooks for SCR-03/04/05 left as callbacks that T25/T26 implement
- [ ] Testing Library tests: one per state row against a stubbed API — `pages/BotSettingsPage.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| `last_checked_at` older than 5 min (Telegram outage) | shown as is — the "Checked with Telegram" line is the signal |
| Operator | owners-only body, no request beyond the 403 load |

## Definition of Done

- [ ] Testing Library tests render every SCR-02 state row and assert no token-shaped text is ever rendered
- [ ] lint + vet clean (`pnpm lint`)
