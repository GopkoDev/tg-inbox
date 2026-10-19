---
id: T27
title: "Add the desktop notifier and the notifications-only service worker: candidates from the tabs, focus check, tag replace, dedupe and the click to the most recently focused tab (OS-02)"
layer: "ui"
deps: ["T22", "T26"]
blocks: ["T29", "T30"]
acs: ["AC-02"]
files_hint: ["apps/web/src/features/notifications/notifier.ts", "apps/web/src/features/notifications/notifier.test.ts", "apps/web/public/notifications-sw.js", "apps/web/src/features/notifications/notifications-sw.test.ts", "apps/api/src/app.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T27 — Add the desktop notifier and the notifications-only service worker: candidates from the tabs, focus check, tag replace, dedupe and the click to the most recently focused tab (OS-02)

## Place in the sequence

- **Blocked by:** T22 — Move the live socket to the workspace frame as one per-tab connection with subscribers, send presence frames on open and on visibilitychange, and let the inbox store subscribe, T26 — Build the DesktopNotificationsCard on SCR-16: capability and permission checks, the click-only permission request (OS-01), worker registration and the per-browser flag · **Blocks:** T29 — Add browser end-to-end notification flows against the real API and the fake Bot API, T30 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the notifications module, the sixth tenancy exception, the new queues, the ports and the new components · **Wave:** 5 — after T22, T26.
- **Lane:** shares `apps/api/src/app.ts` with T14; shares `apps/api/src/app.ts` with T15; shares `apps/api/src/app.ts` with T17; shares `apps/api/src/app.ts` with T19 — serialized.

## Why (user story)

> **As an** Operator
> **I want** a desktop notification when a customer writes in a conversation that is mine or unassigned and I am not looking at the panel
> **So that** I notice it while I work in another window
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It shows one notification per browser for a customer who needs the member while they work elsewhere.

## Inlined context

> **Chosen:** Option 1. The browser already knows which windows are focused and in what order, and exposes both to a service worker. So the worker meets every AC-02 rule without any tab-to-tab protocol. The `tag` gives "replace instead of stack", and the dedupe gives "once per browser". The worker is registered only after the member turns notifications on, and is limited to notifications.
>
> — `adr/0009-show-desktop-notifications-through-a-notifications-only-service-worker-that-checks-focus-and-picks-the-tab.md §Decision outcome, ADR-0009, verbatim` · full text: [ADR-0009](../adr/0009-show-desktop-notifications-through-a-notifications-only-service-worker-that-checks-focus-and-picks-the-tab.md)

> - **The tab's part.** On a `conversation.changed` frame with a created message, each tab of the workspace refetches the row, as it already does. If the conversation is the member's or unassigned and open, and the frame was not an edit, the tab posts `{ workspaceId, conversationId, messageId, contact name, url }` to the worker.
> - **The worker's part.** It calls `clients.matchAll({ type: 'window', includeUncontrolled: true })`. If any client of that workspace is `focused`, it shows nothing. Otherwise it shows the notification, with `tag` = workspace + conversation, so further messages replace it, and keeps a short dedupe of message ids, so several tabs produce one notification.
> - **The click.** The worker focuses the first matching client, which `matchAll` orders by most recent focus, and asks it to open the conversation. With no such client it opens the conversation's address.
>
> — `sad.md §4, desktop notifications, verbatim` · full text: [sad.md](../sad.md)

> | default | a `conversation.changed` `created` / `message` frame for an open conversation that is mine or unassigned, the flag on and permission `granted` in this browser, and no tab of this workspace in this browser in focus (a visible tab behind another window does not hold it back) (AC-02; flow 6) | title «<contact name> · Acme Flowers»; body «New message»; icon: the panel favicon; `tag` = `<workspaceId>:<conversationId>`; no message text, no media | wireframe «desktop notification» |
> | replaced | another new message in the same conversation before it was dismissed — the same `tag` replaces it, `renotify: true` (alerts again); never a stack (AC-02) | same content | — |
> | not shown | a teammate's or closed conversation; an edit, a reply or an activity entry; a tab of this workspace in focus; no tab of this workspace open in this browser; flag off or permission no longer granted (AC-02; flow 6) | nothing | — |
>
> — `screens.md §OS-02, state table, verbatim` · full text: [screens.md](../screens.md)

> | default: from a desktop notification | an OS-02 click — the workspace tab most recently in focus comes forward and navigates to `/w/<id>/inbox/<conversationId>` in place, from whatever workspace page it showed; with no tab of the workspace left, a new window opens that address (through SCR-09 if needed) (AC-02; flow 6) | Thread | — |
>
> — `screens.md §SCR-02, from a desktop notification, verbatim` · full text: [screens.md](../screens.md)

> The service worker must be served from the origin root with `Content-Type: text/javascript` and `Cache-Control: no-cache`, so that updates take effect.
>
> — `sad.md §7, service worker serving, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Consumes `conversation.changed` (`created` / `message`) and the row re-read it already does (`getConversation`). Internal — no new API surface.

## Acceptance criteria

### AC-02 — happy path

> **Given** an operator of "Acme Flowers" who turned on desktop notifications in this browser and has an "Acme Flowers" tab with a working live connection, but no "Acme Flowers" tab in this browser is on screen
> **When** a customer writes in a conversation assigned to them or unassigned
> **Then** the computer shows one notification "<contact name> · Acme Flowers": "New message". It shows no message text and appears once for this browser even with several tabs open. Further messages in that conversation replace it instead of stacking. A customer message that reopens a closed conversation counts as a new message. Clicking it brings forward the "Acme Flowers" tab that was most recently in focus in this browser, with that conversation open. No notification appears for a conversation assigned to a teammate, for an edit, for a reply or an activity entry, or while an "Acme Flowers" tab in this browser is in focus (the selected tab of the window the member is working in). A tab that is visible but not in focus, for example behind another program's window, does not hold the notification back. A browser with no "Acme Flowers" tab open shows no notification for "Acme Flowers" (§3).
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Notifier: on `created` / `message` frames, when the flag and permission are on and the re-read row is open and mine or unassigned, post `{ workspaceId, conversationId, messageId, contactName, url }` to the worker — `apps/web/src/features/notifications/notifier.ts`
- [ ] Worker: no `fetch` handler; dedupe message ids; `clients.matchAll({ type: 'window', includeUncontrolled: true })` → any focused client of the workspace → nothing; else `showNotification('<contact> · <workspace>', { body: 'New message', tag: '<ws>:<conv>', renotify: true, icon })`; click → focus the first matching client and post it the conversation, else `openWindow(url)` — `apps/web/public/notifications-sw.js`
- [ ] Tab side: navigate in place on the worker's message — `apps/web/src/features/notifications/notifier.ts`
- [ ] Serve `/notifications-sw.js` with `text/javascript` and `no-cache` from the API's static handler — `apps/api/src/app.ts`
- [ ] Unit tests with mocked `clients` (focus skip, tag replace, two-tab dedupe, click order, no client) and notifier tests (teammate's, closed, edit, reply, activity → no post) — `apps/web/src/features/notifications/notifier.test.ts`, `apps/web/src/features/notifications/notifications-sw.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Two tabs post the same message | one notification |
| A tab of the workspace visible behind another window, not focused | notification shown |
| Every tab closed before the click | new window opens the conversation address (through sign-in if needed) |
| Contact name with markup | passed as the title string, plain text |

## Definition of Done

- [ ] Unit tests prove the notifier posts only for new customer messages in open conversations that are the member's or unassigned with the flag and permission on, and the worker shows nothing while a workspace tab is focused, shows one notification per message across tabs with tag replacement and renotify, and a click focuses the most recently focused workspace tab with the conversation or opens its address.
- [ ] a customer message that reopens a closed conversation is posted as a new message (test-plan.md, AC-02)
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
