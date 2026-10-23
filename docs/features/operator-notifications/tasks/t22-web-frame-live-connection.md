---
id: T22
title: "Move the live socket to the workspace frame as one per-tab connection with subscribers, send presence frames on open and on visibilitychange, and let the inbox store subscribe"
layer: "ui"
deps: ["T2"]
blocks: ["T23", "T24", "T27"]
acs: ["AC-01", "AC-07"]
files_hint: ["apps/web/src/shared/api/realtime.ts", "apps/web/src/shared/api/realtime.test.ts", "apps/web/src/shared/api/live-connection.ts", "apps/web/src/shared/ui/app-shell.tsx", "apps/web/src/shared/ui/app-shell-context.ts", "apps/web/src/features/inbox/store.ts", "apps/web/src/features/inbox/store.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T22 — Move the live socket to the workspace frame as one per-tab connection with subscribers, send presence frames on open and on visibilitychange, and let the inbox store subscribe

## Place in the sequence

- **Blocked by:** T2 — Add the notifications zod contracts, the three error codes, the presence client frame and the telegram_link.changed frame and signal · **Blocks:** T23 — Build the attention store and SCR-15's count: the (N) title prefix, the Inbox SidebarMenuBadge, the phone header badge, the collapsed tooltip and Settings for operators, T24 — Build Settings — Notifications (SCR-16) with the TelegramPingsCard, the notifications store, the role-filtered SettingsLayout and the route, T27 — Add the desktop notifier and the notifications-only service worker: candidates from the tabs, focus check, tag replace, dedupe and the click to the most recently focused tab (OS-02) · **Wave:** 2 — after T2.
- **Lane:** shares `apps/web/src/features/inbox/store.ts` with T2; shares `apps/web/src/shared/ui/app-shell.tsx` with T23 — serialized.

## Why (user story)

> **As an** Operator
> **I want** the browser tab and the navigation to show how many conversations need me
> **So that** I notice new customer messages while I work on another page or another tab
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** the business bot to ping me in Telegram when a customer of mine, or an unassigned one, has waited 5 minutes and I am away from the web
> **So that** no customer waits because I closed my laptop
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It makes every workspace page hold the tab's one live connection, so the count follows the member and presence counts any page.

## Inlined context

> - **The live socket moves from the inbox store to the workspace frame.** The attention count must follow the member onto Contacts and Settings (AC-01), and presence counts any workspace page (spec §1 D1). So the frame (SCR-15) opens one live connection per tab per workspace, through `openLiveSocket`. It hands frames to subscribers: the inbox store, the attention store, the notifications settings store and the desktop notifier. The inbox store stops opening its own socket. This is part of [ADR-0002](adr/0002-track-presence-as-per-tab-leases-in-postgres-refreshed-by-the-workspace-live-socket.md).
>
> — `sad.md §4, UI architecture, socket move, verbatim` · full text: [sad.md](../sad.md)

> | The live socket moves from the inbox store to the workspace frame, so every workspace page now holds a socket, and the inbox's live behaviour must not regress. | Medium | One shared connection with subscribers. The inbox store's existing live tests run against the frame-owned connection. Covered in `tasks`. | Tech Lead |
>
> — `sad.md §11, socket move risk, verbatim` · full text: [sad.md](../sad.md)

> - **When sent:** once right after the socket opens, and on every `visibilitychange`.
>
> — `contracts/events.md §Frame: presence, When sent, verbatim` · full text: [events.md](../contracts/events.md)

> Every ui-redesign SCR-07 state is kept. The frame now also opens the tab's one live socket (sad.md §4) — no visible change. Added or changed:
>
> — `screens.md §SCR-15, intro, verbatim` · full text: [screens.md](../screens.md)

> | a frame that fails to parse | dropped; reconnect + resync (inherited rule; an old bundle ignores `telegram_link.changed`) | events.md «Old bundles» |
> | workspace switched | the outlet remounts keyed on the workspace (inherited); the count and title prefix clear until the new workspace's answer; SCR-16 re-reads for the new workspace; the desktop card shows that workspace's per-browser flag | AC-01; flow 4 |
>
> — `screens.md §Shared states, workspace switched + parse failure, verbatim` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

`openLiveSocket`: the client now sends `presence { type, v: 1, on_screen }` (Page Visibility `visible`) once after open and on every `visibilitychange`; it receives the existing frames plus `telegram_link.changed`. — `contracts/events.md §Channel: live socket, abridged` · full text: [events.md](../contracts/events.md)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" with the inbox open: 2 open conversations assigned to them and 1 unassigned open conversation have customer messages they have not read, while a teammate's conversation and a closed one also have unread messages
> **When** they look at the browser tab or move to Settings or Contacts
> **Then** the tab title starts with "(3)" and the Inbox item in the side navigation shows 3: the **attention count** includes only open conversations that are theirs or unassigned and have unread messages for them. It changes without reloading within the live-update target of §6 as messages arrive, as they read conversations and as conversations are assigned, closed or reopened. At 0 the title has no count and the navigation shows no number. Each tab shows the count of its own workspace. A business owner sees the same.
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-07 — happy path

> **Given** an operator of "Acme Flowers" with a Telegram link who is away from the web (no tab of theirs, on any device, has "Acme Flowers" open with a working live connection and on screen within the last 10 minutes), and an open conversation assigned to them in which the customer is waiting for a reply, with the message that started the wait still unread for them
> **When** 5 minutes pass since that message arrived in tg-inbox and nothing has ended the wait
> **Then** the "Acme Flowers" bot sends them one ping: "Acme Flowers: 1 customer is waiting for your reply (5 min)", with a link that opens that conversation in the panel. The ping contains no message text and no contact name. A conversation that is unassigned at that moment pings every linked member of "Acme Flowers" who is away and has not read the message. A member who is present on the web gets the in-web notifications instead (AC-01, AC-02) and no ping at that point. If they become away later while the customer is still waiting and the message is still unread for them, the ping goes out as soon as they are counted away. The 5 minutes always run from the start of the wait. For a waiting period that began when a conversation reopened (AC-08), the clock starts at the reopen. Having read the earlier messages does not hold such a ping back, because the customer's message was read and the team's reply did not reach them.
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `openLiveSocket` sends the presence frame after open and on `visibilitychange`, removes its listener on close — `apps/web/src/shared/api/realtime.ts` (+ `realtime.test.ts`)
- [ ] A per-tab live connection with `subscribe(handler)` per workspace, reconnect and resync fan-out — `apps/web/src/shared/api/live-connection.ts`
- [ ] The workspace frame opens / closes it keyed on the workspace — `apps/web/src/shared/ui/app-shell.tsx`, `apps/web/src/shared/ui/app-shell-context.ts`
- [ ] The inbox store subscribes to the frame's connection instead of calling `openLiveSocket`; its live tests run against the shared connection — `apps/web/src/features/inbox/store.ts`, `apps/web/src/features/inbox/store.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Workspace switched | old connection closed, new one opened; subscribers reset |
| Tab hidden at open | first frame `on_screen: false` |
| Inbox page unmounted (Contacts open) | connection stays; inbox unsubscribes |
| Unparseable frame | dropped, reconnect + resync (inherited) |

## Definition of Done

- [ ] Web tests prove one live connection per tab per workspace owned by the frame, a presence frame on open and on every visibilitychange, subscribers receiving frames and resync, the connection surviving navigation between workspace pages and closing on a workspace switch, and every existing inbox live test passing on the shared connection.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
