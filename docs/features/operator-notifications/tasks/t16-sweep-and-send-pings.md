---
id: T16
title: "Add the send-pings use case: the per-workspace sweep, the per-member send transaction that re-checks and writes the ledger before the call, and the outcome transaction"
layer: "app"
deps: ["T3", "T4", "T6", "T7", "T8", "T9"]
blocks: ["T17"]
acs: ["AC-07", "AC-08", "AC-09", "AC-10"]
files_hint: ["apps/api/src/modules/notifications/app/send-pings.ts", "apps/api/src/modules/notifications/app/send-pings.test.ts", "apps/api/src/modules/notifications/app/send-pings.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T16 — Add the send-pings use case: the per-workspace sweep, the per-member send transaction that re-checks and writes the ledger before the call, and the outcome transaction

## Place in the sequence

- **Blocked by:** T3 — Add the notifications domain due rules: the 5 / 30-minute marks, the unpingable assignee, read-holds-back unless reopen, the ledger and 10-minute spacing, and the presence predicate, T4 — Add the ping text builder (TG-03), the bot answer texts (TG-02) and the connect-link rules: token and start payload, usable, 5 per 10 minutes and its retry time, T6 — Add the conversations reads waitingForPings (period start, start kind, assignee, per-member read state) and attentionCount, T7 — Give bots sendMemberMessage (paced, behind the send pause, with a blocked outcome) and pingReadiness, and store the send pause on any 429, T8 — Build the telegram-link and connect-link repositories with cross-workspace isolation tests, including the sixth-exception read of workspaces with a live link, T9 — Build the presence-lease and ping-ledger repositories with cross-workspace isolation tests · **Blocks:** T17 — Wire the ping jobs: the notifications.send-pings chain per workspace, the notifications.schedule-pings cron over the sixth tenancy exception, and the QG-1 scenario tests · **Wave:** 4 — after T3, T4, T6, T7, T8, T9.
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

It is the ping itself: decided from state, re-checked at send time, written before the call, at most once per conversation per period.

## Inlined context

> - reads the bot's readiness from `bots` and skips while the bot is not working, so nothing is queued (AC-10);
> - deletes the workspace's expired presence rows;
> - a transaction share-locks the membership and recomputes that member's due set from fresh reads: still open, still waiting, still unread, member still away, link still live;
> - it writes one `pings` row and one `ping_items` row per conversation (unique per member, conversation and waiting-period start), then commits;
> - only then does it call `bots`.
>
> — `sad.md §4, choice 5, one run + the send, abridged` · full text: [sad.md](../sad.md)

> | `sendMemberMessage` outcome | Ping row | Link | Signal | Loop |
> |---|---|---|---|---|
> | `accepted` | `outcome = accepted` | `blocked_at` cleared if set | `telegram_link.changed` if it was set | continues |
> | `blocked` (403 "blocked by the user") | `outcome = blocked` — the attempt counts for the period, no retry | `blocked_at = now` if null | `telegram_link.changed` if it was null | continues |
> | `rate_limited(retryAfter)` (429) | deleted with its items (`ON DELETE CASCADE`) — the conversations stay due | — | — | **stops**; `bots.send_paused_until = now + retry_after` (later value kept); next link after the pause |
> | `bot_unavailable` (401) | deleted with its items | — | `bot.changed` (bots marks `needs_token`) | **stops** |
> | `transient` (timeout, network) | `outcome = failed` — the attempt counts, no retry | — | — | continues |
>
> — `contracts/events.md §Event: notifications.send-pings, outcome table, verbatim` · full text: [events.md](../contracts/events.md)

> **Send:** the membership (`FOR SHARE`) → the ledger inserts (unique) → commit → Telegram → a short outcome transaction (ping row, link reachability, signal). A send racing a deactivation serialises on the membership lock […] every path that touches a membership locks it before any notifications row
>
> — `sad.md §8, Concurrency, Send, abridged` · full text: [sad.md](../sad.md)

> The send transaction re-checks "link still live" but locks only the membership. […] For a tighter AC-04 ("no further pings"), `tasks` could let the send share-lock the link row, so that a Disconnect waits for the commit.
>
> — `sad.md §6, flagged by sequences, Disconnect racing a send, abridged` · full text: [sad.md](../sad.md)

> | Pings to non-members | 0 pings reach a Telegram account whose membership is not active at send time | send-time membership check; integration test: deactivate during a due ping → no send |
>
> — `spec.md §6, Pings to non-members, verbatim` · full text: [spec.md](../spec.md)

> | Ping volume per member | ≤ 1 ping per 10 min per member per workspace; ≤ 1 per conversation per waiting period | integration test; daily reconciliation query in the run book |
>
> — `spec.md §6, Ping volume, verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Table | Change |
|---|---|
| `tab_presences` | expired rows of W deleted; live rows read |
| `telegram_links` | live links read (with `blocked_at`); link row `FOR SHARE` in the send transaction (epic assumption: closes the sad.md §6 Disconnect-race flag); `blocked_at` set / cleared in the outcome transaction |
| `pings` / `ping_items` | insert `sending` + items before the call; `outcome` after; delete (cascade) on `rate_limited` / `bot_unavailable` |

— `data-model.md §Entities pings + ping_items + telegram_links, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — consumed by the `notifications.send-pings` job (T17). Ping links use `PUBLIC_WEB_URL`; texts from T4.

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

### AC-10 — cross-context

> **Given** a conversation of "Acme Flowers" whose ping is due
> **When** at that moment the conversation is closed, a reply was marked sent, the recipient's membership is no longer active, the bot is "not connected" or "not working", or the member blocked the bot in Telegram
> **Then** no ping reaches that member. A closed conversation or a sent reply ends the wait (AC-08). A deactivated member's Telegram link is removed as part of the deactivation, before any further ping, and is not restored when they are reactivated. While the bot does not work, no ping is sent and none is queued for later, and the member's panel shows "Pings paused — the bot is not working". Once the bot works again, conversations whose customers are still waiting and that were not pinged to a member in their current waiting period become due for that member again. They go out combined, under the one-per-10-minutes limit (AC-08), and the 30-minute team reach continues from the start of each wait. When the member has blocked the bot, their panel shows "Not reachable — you blocked the bot in Telegram, unblock it or disconnect" until a ping reaches them again. Pings to that member are still attempted when due. A failed attempt counts as that conversation's ping for this member in the waiting period and is not retried. A deactivated member's link is removed. A link made with the workspace's previous bot is removed when a different bot is connected, and its member sees "Not connected". A bot that is "taken over" can still send (shared-inbox AC-14), so pings for customers who were already waiting still go out. The panel says that new customer messages are not arriving (shared-inbox AC-14). Pings never delay or crowd out replies to customers: when the bot is at its Telegram sending limit, replies go first and pings wait or are combined.
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `runSweep(workspaceId, now)` → `{ nextRunAt }`: readiness (not ready → +20 s; paused → after the pause), delete expired leases, read live links, presence, `waitingForPings` for linked members **and** assignees, ledger and last pings; `dueSets` (T3) — `apps/api/src/modules/notifications/app/send-pings.ts`
- [ ] Per allowed member, one transaction: `lockActiveMembers(tx, ws, [account])` → link row `FOR SHARE` → re-read the due conversations (`waitingForPings` with `conversationIds`) → recompute with fresh presence and link → empty or inactive: nothing; else insert ping (`sending`) + items (conflict = another worker won), commit — same file
- [ ] Call `sendMemberMessage` with `pingText` (T4); outcome transaction per the table, publishing `telegram_link.changed` when `blocked_at` flips; stop the loop on `rate_limited` / `bot_unavailable` — same file
- [ ] Logs: workspace, account, ping id, outcome code, due-to-accepted timing with paused time separate — never the text
- [ ] Unit tests with fakes over the outcome table and the re-check; integration tests: deactivate during a due ping (both lock orders), Disconnect racing a send, read meanwhile drops out — `apps/api/src/modules/notifications/app/send-pings.test.ts`, `apps/api/src/modules/notifications/app/send-pings.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Due set empties at re-check (closed, sent reply, read, member back) | no ping row, nothing sent |
| Membership deactivated between sweep and send | no ping (share lock sees it inactive) |
| Disconnect while the send transaction holds the link share lock | Disconnect waits; the ping commits first and may follow by milliseconds (accepted, sad.md §8) |
| Bot `taken_over` | pings still sent |
| `blocked` on a link | counts for its conversations; `blocked_at` set; team reach at 5 min applies next sweep (AC-09) |
| Process dies after commit, before the call | `sending` stays and counts like `failed` |

## Definition of Done

- [ ] Unit and integration tests prove the sweep skips a bot that does not work and waits out a pause, the per-member transaction re-checks every condition under the membership and link share locks and writes the ledger before the call, each sendMemberMessage outcome updates the ping, the link and its signal as the events table says, and a deactivation or a disconnect that commits before the send transaction leads to no ping.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
