---
id: T9
title: "Build the presence-lease and ping-ledger repositories with cross-workspace isolation tests"
layer: "infra"
deps: ["T1"]
blocks: ["T13", "T16"]
acs: ["AC-08", "AC-10"]
files_hint: ["apps/api/src/modules/notifications/infra/presence-repo.ts", "apps/api/src/modules/notifications/infra/ping-repo.ts", "apps/api/src/modules/notifications/infra/ledger.int.test.ts", "apps/api/src/modules/notifications/app/ports.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T9 — Build the presence-lease and ping-ledger repositories with cross-workspace isolation tests

## Place in the sequence

- **Blocked by:** T1 — Promote migrations 04–08 (the bot send pause and the five notifications tables), regenerate DB types and add the test fixtures · **Blocks:** T13 — Add the presence use cases opened / alive / screen / closed, with the member's expired-lease cleanup and the ping opened-at mark, T16 — Add the send-pings use case: the per-workspace sweep, the per-member send transaction that re-checks and writes the ledger before the call, and the outcome transaction · **Wave:** 2 — after T1.
- **Lane:** shares `apps/api/src/modules/notifications/app/ports.ts` with T8; shares `apps/api/src/modules/notifications/app/ports.ts` with T10 — serialized.

## Why (user story)

> **As an** Operator
> **I want** the business bot to ping me in Telegram when a customer of mine, or an unassigned one, has waited 5 minutes and I am away from the web
> **So that** no customer waits because I closed my laptop
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It persists who is present and who was pinged about what, the two facts the sweep decides on.

## Inlined context

> - **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation. Five reads are the controlled exceptions because they produce the workspace id: three in `workspaces` (memberships of an account, invitation by token hash, membership for the guard — account id + workspace id from the URL) and two in `bots` (_bot by webhook id_, scoped by possession of the webhook secret's hash; _bots due for a health check_, used only by the scheduled job — bot-connection ADR-0007); a new exception needs a change to the SAD (shared-inbox added none).
>
> — `CLAUDE.md §Rules, Tenancy, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> **Lifetime:** a clean close deletes the row. An expired row is deleted by the workspace's sweep and by the member's next `opened` (assumption 10).
> - The away predicate for one member at send time (flow 1), and the presence rows of W in the sweep (flow 13) → `tab_presences_workspace_id_account_id_live_until_idx` (full key, or the workspace prefix).
> - `alive` / `screen` / `closed`: by PK, with `workspace_id` as a filter (flow 7).
>
> — `data-model.md §Entities tab_presences, lifetime + access patterns, verbatim` · full text: [data-model.md](../data-model.md)

> - This member's last ping in W (flows 1, 13: spacing) and the latest within 15 min (flows 7, 14: `opened_at`) → `pings_workspace_id_account_id_created_at_idx`, backward, limit 1.
> - The sweep's "already in this member's ledger for this period", for the waiting conversations of W and every member (flow 13): `(conversation_id, waiting_since) IN (…)` → `ping_items_conversation_id_waiting_since_account_id_key` (index-only).
> - The send transaction's insert. A conflict means another worker won (QG-1 test f) → same key.
> - Rollout cascade from `pings` → `ping_items_ping_id_idx`.
>
> — `data-model.md §Entities pings + ping_items, access patterns, verbatim` · full text: [data-model.md](../data-model.md)

> 8. **`sending` is a lasting outcome when the process dies mid-call.** It counts like `failed` (at most once, SAD §11), so a sweep never re-pings that period.
>
> — `data-model.md §Assumptions, 8, sending, verbatim` · full text: [data-model.md](../data-model.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Table | Columns this task reads / writes |
|---|---|
| `tab_presences` | all; insert on open, `live_until` on pong, `on_screen` / `last_on_screen_at`, delete on close and expiry |
| `pings` | insert as `sending`, `outcome`, `opened_at`, delete on rollout |
| `ping_items` | insert per conversation; ledger read by `(conversation_id, waiting_since) IN (…)` |

— `data-model.md §Entities tab_presences + pings + ping_items, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-08 — domain invariant

> **Given** a conversation of "Acme Flowers" for which a linked away member has been pinged
> **When** the customer writes more messages in the same waiting period, or other conversations become due for the same member within 10 minutes
> **Then** that member is pinged at most once per conversation per waiting period. Pings to one member from one workspace are at most one per 10 minutes. Conversations that become due in between are combined into the next ping, sent at the member's next allowed moment. A ping counts only the conversations not yet pinged to this member in their current waiting period, and the longest wait among them. If all of them are the member's own, it reads "Acme Flowers: 4 customers are waiting for your reply, the longest 12 min" and links to the inbox's "mine" lens. If all are unassigned, it says so and links to the "unassigned" lens. A mixed set reads "Acme Flowers: 4 customers are waiting for a reply (2 yours, 1 unassigned, 1 a teammate's), the longest 12 min" and links to the inbox's open conversations. A waiting period ends when a reply is marked sent or the conversation is closed. The next customer message after that starts a new one. A conversation that is reopened while its customer is still waiting for a reply also starts a new one at the moment it reopens, for example after a reply ends "not delivered" (assignment-statuses AC-08). A member who reads the waiting message before their ping is sent is not pinged for that period. A reassignment does not restart the clock. A new assignee who is away, linked and has not read the message becomes due at once if the customer has already waited 5 minutes. Unassigning a waiting conversation makes it due at once for the away members as an unassigned one. Each member still gets at most one ping per conversation per waiting period.
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — cross-context

> **Given** a conversation of "Acme Flowers" whose ping is due
> **When** at that moment the conversation is closed, a reply was marked sent, the recipient's membership is no longer active, the bot is "not connected" or "not working", or the member blocked the bot in Telegram
> **Then** no ping reaches that member. A closed conversation or a sent reply ends the wait (AC-08). A deactivated member's Telegram link is removed as part of the deactivation, before any further ping, and is not restored when they are reactivated. While the bot does not work, no ping is sent and none is queued for later, and the member's panel shows "Pings paused — the bot is not working". Once the bot works again, conversations whose customers are still waiting and that were not pinged to a member in their current waiting period become due for that member again. They go out combined, under the one-per-10-minutes limit (AC-08), and the 30-minute team reach continues from the start of each wait. When the member has blocked the bot, their panel shows "Not reachable — you blocked the bot in Telegram, unblock it or disconnect" until a ping reaches them again. Pings to that member are still attempted when due. A failed attempt counts as that conversation's ping for this member in the waiting period and is not retried. A deactivated member's link is removed. A link made with the workspace's previous bot is removed when a different bot is connected, and its member sees "Not connected". A bot that is "taken over" can still send (shared-inbox AC-14), so pings for customers who were already waiting still go out. The panel says that new customer messages are not arriving (shared-inbox AC-14). Pings never delay or crowd out replies to customers: when the bot is at its Telegram sending limit, replies go first and pings wait or are combined.
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `presenceRepo`: `open(ws, account, id, liveUntil, onScreen, at)`, `extend(ws, id, liveUntil)`, `setScreen(ws, id, onScreen, at)`, `close(ws, id)`, `deleteExpired(ws, now, account?)`, `listLive(ws, now, accounts?)` — `apps/api/src/modules/notifications/infra/presence-repo.ts`
- [ ] `pingRepo`: `insertWithItems(tx, ping, items)` (unique conflict → `lost`), `lastPingAt(ws, account)`, `ledger(ws, periods)`, `setOutcome(ws, id, outcome)`, `rollOut(ws, id)` (cascade), `markOpened(ws, account, now, within15min)` — `apps/api/src/modules/notifications/infra/ping-repo.ts`
- [ ] Integration tests incl. isolation over `twoWorkspacesWithLinks` and the cascade — `apps/api/src/modules/notifications/infra/ledger.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Two workers insert the same `(conversation, period, member)` | second gets a unique conflict → reported as lost, nothing sent |
| Rollout of a `429` ping | ping and items deleted, conversations due again |
| `markOpened` with the latest ping 16 min old | nothing set |
| `deleteExpired` for one member | leaves other members' and live rows |

## Definition of Done

- [ ] Integration tests prove the presence and ping repositories against Postgres — lease open, extend, screen, close and expiry deletes, ledger insert with a unique-conflict loser, last-ping read, outcome write, cascade rollout and opened-at within 15 minutes — each isolated from the other workspace of twoWorkspacesWithLinks.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
