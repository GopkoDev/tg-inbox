---
id: T25
title: "Build SCR-03 Paste token dialog with every declared state"
layer: "ui"
deps: ["T24"]
blocks: ["T26"]
acs: ["AC-01", "AC-02", "AC-04", "AC-05", "AC-17", "AC-19"]
files_hint: ["apps/web/src/features/bot/paste-token/", "apps/web/src/pages/BotSettingsPage.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T25 — Build SCR-03 Paste token dialog with every declared state

## Place in the sequence

- **Blocked by:** T24 — SCR-02 page · **Blocks:** T26 — Build SCR-04 Confirm takeover and SCR-05 Confirm disconnect · **Wave:** 5.
- **Lane:** shares `apps/web/src/pages/BotSettingsPage.tsx` with T23, T24, T26 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to connect the business bot to my workspace by pasting its token
> **So that** messages from our customers start arriving in tg-inbox without help from the tg-inbox team
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to give the connected bot a new token or disconnect it
> **So that** a leaked token or a bot we stop using does not put our customers at risk, without losing what was captured
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task is the one paste that connects, rotates or reconnects, with a clear reason whenever it is refused.

## Inlined context

A `dialog` over SCR-02. Title «Connect bot» (from not connected) or «New token» (otherwise); hint «Open @BotFather in Telegram → /mybots → your bot → API Token, copy it and paste it here».

| State | Trigger / condition | Components |
|---|---|---|
| default | empty token field (`autoComplete="off"`, `spellCheck={false}`, plain text), **Cancel**, **Connect** / **Save token** | dialog, input, label, Button |
| needs-token notice | opened after `reconnectBot` → `409 BOT_NEEDS_NEW_TOKEN` — destructive alert with the server message above the field | alert |
| validation | empty after trimming → «Paste the token from BotFather», no request; > 512 chars blocked by `BotTokenPaste`; server `400 VALIDATION_ERROR` message under the field | input `aria-invalid` |
| submitting | `pasteBotToken` in flight — field and buttons disabled, spinner (up to ~3 s) | Button + `Loader2` |
| error: token not valid | `400 BOT_TOKEN_INVALID` — alert «The token is not valid — copy it again from BotFather»; field cleared and focused | alert |
| error: another workspace | `409 BOT_BELONGS_TO_ANOTHER_WORKSPACE` — alert «This bot already belongs to another workspace»; field cleared | alert |
| error: one bot — connected / history | `409 WORKSPACE_KEEPS_ONE_BOT` `details.reason` — alert with the server message; field cleared | alert |
| error: Telegram unavailable | `503` — alert «Telegram is not responding — try again»; token **stays** in the field | alert |
| takeover warning | `409 TAKEOVER_CONFIRMATION_REQUIRED` — hand the token (memory only) to SCR-04 and close | → SCR-04 (T26) |
| success | `200 BotSettings` — store replaced, field cleared, dialog closes | → SCR-02 |
| cancelled | **Cancel** / ✕ / Esc / outside click (not while submitting) — field cleared | → SCR-02 |
| owners only | `403 OWNER_ONLY` — dialog closes, SCR-02 `owners only` | → SCR-02 |
| guard states | shared guard table; token dropped | — |
| error: unexpected | network / `413` / `415` / `500` — alert «Something went wrong — try again»; token stays | alert |

— `screens.md §SCR-03, abridged` · full text: [screens.md](../screens.md)

> the token exists only in the SCR-03 input and, between a `409 TAKEOVER_CONFIRMATION_REQUIRED` and the SCR-04 answer, in component memory; it is cleared on success, cancel or close, never written to the store, URL, storage or logs
>
> — `screens.md §Source, Token secrecy, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

`pasteBotToken({ token, confirm_takeover: false })` → 200 `BotSettings` · 400 `BOT_TOKEN_INVALID` / `VALIDATION_ERROR` · 409 `BOT_BELONGS_TO_ANOTHER_WORKSPACE` / `WORKSPACE_KEEPS_ONE_BOT {reason}` / `TAKEOVER_CONFIRMATION_REQUIRED {bot}` · 503 — [openapi.yaml](../contracts/openapi.yaml).

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers", which has no connected bot, and the token of the business's bot "Acme Flowers Support", which is not connected to any workspace
> **When** the owner pastes the token (surrounding spaces are ignored) and confirms
> **Then** the system checks the token with Telegram, connects the bot, and shows the owner the bot's name and username with the state "connected"; from then on the bot's private messages are captured into "Acme Flowers", and the token itself is never shown again
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — error

> **Given** a business owner of "Acme Flowers" connecting a bot or giving the connected bot a new token
> **When** the pasted text is not a bot token, or Telegram does not accept it (mistyped, revoked, or the bot was deleted)
> **Then** the system changes nothing — an existing connection keeps working as before — and tells the owner the token is not valid — copy it again from BotFather
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-04 — domain invariant

> **Given** a business owner of "Bolt Bikes" and the token of a bot that is connected to another workspace, or through which another workspace has captured conversations
> **When** the owner pastes that token
> **Then** the system refuses and explains that the bot already belongs to another workspace, without revealing which one
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — domain invariant

> **Given** "Acme Flowers" has a connected bot, or has captured conversations through a bot it later disconnected
> **When** a business owner pastes the token of a different bot
> **Then** the system refuses and explains that a workspace keeps one business bot — while connected, disconnect it first; once customers have written to it, the workspace stays with that bot (its customers know only that bot)
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — happy path

> **Given** a business owner of "Acme Flowers" whose bot is connected (or not working because its old token was revoked)
> **When** they paste a new token of the same bot
> **Then** the bot is connected with the new token, the old token is no longer used, and new messages from existing end customers continue their existing conversations
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

### AC-19 — cross-context

> **Given** "Acme Flowers" disconnected its bot earlier and its contacts and conversations remain
> **When** a business owner connects the same bot again by pasting its token and an existing end customer writes to it
> **Then** the message continues that customer's existing conversation and no duplicate contact is created
>
> — `spec.md §5, AC-19, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `PasteTokenDialog` (shadcn `Dialog`, `Input`, `Label`, `Alert`, `Button`) with local token state only — `features/bot/paste-token/PasteTokenDialog.tsx`
- [ ] Open from **Connect bot** / **New token** / **Paste new token** / **Paste token again** and from the reconnect → needs-token path; hand off to SCR-04 via a callback carrying `{ token, bot }` — `pages/BotSettingsPage.tsx`
- [ ] Testing Library tests: every state row; the token never reaches the store (spy) — `features/bot/paste-token/PasteTokenDialog.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| Paste with surrounding spaces | sent as typed; server trims (AC-01) |
| Esc while submitting | ignored |
| Close after a 503 | token dropped |

## Definition of Done

- [ ] Testing Library tests render every SCR-03 state and prove the token is cleared on success, cancel and close
- [ ] lint + vet clean (`pnpm lint`)
