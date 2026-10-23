---
id: T3
title: "Add the notifications domain due rules: the 5 / 30-minute marks, the unpingable assignee, read-holds-back unless reopen, the ledger and 10-minute spacing, and the presence predicate"
layer: "domain"
deps: []
blocks: ["T13", "T16"]
acs: ["AC-07", "AC-08", "AC-09"]
files_hint: ["apps/api/src/modules/notifications/domain/constants.ts", "apps/api/src/modules/notifications/domain/presence.ts", "apps/api/src/modules/notifications/domain/presence.test.ts", "apps/api/src/modules/notifications/domain/due.ts", "apps/api/src/modules/notifications/domain/due.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T3 — Add the notifications domain due rules: the 5 / 30-minute marks, the unpingable assignee, read-holds-back unless reopen, the ledger and 10-minute spacing, and the presence predicate

## Place in the sequence

- **Blocked by:** — · **Blocks:** T13 — Add the presence use cases opened / alive / screen / closed, with the member's expired-lease cleanup and the ping opened-at mark, T16 — Add the send-pings use case: the per-workspace sweep, the per-member send transaction that re-checks and writes the ledger before the call, and the outcome transaction · **Wave:** 1 — no upstream task.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** the business bot to ping me in Telegram when a customer of mine, or an unassigned one, has waited 5 minutes and I am away from the web
> **So that** no customer waits because I closed my laptop
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** a customer whose assigned member does not answer to reach the rest of the team
> **So that** nobody waits on a teammate who is off for the day
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It is the pure decision of who is due for which conversation, and who counts as away, that the sweep and the send re-check both call.

## Inlined context

> - computes each member's **due set** in `notifications/domain`: 5 min for the assignee or for everyone on an unassigned conversation, 30 min for the team, or 5 min for the team when the assignee is away, has not read the waiting message and cannot be pinged (no link, or a link that is "Not reachable"). An assignee who is present or has read the message can be reached, so the team waits for 30 min (AC-09). The assignee's presence and read state are therefore read whether or not they have a link; never a conversation already in the member's ledger for its current waiting period; never one the member has read, unless the period began with a reopen.
>
> — `sad.md §4, choice 5, due set, verbatim` · full text: [sad.md](../sad.md)

> alt already in this member's ledger for this period → not due
> else the member read the waiting message, and the period began with a message → not due - they have seen it
> else assigned to this member, 5 min after the period start → due as yours
> else unassigned, 5 min after the period start → due as unassigned
> else assigned to a teammate, 30 min after the period start → due as a teammate's
> else assigned to a teammate who is away, has not read it and cannot be pinged, 5 min after the period start → due as a teammate's
> cannot be pinged means no live link, or a link marked not reachable by an earlier failed attempt or by one in this sweep
> each member with a due set: this member's last ping in W is less than 10 min old → wait - the set is combined into the ping at the member's next allowed moment
>
> — `sad.md §6, flow 13, due branches, abridged` · full text: [sad.md](../sad.md)

> **Away for W** = no row of the member with `live_until > now AND (on_screen OR last_on_screen_at > now − 10 min)`.
>
> — `data-model.md §Entities, tab_presences, Away for W, verbatim` · full text: [data-model.md](../data-model.md)

> - The 20 s sweep period, the 50 s presence lease, the 10 pings per second budget and the one-hour notice spacing are design constants, not spec numbers. They sit in `notifications/domain` and are chosen so that the spec §6 targets hold (§10).
>
> — `sad.md §1, assumption, design constants, verbatim` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. A sweep sees every trigger as a change in state, with no hook in the modules that cause it. It is idempotent, so a lost or duplicated run cannot double-ping: the unique ledger and the exclusive key make "at most once per period" hold across instances. The 20 s period plus send time stays well inside the 60 s p95. The send-time re-check is the recomputation inside the per-member transaction. A due set that empties sends nothing.
>
> — `adr/0005-decide-pings-in-a-per-workspace-sweep-every-20-s-with-a-per-period-ledger-written-before-the-send.md §Decision outcome, ADR-0005, verbatim` · full text: [ADR-0005](../adr/0005-decide-pings-in-a-per-workspace-sweep-every-20-s-with-a-per-period-ledger-written-before-the-send.md)

> **Chosen:** Option 1. It is the only option correct across instances and restarts. It reuses the socket's keep-alive (every 25 s, handled by the browser even in background tabs) for liveness. A 50 s lease means a dead connection stops counting within 50 s of its last pong, which is inside the 60 s target. Page Visibility's `visible` state is exactly "the selected tab of a window that is not minimised". To make any workspace page count, the **live socket moves from the inbox store to the workspace frame**: one connection per tab per workspace, shared by subscribers.
>
> — `adr/0002-track-presence-as-per-tab-leases-in-postgres-refreshed-by-the-workspace-live-socket.md §Decision outcome, ADR-0002, verbatim` · full text: [ADR-0002](../adr/0002-track-presence-as-per-tab-leases-in-postgres-refreshed-by-the-workspace-live-socket.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-07 — happy path

> **Given** an operator of "Acme Flowers" with a Telegram link who is away from the web (no tab of theirs, on any device, has "Acme Flowers" open with a working live connection and on screen within the last 10 minutes), and an open conversation assigned to them in which the customer is waiting for a reply, with the message that started the wait still unread for them
> **When** 5 minutes pass since that message arrived in tg-inbox and nothing has ended the wait
> **Then** the "Acme Flowers" bot sends them one ping: "Acme Flowers: 1 customer is waiting for your reply (5 min)", with a link that opens that conversation in the panel. The ping contains no message text and no contact name. A conversation that is unassigned at that moment pings every linked member of "Acme Flowers" who is away and has not read the message. A member who is present on the web gets the in-web notifications instead (AC-01, AC-02) and no ping at that point. If they become away later while the customer is still waiting and the message is still unread for them, the ping goes out as soon as they are counted away. The 5 minutes always run from the start of the wait. For a waiting period that began when a conversation reopened (AC-08), the clock starts at the reopen. Having read the earlier messages does not hold such a ping back, because the customer's message was read and the team's reply did not reach them.
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — domain invariant

> **Given** a conversation of "Acme Flowers" for which a linked away member has been pinged
> **When** the customer writes more messages in the same waiting period, or other conversations become due for the same member within 10 minutes
> **Then** that member is pinged at most once per conversation per waiting period. Pings to one member from one workspace are at most one per 10 minutes. Conversations that become due in between are combined into the next ping, sent at the member's next allowed moment. A ping counts only the conversations not yet pinged to this member in their current waiting period, and the longest wait among them. If all of them are the member's own, it reads "Acme Flowers: 4 customers are waiting for your reply, the longest 12 min" and links to the inbox's "mine" lens. If all are unassigned, it says so and links to the "unassigned" lens. A mixed set reads "Acme Flowers: 4 customers are waiting for a reply (2 yours, 1 unassigned, 1 a teammate's), the longest 12 min" and links to the inbox's open conversations. A waiting period ends when a reply is marked sent or the conversation is closed. The next customer message after that starts a new one. A conversation that is reopened while its customer is still waiting for a reply also starts a new one at the moment it reopens, for example after a reply ends "not delivered" (assignment-statuses AC-08). A member who reads the waiting message before their ping is sent is not pinged for that period. A reassignment does not restart the clock. A new assignee who is away, linked and has not read the message becomes due at once if the customer has already waited 5 minutes. Unassigning a waiting conversation makes it due at once for the away members as an unassigned one. Each member still gets at most one ping per conversation per waiting period.
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — cross-context

> **Given** an open conversation of "Acme Flowers" assigned to an operator, whose customer has been waiting for a reply
> **When** 30 minutes pass since the wait began and it has not ended, or 5 minutes pass while the assignee is away and cannot be pinged
> **Then** every other linked member of "Acme Flowers" who is away and has not read the waiting message gets the ping for it, as for an unassigned conversation (AC-07, AC-08), saying that a teammate's customer is waiting (without the teammate's name). The assignee stays the assignee, since a ping never changes the assignee or the status. "Cannot be pinged" means exactly one of two things: the assignee has no Telegram link, or their link is "Not reachable" (AC-10). That state is either already known from an earlier failed ping or found by the failed attempt at this moment. An assignee who is present on the web, or who has read the waiting message, can be reached. For them the team is pinged only at 30 minutes.
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Constants: 5 / 30 / 10 min, presence window 10 min, lease 50 s, sweep 20 s, 10 sends per s, 15 min opened-at window — `apps/api/src/modules/notifications/domain/constants.ts`
- [ ] `isPresent(leases, now)` / `isAway(…)` over `{ liveUntil, onScreen, lastOnScreenAt }` — `apps/api/src/modules/notifications/domain/presence.ts`
- [ ] `dueSets({ now, conversations, linkedMembers, presence, ledger, lastPingAt })` → per member `{ conversationId, waitingSince, kind: mine | unassigned | teammate }[]` plus `allowedAt`; the unpingable-assignee rule takes the assignee's presence and read state whether or not they are linked — `apps/api/src/modules/notifications/domain/due.ts`
- [ ] Unit tests for every flow-13 branch and the spacing — `apps/api/src/modules/notifications/domain/due.test.ts`, `presence.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Member read the waiting message, period started by `reopen` | still due (AC-07) |
| Assignee present, or has read it | team waits for 30 min (AC-09) |
| Assignee away, unread, link `blocked_at` set | team due at 5 min (AC-09) |
| Reassigned at 7 min to an away linked member | due at once as yours (period start unchanged, AC-08) |
| Unassigned at 7 min | due at once for away members as unassigned |
| Last ping 6 min ago | not sent now; `allowedAt` = last + 10 min, set combined then |
| Lease alive, hidden, `last_on_screen_at` 9 min ago / 11 min ago / null | present / away / away |

## Definition of Done

- [ ] Domain unit tests cover every due branch of flow 13 (ledger, read-holds-back with the reopen exception, 5 min for mine and unassigned, 30 min team, 5 min team for an away unread unpingable assignee), the 10-minute spacing with its allowed moment, and the presence predicate for live, hidden-within-10-min, hidden-longer and expired leases.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
