---
id: T25
title: "Build SCR-17, the ConnectTelegramDialog: the link with Copy and Open in Telegram, its expiry, waiting for Start, the live turn to Connected, new-link refusals and the bot-stopped state"
layer: "ui"
deps: ["T24"]
blocks: ["T29", "T30"]
acs: ["AC-04", "AC-05", "AC-06", "AC-13"]
files_hint: ["apps/web/src/features/notifications/ConnectTelegramDialog.tsx", "apps/web/src/features/notifications/ConnectTelegramDialog.test.tsx", "apps/web/src/features/notifications/TelegramPingsCard.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T25 — Build SCR-17, the ConnectTelegramDialog: the link with Copy and Open in Telegram, its expiry, waiting for Start, the live turn to Connected, new-link refusals and the bot-stopped state

## Place in the sequence

- **Blocked by:** T24 — Build Settings — Notifications (SCR-16) with the TelegramPingsCard, the notifications store, the role-filtered SettingsLayout and the route · **Blocks:** T29 — Add browser end-to-end notification flows against the real API and the fake Bot API, T30 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the notifications module, the sixth tenancy exception, the new queues, the ports and the new components · **Wave:** 4 — after T24.
- **Lane:** shares `apps/web/src/features/notifications/TelegramPingsCard.tsx` with T24 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
> **So that** the bot can ping me when I am away, and only after I chose so
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It is the one step where the member hands the link to Telegram and sees the panel confirm it by itself.

## Inlined context

> 5. **SCR-17 is a `Dialog`, not an `AlertDialog`.** Nothing is confirmed or lost by closing it: Esc, the close button or a click outside close it; the link stays valid for its 10 minutes and SCR-16 still turns «Connected» if Start is pressed later (ux-flows assumption). Focus returns to **Connect Telegram**.
> 6. **No scannable code in v1.** SCR-17 shows the connect link as selectable text with a **Copy** button and an **Open in Telegram** button; the member opens the link on the phone (Telegram Desktop or a copied link) or on the same device. QR code deferred — would need a new dependency; revisit with pilots (orchestrator amendment, autonomous run 2026-10-19). No image is served (sad.md §4 _Routes_).
>
> — `screens.md §Source, Decisions 5, 6, verbatim` · full text: [screens.md](../screens.md)

> | default: waiting for Start | `201` — title «Connect Telegram»; «Open the link in Telegram, then press **Start** in the chat with @<bot_username>.»; **Open in Telegram** (link to `url`, new tab); the link as selectable muted text with a **Copy** button (`outline`, icon + «Copy»; after a successful `navigator.clipboard.writeText` it reads «Copied» for 2 s; when the clipboard is unavailable or refuses, the button is hidden and the link stays selectable); «This link works once, until <expires_at, e.g. 09:22>.»; a muted line with a spinner «Waiting for you to press Start in Telegram…»; footer **Get a new link** (`ghost`) and **Close** (AC-04; flow 8; contract `createConnectLink` `201`) | NEW: ConnectTelegramDialog (Dialog, Button, Separator) | wireframe «connect dialog» |
> | success: connected | `telegram_link.changed` → re-read → `connected` — the link and its buttons are replaced by a check icon and «Connected as <display_name>.» + «The Acme Flowers bot sent you a message in Telegram.»; footer **Done** only; SCR-16 behind shows `connected` (AC-04; flow 18) | NEW: ConnectTelegramDialog | wireframe «connect dialog» (connected) |
> | expired | the panel's clock passes `expires_at` with no change — the link and its Copy / Open in Telegram buttons are hidden; «This link has expired.»; **Get a new link** becomes the primary button. A Start pressed on the old link is answered «link expired» in Telegram (TG-02) (AC-05; flow 8) | NEW: ConnectTelegramDialog | wireframe «connect dialog» (expired) |
> | error: link limit | `429` on a new link — `Alert` in the dialog «Connect links are limited to 5 per 10 minutes — try again at <retry_at>.»; **Get a new link** disabled until then; the link shown stays valid (refused requests create nothing) (AC-13; Decision 4) | NEW: ConnectTelegramDialog, Alert | — |
> | refused: already connected | `409 TELEGRAM_ALREADY_LINKED` on a new link — the dialog shows `success: connected` from `details.settings` (AC-06) | NEW: ConnectTelegramDialog | — |
> | bot stopped working | `409 PINGS_NEED_WORKING_BOT` on a new link, or a `bot.changed` re-read that gives `can_connect: false` while still not connected — the link and its buttons are hidden; «Telegram pings need a working bot that receives messages.» + the role's guidance (operator: ask a business owner; owner: **Open bot settings**, which closes the dialog → SCR-08); footer **Close** (AC-13; flow 16, flow 18) | NEW: ConnectTelegramDialog | — |
>
> — `screens.md §SCR-17, state table, verbatim` · full text: [screens.md](../screens.md)

> getting a new link (spinner, current link stays) · success: new link (link and expiry replaced) · error: new link failed («Couldn't create a new link — try again.») · closed early (link keeps working) · refused in Telegram (dialog changes only if the link state changed) · phone (full width, Open in Telegram first) · `401` / `403` / `404` close the dialog.
>
> — `screens.md §SCR-17, other states, abridged` · full text: [screens.md](../screens.md)

> | ConnectTelegramDialog | SCR-17: a `Dialog` holding the issued link with its Copy and Open in Telegram buttons, the expiry and its client-side expiry, «waiting for Start», the live turn to «Connected», new-link refusals in place and the bot-stopped state. Like `MediaViewer`, a fixed composition over Dialog; composes Dialog, Button, Separator, Alert | pending |
>
> — `screens.md §New components, ConnectTelegramDialog, verbatim` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Uses the `IssuedConnectLink` from T24's store (`url`, `bot_username`, `expires_at`), `createConnectLink` again for a new link, and `getNotificationSettings` re-reads on `telegram_link.changed` / `bot.changed`. — `contracts/openapi.yaml, createConnectLink, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-04 — happy path

> **Given** an active operator of "Acme Flowers", whose bot is connected, with no Telegram link
> **When** they choose "Connect Telegram" in the panel, open the link it shows on their phone and press Start in the chat with the "Acme Flowers" bot within 10 minutes
> **Then** the bot answers in that chat that it will notify them about waiting customers of "Acme Flowers", and how to stop: disconnect in the panel. The panel shows "Connected" with their Telegram name and since when, without reloading. Starting the bot through this link creates no contact and no conversation and shows nothing in the inbox. Choosing "Disconnect" removes the link at once: the bot sends no further pings and tells them in the chat that notifications are off.
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — error

> **Given** a member who opens a connect link
> **When** the link is older than 10 minutes, was already used, was replaced by a newer link, or belongs to a member who has since been deactivated
> **Then** nothing is linked. The bot answers that the link has expired and that a new one is in the panel. The panel of the member who asked for it still shows "Not connected". The attempt creates no contact and no conversation.
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

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

- [ ] `ConnectTelegramDialog` over shadcn `Dialog`: sentence with @bot_username, **Open in Telegram** (new tab), the link as selectable muted text + **Copy** (`navigator.clipboard.writeText`, «Copied» 2 s, hidden when the clipboard is unavailable), expiry, waiting line, **Get a new link** / **Close** — `apps/web/src/features/notifications/ConnectTelegramDialog.tsx`
- [ ] Client-side expiry timer from `expires_at`; connected / bot-stopped from the store's re-reads; focus returns to **Connect Telegram** — same file
- [ ] Open it from `TelegramPingsCard` on `201` — `apps/web/src/features/notifications/TelegramPingsCard.tsx`
- [ ] Testing Library tests for every SCR-17 state (fake timers, mocked clipboard) — `apps/web/src/features/notifications/ConnectTelegramDialog.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| Clipboard API missing or rejected | Copy hidden; link stays selectable |
| Start pressed after the dialog was closed | SCR-16 turns Connected live |
| Expiry passes | link and its buttons hidden, «This link has expired.», Get a new link primary |
| `409 TELEGRAM_ALREADY_LINKED` on a new link | dialog shows connected from `details.settings` |

## Definition of Done

- [ ] Testing Library tests cover every SCR-17 state in screens.md (waiting for Start with Copy and Open in Telegram, copied and clipboard-unavailable, connected live, expired, getting a new link, new link, link limit, already connected, bot stopped working for both roles, new link failed, closed early, phone layout, guard closes), with no scannable code.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
