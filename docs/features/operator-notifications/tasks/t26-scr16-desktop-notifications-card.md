---
id: T26
title: "Build the DesktopNotificationsCard on SCR-16: capability and permission checks, the click-only permission request (OS-01), worker registration and the per-browser flag"
layer: "ui"
deps: ["T24"]
blocks: ["T27", "T30"]
acs: ["AC-03"]
files_hint: ["apps/web/src/features/notifications/desktop.ts", "apps/web/src/features/notifications/DesktopNotificationsCard.tsx", "apps/web/src/features/notifications/DesktopNotificationsCard.test.tsx", "apps/web/src/pages/NotificationSettingsPage.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "S"
status: "todo"
---

# T26 — Build the DesktopNotificationsCard on SCR-16: capability and permission checks, the click-only permission request (OS-01), worker registration and the per-browser flag

## Place in the sequence

- **Blocked by:** T24 — Build Settings — Notifications (SCR-16) with the TelegramPingsCard, the notifications store, the role-filtered SettingsLayout and the route · **Blocks:** T27 — Add the desktop notifier and the notifications-only service worker: candidates from the tabs, focus check, tag replace, dedupe and the click to the most recently focused tab (OS-02), T30 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the notifications module, the sixth tenancy exception, the new queues, the ports and the new components · **Wave:** 4 — after T24.
- **Lane:** shares `apps/web/src/pages/NotificationSettingsPage.tsx` with T24 — serialized.

## Why (user story)

> **As an** Operator
> **I want** a desktop notification when a customer writes in a conversation that is mine or unassigned and I am not looking at the panel
> **So that** I notice it while I work in another window
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It is the member's per-browser opt-in, which never asks the browser without their click.

## Inlined context

> | default: off | the browser supports notifications, storage works, permission `default` (not asked) or `granted`, flag off — title «Desktop notifications», `Badge` «Off» (outline); «Get a notification on this computer when a customer writes in a conversation that is yours or unassigned and you're not looking at Acme Flowers.»; **Turn on desktop notifications** (AC-02, AC-03; flow 5) | NEW: DesktopNotificationsCard (Card, Badge, Button) | wireframe «notifications desktop» |
> | asking | the button clicked with permission `default` — the browser's own prompt (OS-01) is open; the button shows a spinner and is disabled. The panel never asks without this click (AC-03; flow 5) | NEW: DesktopNotificationsCard | — |
> | success: on | allowed (or already `granted`) and the worker registered — flag stored; `Badge` «On»; «On for Acme Flowers in this browser. Notifications show the customer's name, never the message.»; **Turn off** (`outline`) (AC-02; flow 5) | NEW: DesktopNotificationsCard | wireframe «notifications desktop» (on) |
> | error: blocked | the member blocks or dismisses OS-01, or permission is already `denied` (also when it was revoked in the browser while the flag was on) — `Badge` «Off»; «Desktop notifications are blocked for this site in your browser. To allow them, open the site settings from the icon next to the address bar, set Notifications to Allow, and come back here.»; no button that asks again; «The count in the tab title and next to Inbox keeps working.» (AC-03; flow 5, flow 6) | NEW: DesktopNotificationsCard, Alert | wireframe «notifications desktop» (blocked) |
> | error: not available | the browser cannot show notifications (no Notification API or service worker), the flag cannot be stored, or the worker registration fails — `Badge` «Not available»; «This browser can't show desktop notifications. The count in the tab title and next to Inbox keeps working.»; no button (AC-03; flow 5) | NEW: DesktopNotificationsCard | — |
> | turned off | **Turn off** — flag cleared at once; the worker is unregistered when no workspace in this browser keeps the flag; back to `default: off` (flow 5) | NEW: DesktopNotificationsCard | — |
>
> — `screens.md §SCR-16, Desktop notifications card, verbatim` · full text: [screens.md](../screens.md)

> | default | **Turn on desktop notifications** clicked while permission is `default` — the browser's own prompt; the panel calls `Notification.requestPermission()` only inside that click handler, never on page load or on any other event (AC-03; flow 5) | only the moment it appears; its look and text are the browser's | — |
>
> — `screens.md §OS-01, default, verbatim` · full text: [screens.md](../screens.md)

> The desktop opt-in is a per-browser flag in `localStorage`, keyed by account and workspace. It is a per-viewer convenience, read in try/catch, and is off when storage is unavailable.
>
> — `sad.md §4, UI architecture, stores, abridged` · full text: [sad.md](../sad.md)

> - **Registration.** The SPA registers `/notifications-sw.js` (scope `/`) only after the member turns desktop notifications on. Permission is asked only on that click.
>
> — `sad.md §4, service worker registration, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

No server state: the opt-in lives in this browser only (api-sync-report assumption 3). Internal — no API surface.

## Acceptance criteria

### AC-03 — error

> **Given** an operator who clicks "Turn on desktop notifications" in the panel
> **When** the browser refuses permission, or permission was refused earlier, or the browser cannot show notifications
> **Then** the panel says that desktop notifications are off for this browser and how to allow them in the browser's site settings. The attention count (AC-01) keeps working. The panel never asks the browser for permission without the member's click.
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `desktop.ts`: `capability()` (Notification + serviceWorker + storage), `permission()`, `turnOn()` (calls `Notification.requestPermission()` only inside the click handler, then registers the worker with a versioned URL, then stores the flag), `turnOff()` (clears the flag, unregisters when no workspace keeps it) — `apps/web/src/features/notifications/desktop.ts`
- [ ] `DesktopNotificationsCard` with every desktop-card state; mounted on the notifications page above the Telegram card — `apps/web/src/features/notifications/DesktopNotificationsCard.tsx`, `apps/web/src/pages/NotificationSettingsPage.tsx`
- [ ] Testing Library tests with mocked `Notification`, `navigator.serviceWorker` and a throwing `localStorage` — `apps/web/src/features/notifications/DesktopNotificationsCard.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| Prompt dismissed | `error: blocked` for this click; next click asks again (permission still `default`) |
| Permission revoked while the flag is on | `error: blocked` |
| `localStorage` throws | `error: not available` |
| Page load | never calls `requestPermission` |

## Definition of Done

- [ ] Testing Library tests cover every desktop-card state of SCR-16 in screens.md (off, asking, on, blocked incl. revoked, not available for no API, no storage and failed registration, turned off with the worker unregistered only when no workspace keeps the flag), and prove requestPermission is called only from the click.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
