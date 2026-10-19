---
id: T17
title: "Wire the ping jobs: the notifications.send-pings chain per workspace, the notifications.schedule-pings cron over the sixth tenancy exception, and the QG-1 scenario tests"
layer: "wiring"
deps: ["T11", "T16"]
blocks: ["T21", "T30"]
acs: ["AC-08", "AC-10"]
files_hint: ["apps/api/src/modules/notifications/infra/jobs.ts", "apps/api/src/app.ts", "apps/api/src/modules/notifications/app/redeem.ts", "apps/api/src/modules/notifications/infra/ping-jobs.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T17 — Wire the ping jobs: the notifications.send-pings chain per workspace, the notifications.schedule-pings cron over the sixth tenancy exception, and the QG-1 scenario tests

## Place in the sequence

- **Blocked by:** T11 — Redeem a connect-link start: share-lock the membership, lock and re-check the link, enforce both uniqueness rules, link, signal and enqueue the answer, T16 — Add the send-pings use case: the per-workspace sweep, the per-member send transaction that re-checks and writes the ledger before the call, and the outcome transaction · **Blocks:** T21 — Add the API end-to-end notification stories, the integrity checks, the reply-under-ping-load test, and the secrecy assertions for pings, answers, logs and frames, T30 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the notifications module, the sixth tenancy exception, the new queues, the ports and the new components · **Wave:** 5 — after T11, T16.
- **Lane:** shares `apps/api/src/modules/notifications/app/redeem.ts` with T11; shares `apps/api/src/app.ts` with T14; shares `apps/api/src/app.ts`, `apps/api/src/modules/notifications/infra/jobs.ts` with T15; shares `apps/api/src/app.ts` with T19; shares `apps/api/src/app.ts` with T27 — serialized.

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

It keeps one sweep alive per workspace with a link, across instances and restarts, and proves the timeliness and volume rules end to end.

## Inlined context

> - **Work:** reads *workspaces with a live Telegram link* (`SELECT DISTINCT workspace_id FROM telegram_links WHERE removed_at IS NULL`, the **sixth controlled tenancy exception**, sad.md §8, ADR-0005). It returns workspace ids only and sends one `notifications.send-pings` job per workspace. The `singletonKey` absorbs a job for a workspace whose chain is alive.
>
> — `contracts/events.md §Event: notifications.schedule-pings, work, verbatim` · full text: [events.md](../contracts/events.md)

> - **Options:** policy `exclusive`, `singletonKey = workspace_id` (at most one sweep per workspace across instances), `retryLimit = 0`. A failed run is replaced by the next chain link or by the cron (sad.md §7).
>
> — `contracts/events.md §Event: notifications.send-pings, options, verbatim` · full text: [events.md](../contracts/events.md)

> 3. **`notifications.send-pings` re-enqueues itself** (a chain link with `startAfter` 20 s, or the end of the bot's send pause) and the minute cron is the backstop for a broken chain. This is how sad.md §7 says "a failed run is replaced by the next chain link or by the cron".
>
> — `contracts/events.md §Assumptions, 3, verbatim` · full text: [events.md](../contracts/events.md)

> Nothing changes in the topology. The feature runs in the one Node 26 process (Fastify API, the built web panel and its new static `notifications-sw.js`, webhook ingress, the live socket and the pg-boss workers) against one PostgreSQL 16 database. Added: the queues `notifications.schedule-pings` (cron every minute), `notifications.send-pings` (policy `exclusive`, `singletonKey` = workspace id, no retry: a failed run is replaced by the next chain link or by the cron) and `notifications.send-bot-message` (retry limit 2, expire 30 s). They are created and registered by `buildApp()` and added to the architecture map's queue table. A second replica needs no change. Presence, the ledger and the per-workspace singleton live in Postgres. Signals fan out through `LISTEN/NOTIFY`, and every instance's hub reports its own sockets.
>
> — `sad.md §7, queues, verbatim` · full text: [sad.md](../sad.md)

> (a) due at 5 min: accepted within one sweep;
> (b) three conversations due within 10 min: one ping, then one combined ping at the next allowed moment, with the counts and the lens link;
> (c) a member becomes away at 12 min: pinged at the next sweep;
> (d) reassign at 7 min to an away linked member: due at once; unassign: due for the away members;
> (e) bot `needs_token` for 20 min, then `connected`: nothing sent while broken, then one combined ping;
> (f) two workers running `send-pings` for the same workspace concurrently: the ledger holds one item per period;
>
> — `sad.md §10, QG-1 How verify, abridged` · full text: [sad.md](../sad.md)

> | Ping timeliness: due moment (5 min after the waiting message arrived), or for a combined ping the member's next allowed send moment (AC-08) → ping accepted by Telegram, p95, excluding time the bot spent at its sending limit with replies queued (AC-10) | ≤ 60 s | job timing log from due/allowed time to accepted send; integration test against the fake Bot API |
>
> — `spec.md §6, Ping timeliness, verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (reads `telegram_links` through the T8 exception method).

## API contract

Internal — queues `notifications.schedule-pings` (cron every minute, payload `{}`) and `notifications.send-pings` (`{ workspace_id }`, `exclusive`, `singletonKey`, `retryLimit 0`). — `contracts/events.md, abridged` · full text: [events.md](../contracts/events.md)

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

- [ ] `SchedulePingsJob` / `SendPingsJob` zod schemas and workers; send-pings runs `runSweep` and enqueues the next link with `startAfter` = `nextRunAt` — `apps/api/src/modules/notifications/infra/jobs.ts`
- [ ] Cron: `workspacesWithLiveLink()` (the sixth exception, ids only) → one `send-pings` per workspace; the singleton key drops live chains — same file
- [ ] Create the queues, the schedule and the workers in `buildApp()` — `apps/api/src/app.ts`
- [ ] Start a chain at once when a link is created (enqueue `send-pings` in the redeem transaction) so a new link does not wait for the cron — `apps/api/src/modules/notifications/app/redeem.ts`
- [ ] QG-1 scenarios (a)–(f) with a controllable clock against Postgres and the fake Bot API — `apps/api/src/modules/notifications/infra/ping-jobs.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Chain broken by a crash | the next minute's cron restarts it |
| Last live link of W removed | the chain stops re-enqueuing; the cron no longer lists W |
| Two instances | one sweep per workspace at a time (`exclusive` + singleton key) |

## Definition of Done

- [ ] Integration tests with a controllable clock pass QG-1 scenarios (a)–(f): one ping within a sweep at 5 minutes, combining under the 10-minute spacing with the lens link, a member who becomes away later, reassign and unassign making due at once, nothing sent while the bot needs a token then one combined ping, and two concurrent workers leaving one ledger item per period; the cron restarts a broken chain.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
