---
id: T13
title: "Add the presence use cases opened / alive / screen / closed, with the member's expired-lease cleanup and the ping opened-at mark"
layer: "app"
deps: ["T3", "T9"]
blocks: ["T14"]
acs: ["AC-07"]
files_hint: ["apps/api/src/modules/notifications/app/presence.ts", "apps/api/src/modules/notifications/app/presence.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T13 — Add the presence use cases opened / alive / screen / closed, with the member's expired-lease cleanup and the ping opened-at mark

## Place in the sequence

- **Blocked by:** T3 — Add the notifications domain due rules: the 5 / 30-minute marks, the unpingable assignee, read-holds-back unless reopen, the ledger and 10-minute spacing, and the presence predicate, T9 — Build the presence-lease and ping-ledger repositories with cross-workspace isolation tests · **Blocks:** T14 — Teach the inbox hub to read presence frames and report socket lifecycle to notifications, and deliver telegram_link.changed only to that account's sockets · **Wave:** 3 — after T3, T9.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** the business bot to ping me in Telegram when a customer of mine, or an unassigned one, has waited 5 minutes and I am away from the web
> **So that** no customer waits because I closed my laptop
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It turns the socket's lifecycle into the per-tab leases that decide who is away.

## Inlined context

> - When a tab's socket opens, the hub registers it with `notifications.presence`. The row holds the workspace, the account, a tab connection id, `live_until`, `on_screen` and `last_on_screen_at`.
> - Every pong the server receives (every 25 s) moves `live_until` to now + 50 s. A dead connection therefore stops counting at most 50 s after its last pong, which is within the spec's 60 s.
> - A clean close deletes the row. A crash leaves it to expire.
>
> — `sad.md §4, choice 2, verbatim` · full text: [sad.md](../sad.md)

> - `inbox` (hub) → `notifications.presence`: `opened(workspaceId, accountId, connectionId, onScreen)`, `alive(workspaceId, connectionId)` on pong, `screen(workspaceId, connectionId, onScreen)` on a presence frame, `closed(workspaceId, connectionId)`. The hub already holds each socket's workspace id, so every presence write is scoped by it and no tenancy exception is needed. The member's latest ping within the last 15 min gets its `opened_at` set when a tab of that workspace opens **or comes back on screen** (`opened` with `onScreen`, or `screen` turning true). This covers a member who returns to a tab that was already open (§7 KPI).
>
> — `sad.md §5, inbox → notifications.presence, verbatim` · full text: [sad.md](../sad.md)

> 10. **Expired presence rows outside a sweep.** The sweep runs only for workspaces with a live link. So the hub's `opened` call also deletes the same member's expired rows in that workspace (same index). Rows a crash left behind therefore never outlive the member's next open. `tasks` should carry this into the presence use case.
>
> — `data-model.md §Assumptions, 10, verbatim` · full text: [data-model.md](../data-model.md)

> 6. **The lease is registered when the socket opens, with `on_screen = false`, and the opening `presence` frame sets it.** sad.md flow 7 draws the frame and the registration as one step (`opened(…, onScreen)`); registering on open means a tab that never sends the frame (an old bundle, a lost frame) still counts as connected but not on screen, the safe direction: it can only make a member away sooner, never present when they are not. `tasks` may instead hold the registration until the first frame; the contract is the same either way.
>
> — `contracts/events.md §Assumptions, 6, verbatim` · full text: [events.md](../contracts/events.md)

> **Chosen:** Option 1. It is the only option correct across instances and restarts. It reuses the socket's keep-alive (every 25 s, handled by the browser even in background tabs) for liveness. A 50 s lease means a dead connection stops counting within 50 s of its last pong, which is inside the 60 s target. Page Visibility's `visible` state is exactly "the selected tab of a window that is not minimised". To make any workspace page count, the **live socket moves from the inbox store to the workspace frame**: one connection per tab per workspace, shared by subscribers.
>
> — `adr/0002-track-presence-as-per-tab-leases-in-postgres-refreshed-by-the-workspace-live-socket.md §Decision outcome, ADR-0002, verbatim` · full text: [ADR-0002](../adr/0002-track-presence-as-per-tab-leases-in-postgres-refreshed-by-the-workspace-live-socket.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Table | Change |
|---|---|
| `tab_presences` | insert on `opened` (id = connection id), `live_until` on `alive`, `on_screen` / `last_on_screen_at` on `screen`, delete on `closed` and the member's expired rows on `opened` |
| `pings.opened_at` | set on the member's latest ping in W within 15 min when a tab opens on screen or comes back on screen |

— `data-model.md §Entities tab_presences + pings, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface (called by the hub, T14).

## Acceptance criteria

### AC-07 — happy path

> **Given** an operator of "Acme Flowers" with a Telegram link who is away from the web (no tab of theirs, on any device, has "Acme Flowers" open with a working live connection and on screen within the last 10 minutes), and an open conversation assigned to them in which the customer is waiting for a reply, with the message that started the wait still unread for them
> **When** 5 minutes pass since that message arrived in tg-inbox and nothing has ended the wait
> **Then** the "Acme Flowers" bot sends them one ping: "Acme Flowers: 1 customer is waiting for your reply (5 min)", with a link that opens that conversation in the panel. The ping contains no message text and no contact name. A conversation that is unassigned at that moment pings every linked member of "Acme Flowers" who is away and has not read the message. A member who is present on the web gets the in-web notifications instead (AC-01, AC-02) and no ping at that point. If they become away later while the customer is still waiting and the message is still unread for them, the ping goes out as soon as they are counted away. The 5 minutes always run from the start of the wait. For a waiting period that began when a conversation reopened (AC-08), the clock starts at the reopen. Having read the earlier messages does not hold such a ping back, because the customer's message was read and the team's reply did not reach them.
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `opened(ws, account, connectionId, onScreen)` — delete the member's expired rows, insert the lease (`live_until = now + 50 s`), mark opened-at when on screen — `apps/api/src/modules/notifications/app/presence.ts`
- [ ] `alive(ws, id)`, `screen(ws, id, onScreen)` (leaving stamps `last_on_screen_at = now`; returning marks opened-at), `closed(ws, id)` — same file
- [ ] Unit tests with fakes and a controllable clock — `apps/api/src/modules/notifications/app/presence.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Tab opens hidden and never comes on screen | counts away (no `last_on_screen_at`) |
| `screen(true)` 14 min after a ping | ping `opened_at` set |
| `alive` for a row already deleted | no-op |
| Crashed tab of the same member | its expired row is deleted on the member's next `opened` |

## Definition of Done

- [ ] Unit tests prove opened registers a 50 s lease and deletes the member's expired rows, alive extends it, screen stamps last-on-screen on leaving, closed deletes it, and opening or returning on screen within 15 minutes of a ping marks that ping opened, every call scoped by the workspace id.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
