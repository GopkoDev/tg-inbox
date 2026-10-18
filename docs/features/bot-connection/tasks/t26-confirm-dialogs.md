---
id: T26
title: "Build SCR-04 Confirm takeover and SCR-05 Confirm disconnect"
layer: "ui"
deps: ["T25"]
blocks: ["T27"]
acs: ["AC-06", "AC-16b", "AC-18"]
files_hint: ["apps/web/src/features/bot/confirm-takeover/", "apps/web/src/features/bot/confirm-disconnect/", "apps/web/src/pages/BotSettingsPage.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T26 — Build SCR-04 Confirm takeover and SCR-05 Confirm disconnect

## Place in the sequence

- **Blocked by:** T25 — SCR-03 hands the token to SCR-04 · **Blocks:** T27 — Add the seven browser end-to-end flows for bot settings against the fake Bot API · **Wave:** 6.
- **Lane:** shares `apps/web/src/pages/BotSettingsPage.tsx` with T23–T25 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to see which bot is connected, whether it is working and when the last message arrived
> **So that** I notice a broken connection before customers do
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to give the connected bot a new token or disconnect it
> **So that** a leaked token or a bot we stop using does not put our customers at risk, without losing what was captured
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task adds the two confirmations: before taking a bot's messages from another service, and before disconnecting.

## Inlined context

**SCR-04** (`alert-dialog`, opened from SCR-03 paste or SCR-02 **Reconnect** on `409 TAKEOVER_CONFIRMATION_REQUIRED`):

| State | Behaviour |
|---|---|
| default | Title «Take over @<username>?» (`details.bot`); text = server message «Connecting will stop this bot delivering messages to another service» + «Only do this if you no longer use that service.»; **Cancel**, **Connect** (destructive) |
| submitting | `pasteBotToken { token, confirm_takeover: true }` (from SCR-03) or `reconnectBot { confirm_takeover: true }` (from SCR-02); buttons disabled, spinner |
| success | store replaced, dialog closes, token dropped, SCR-02 «connected» |
| cancelled | no request, token dropped, SCR-02 unchanged |
| error: refused on re-check | `400 BOT_TOKEN_INVALID` / `409 BOT_BELONGS_TO_ANOTHER_WORKSPACE` / `409 WORKSPACE_KEEPS_ONE_BOT` (paste) → close, SCR-03 reopens in that error; `409 BOT_NEEDS_NEW_TOKEN` (reconnect) → SCR-02 «reconnect → needs token»; `409 NOTHING_TO_RECONNECT` → SCR-02 «stale» |
| error: Telegram unavailable | alert in the dialog; **Connect** enabled, token kept |
| guard / unexpected | shared guard table (token dropped) / alert «Something went wrong — try again» |

**SCR-05** (`alert-dialog`, **Disconnect** in any live state):

| State | Behaviour |
|---|---|
| default | «Disconnect @<username>?» — «Messages sent to the bot from now on will never reach tg-inbox. tg-inbox forgets the token. Contacts and conversations captured so far stay.»; **Cancel**, **Disconnect** (destructive) |
| submitting | `disconnectBot`; buttons disabled, spinner |
| success | `200 { state: not_connected }` → SCR-02 «not connected» |
| cancelled | no request |
| error: Telegram unavailable | alert in dialog; bot still connected; **Disconnect** enabled |
| error: no bot connected | `409 NO_BOT_CONNECTED` → close, SCR-02 «stale» with `details.settings` |
| guard / unexpected | shared table; `403 OWNER_ONLY` → SCR-02 «owners only» / alert «Something went wrong — try again» |

— `screens.md §SCR-04 + §SCR-05, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

`pasteBotToken` / `reconnectBot` with `confirm_takeover: true`; `disconnectBot` → 200 / 409 `NO_BOT_CONNECTED {settings}` / 503 — [openapi.yaml](../contracts/openapi.yaml).

## Acceptance criteria

### AC-06 — cross-context

> **Given** a business owner of "Acme Flowers" pasting a valid token of a bot that, according to Telegram, currently delivers its messages to another address (another service); a service that instead fetches the bot's messages itself is not visible to tg-inbox and gets no warning
> **When** the system checks the token
> **Then** before connecting, it warns the owner that connecting will stop that bot delivering messages to the other service, and connects only after the owner confirms
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-16b — cross-context

> **Given** a connected bot of "Acme Flowers" whose messages another service has since taken over
> **When** a business owner opens the bot settings and then chooses to reconnect the bot (with the token already stored — no paste needed; pasting that same token again does the same)
> **Then** the settings show the state "not receiving messages — another service took them over"; on reconnecting, the system gives the warning of AC-06, and after the owner confirms the bot is connected again and new messages are captured into their existing conversations; messages the other service received meanwhile are not recovered
>
> — `spec.md §5, AC-16b, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — happy path

> **Given** a business owner of "Acme Flowers" with a connected bot
> **When** they disconnect it and confirm
> **Then** the bot settings show "not connected", the bot stops delivering its messages to tg-inbox, its token is no longer kept by tg-inbox, messages sent to the bot afterwards are never captured (not even if the bot is connected again later), and every contact and conversation captured so far stays in the workspace
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `ConfirmTakeoverDialog` (shadcn `AlertDialog`) taking `{ bot, resubmit }` — `features/bot/confirm-takeover/`
- [ ] `ConfirmDisconnectDialog` — `features/bot/confirm-disconnect/`
- [ ] Wire both into the page, incl. SCR-04 → SCR-03 reopen on paste-path refusals — `pages/BotSettingsPage.tsx`
- [ ] Testing Library tests: every state row of both dialogs; cancel sends no request

## Edge cases

| Case | Behaviour |
|---|---|
| Confirm after the token was revoked meanwhile | SCR-03 reopens with «The token is not valid…» |
| Two fast clicks on **Connect** | one request (disabled while submitting) |

## Definition of Done

- [ ] Testing Library tests render every SCR-04 and SCR-05 state and prove cancel sends nothing and the token is dropped
- [ ] lint + vet clean (`pnpm lint`)
