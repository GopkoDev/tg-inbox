---
id: T30
title: "Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the notifications module, the sixth tenancy exception, the new queues, the ports and the new components"
layer: "docs"
deps: ["T17", "T18", "T19", "T20", "T23", "T25", "T26", "T27", "T28"]
blocks: []
acs: ["AC-10", "AC-12"]
files_hint: ["CLAUDE.md", "docs/architecture-map.md", "docs/design-system.md", "CONTEXT.md", "docs/features/operator-notifications/screens.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T30 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the notifications module, the sixth tenancy exception, the new queues, the ports and the new components

## Place in the sequence

- **Blocked by:** T17 — Wire the ping jobs: the notifications.send-pings chain per workspace, the notifications.schedule-pings cron over the sixth tenancy exception, and the QG-1 scenario tests, T18 — Remove links on deactivation through the composed onMembershipDeactivated port and on a different bot through the bot-connected hook, both in the existing transactions, T19 — Serve the notifications routes (settings, connect link, disconnect) and GET inbox/attention behind the workspace guard, and register the notifications module, T20 — Add telegram_pings to Membership on the Team reads and the deactivate / reactivate answers through a notifications port that team takes, T23 — Build the attention store and SCR-15's count: the (N) title prefix, the Inbox SidebarMenuBadge, the phone header badge, the collapsed tooltip and Settings for operators, T25 — Build SCR-17, the ConnectTelegramDialog: the link with Copy and Open in Telegram, its expiry, waiting for Start, the live turn to Connected, new-link refusals and the bot-stopped state, T26 — Build the DesktopNotificationsCard on SCR-16: capability and permission checks, the click-only permission request (OS-01), worker registration and the per-browser flag, T27 — Add the desktop notifier and the notifications-only service worker: candidates from the tabs, focus check, tag replace, dedupe and the click to the most recently focused tab (OS-02), T28 — Add the «Telegram pings» column to Settings — Team (SCR-13) and the pings sentence to the deactivate confirmation (SCR-14) · **Blocks:** — · **Wave:** 6 — after T17, T18, T19, T20, T23, T25, T26, T27, T28.
- **Lane:** own lane.

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

It keeps the short rules, the map and the canon true to what was built, so the next feature starts from facts.

## Inlined context

> | The sixth controlled tenancy exception (workspaces with a live link) must be listed in CLAUDE.md and the architecture map. The map's `reflects_commit` and its "greenfield-bootstrap" mode are stale. | Low | Update both in this feature's tasks, including the new queues. | Tech Lead |
>
> — `sad.md §11, sixth exception + map, verbatim` · full text: [sad.md](../sad.md)

> - **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation. Five reads are the controlled exceptions because they produce the workspace id: three in `workspaces` (memberships of an account, invitation by token hash, membership for the guard — account id + workspace id from the URL) and two in `bots` (_bot by webhook id_, scoped by possession of the webhook secret's hash; _bots due for a health check_, used only by the scheduled job — bot-connection ADR-0007); a new exception needs a change to the SAD (shared-inbox added none).
>
> — `CLAUDE.md §Rules, Tenancy, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> The decided architecture lives in `docs/architecture-map.md` (+ ADRs in `docs/adr/`); this file is
>
> — `CLAUDE.md §preamble, map wins, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> 3. Update `CLAUDE.md` and `docs/architecture-map.md`: the sixth controlled tenancy exception (*workspaces with a live Telegram link*, served by a live partial index) and the new tables under `notifications` (SAD §11).
>
> — `_audit/data-model-2026-10-19.md §Staged migrations, after promotion, 3, verbatim` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

> | DesktopNotificationsCard | SCR-16's browser-only opt-in […] composes Card, Badge, Button, Alert | pending |
> | TelegramPingsCard | SCR-16's Telegram state machine over `NotificationSettings` […] | pending |
> | ConnectTelegramDialog | SCR-17 […] composes Dialog, Button, Separator, Alert | pending |
> | AppShell (extended) | […] the `(N) ` title prefix, the Inbox `SidebarMenuBadge` […] owns the tab's live socket — canon row updated, not duplicated | pending |
> | SettingsLayout (extended) | […] the **Notifications** section and role-filtered sections — canon row updated | pending |
>
> — `screens.md §New components, rows, abridged` · full text: [screens.md](../screens.md)

> | Presence lease † | A per-tab row whose `live_until` the live socket's keep-alive extends by 50 s, with the tab's on-screen state. […] |
> | Due set † | The conversations a member should be pinged about right now […] |
> | Ping ledger † | The `pings` and `ping_items` rows that record which member was pinged about which conversation in which waiting period. […] |
> | Inbound interceptor † | The port `bots` calls for every private update before capture. […] |
> | Send pause † | `send_paused_until` on the bot row, set by any Telegram rate-limit answer. Pings and bot answers wait for it, and replies never do. |
>
> — `sad.md §12, Glossary † terms, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface.

## Acceptance criteria

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

## Checklist

- [ ] `CLAUDE.md`: the `notifications` module (Telegram links, connect links, presence, pings) and its edges `notifications → {conversations, workspaces, bots}`, `inbox → notifications`, the runtime ports (`bots` interceptor + bot-connected hook, composed `onMembershipDeactivated`), the `buildDeps()` order, the **sixth tenancy exception** *workspaces with a live Telegram link* (cron only), the queues `notifications.schedule-pings`, `notifications.send-pings`, `notifications.send-bot-message` (+ `-dlq`), `sendMemberMessage` and the send pause, the three error codes — `CLAUDE.md`
- [ ] Architecture map: module row, port edges, tables, queue table, the sixth exception, lock orders (redeem, send, deactivation), run-book integrity queries and KPIs, the service worker; fix `reflects_commit` and the stale «greenfield-bootstrap» mode — `docs/architecture-map.md`
- [ ] Design-system canon: register `DesktopNotificationsCard`, `TelegramPingsCard`, `ConnectTelegramDialog`; update `AppShell` and `SettingsLayout` rows; note «no QR code in v1» — `docs/design-system.md`
- [ ] Add the five † terms, each with a NOT-reference — `CONTEXT.md`
- [ ] Flip «Registered in design-system» to done in screens.md §New components — `docs/features/operator-notifications/screens.md`

## Edge cases

| Case | Behaviour |
|---|---|
| Map and CLAUDE.md disagree after the edit | the map wins; CLAUDE.md is corrected |
| A term already in CONTEXT.md (Ping, Telegram link) | kept; only the † terms are added |

## Definition of Done

- [ ] CLAUDE.md and the architecture map name the notifications module, its ports, the buildDeps order, the sixth controlled tenancy exception and the three new queues exactly as built, the design-system canon registers the three new components and the two extended ones, and CONTEXT.md carries the five new glossary terms.
- [ ] CONTEXT.md carries the five glossary terms with a NOT-reference each
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
