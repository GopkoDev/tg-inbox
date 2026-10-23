---
id: T24
title: "Add the broadcasts queues and workers: broadcasts.send (stately per workspace, retry 3, expire 60 s, 16 links per instance) with its dead letter that restarts the chain 60 s later, and broadcasts.measure-blocked-share logging the 48-hour blocked share"
layer: "wiring"
deps: ["T20", "T22"]
blocks: ["T26"]
acs: ["AC-11", "AC-15"]
files_hint: ["apps/api/src/modules/broadcasts/infra/jobs.ts", "apps/api/src/modules/broadcasts/infra/jobs.int.test.ts", "apps/api/src/modules/broadcasts/app/blocked-share.ts", "apps/api/src/modules/broadcasts/app/blocked-share.test.ts", "apps/api/src/app.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T24 — Add the broadcasts queues and workers: broadcasts.send (stately per workspace, retry 3, expire 60 s, 16 links per instance) with its dead letter that restarts the chain 60 s later, and broadcasts.measure-blocked-share logging the 48-hour blocked share

## Place in the sequence

- **Blocked by:** T20 — Add the launch transaction: memberships FOR SHARE, the per-workspace launch lock and cap, the broadcast row, the bot and the audience re-checked against the confirmed version and fingerprint, then recipients frozen, the first broadcasts.send link queued and broadcast.changed status published, T22 — Add one link of the sending chain: resolve stale in-flight recipients as not confirmed with their items, serve the sending broadcasts in turns with at most 8 sends in flight for at most 20 s, check the block at each turn, claim before the send, record each outcome with its broadcast item and a coalesced report signal, abort or finish, and decide the successor · **Blocks:** T26 — Register the broadcasts routes (registerBroadcasts): the seventeen operations with their zod schemas, the owner-only launch confirmation, launch and stop, the masked picker search, and the wiring in buildDeps (contacts ⇄ bots late-bound ports, broadcasts after team, inbox given itemDetails) and buildApp · **Wave:** 7 — after T20, T22.
- **Lane:** shares `apps/api/src/app.ts` with T26 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to follow a launched broadcast's progress and see for each recipient whether it was delivered, failed (and why) or could not arrive because they blocked the bot
> **So that** I know how many customers it really reached and whom it did not
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It turns the launch's first queued link and every link's successor into a chain that keeps a broadcast sending to the end across retries and restarts, and it emits the 48-hour blocked-share KPI.

## Inlined context

> **Chosen:** Option 1. The claim commits before the Telegram call, so no recipient can be sent twice: a recipient that is not `waiting` is never claimed again, and one left `sending` by a crash becomes not confirmed. `stately` per workspace keeps exactly one active link (one sender per bot) and lets the active link enqueue its successor. Because each link is enqueued in a transaction that also writes progress, and pg-boss retries and the dead-letter handler re-enqueue, every sending broadcast always has a link queued without any read across workspaces: **no new tenancy exception**. A 20 s link plus a 10 s send timeout stays well inside the 60 s expire, so a timed-out predecessor cannot still be sending when its successor starts.
>
> — `adr/0007 §Decision outcome, ADR-0007, verbatim` · full text: [ADR-0007](../adr/0007-send-through-a-per-workspace-pg-boss-chain-that-claims-each-recipient-before-its-send.md)

> | Queue | Policy | Payload | Notes |
> |---|---|---|---|
> | `broadcasts.send` | `stately`, `singletonKey` = workspace id, retry limit 3 with back-off, expire 60 s | workspace id | one link ≤ 20 s; enqueued by launch and by each link while a broadcast of the workspace sends (ADR-0007); worker concurrency per instance: 16 links |
> | `broadcasts.send-dlq` | dead letter of `broadcasts.send` | workspace id | logs an error, enqueues a fresh `broadcasts.send` link 60 s later |
> | `broadcasts.measure-blocked-share` | `singletonKey` = broadcast id, retry limit 2 | workspace id, broadcast id | enqueued when a broadcast ends, `startAfter` 48 h; logs the blocked share (spec §7) |
>
> — `sad.md §7, queue table, verbatim` · full text: [sad.md](../sad.md)

> The chain is a pg-boss queue with one active link per workspace (ADR-0007). A link carries only the workspace id. […] A failed link is retried 3 times with back-off. After that the dead-letter handler logs it and queues a fresh link 60 s later. A restart loses nothing: the queued link runs on any instance and continues with the recipients still waiting (AC-11).
>
> — `sad.md §6, flow 14, abridged` · full text: [sad.md](../sad.md)

> - **Blocked-share alert** (spec §7): once a broadcast ends, a delayed `broadcasts.measure-blocked-share` job (48 h later, payload workspace id + broadcast id) counts delivered recipients whose contact is now blocked for that bot and logs a structured metric. Monitoring alerts above 5 %. No panel surface.
>
> — `sad.md §4, Supporting choices, Blocked-share alert, verbatim` · full text: [sad.md](../sad.md)

> | `broadcast.blocked_share` | `workspace_id`, `broadcast_id`, `delivered_count`, `blocked_since_count`, `share` | `broadcasts.measure-blocked-share`, 48 h after the broadcast ended | team monitoring: alert when `share` > 0.05 (spec §7, OQ-1) |
> | `broadcast.link` | `workspace_id`, sends, sends per second, in-flight peak, time paused, stale in-flight resolved | each link, at its end | metrics; alert on stale in-flight resolutions and a link waiting more than 20 s (sad.md §7, §11) |
>
> — `contracts/events.md §Log events, blocked_share, link, verbatim` · full text: [events.md](../contracts/events.md)

> **Hard rule:** Async work goes through pg-boss queues named `<module>.<job>`, with workers in `modules/<m>/infra/jobs.ts`, registered by `buildApp()`. A job that follows a write is enqueued in the writing transaction.
>
> — `sad.md §2, Conventions, verbatim` · full text: [sad.md](../sad.md)

> | Tenancy | every new table has a non-null `workspace_id` and composite foreign keys `(workspace_id, …)` to `contacts`, `memberships`, `broadcasts` and `conversations`; every repository method takes `workspaceId`; each repository has a cross-workspace isolation test. The sender job carries its workspace id; `sendBroadcastMessage` takes the workspace id and the expected Telegram bot id. **No new tenancy exception** (the six stay six) | CLAUDE.md; ADR-0007 |
>
> — `sad.md §8, Tenancy, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Reads `broadcast_recipients` (delivered rows of one broadcast) and `contact_bot_reach` (through `contacts.isBlocked` / a count port) for the blocked-share measure; writes nothing of its own. Queue rows live in the pg-boss schema.

— `data-model.md` intro (pg-boss queues need no table), abridged · full text: [data-model.md](../data-model.md)

## API contract

Internal — no HTTP surface. Job contracts:

- `broadcasts.send` v1 `{ "workspace_id": "<uuid>" }` — producers: `launchBroadcast` (`jobDb(tx)` in the launch transaction), each link's successor (`startAfter` the send pause end when paused), the dead-letter handler (60 s later). Policy `stately`, `singletonKey` = `workspace_id`, retry 3 with back-off, expire 60 s, dead letter `broadcasts.send-dlq`, 16 links per instance.
- `broadcasts.send-dlq` v1 `{ "workspace_id": "<uuid>" }` — logs an error (workspace id only), enqueues a fresh `broadcasts.send` with `startAfter` 60 s. Alert on any job.
- `broadcasts.measure-blocked-share` v1 `{ "workspace_id", "broadcast_id" }` — producer: the ending transaction (T21), `startAfter` 48 h, `singletonKey` = `broadcast_id`, retry 2, no dead letter.

— `contracts/events.md §Channel: pg-boss queues`, abridged · full text: [events.md](../contracts/events.md)

## Acceptance criteria

### AC-11 — happy path

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 36 recipients, 1 of whom has since blocked the bot and 1 of whom deleted their Telegram account
> **When** a business owner or an operator opens it while it sends and after it ends
> **Then** the page shows the text, the audience as it was defined, who launched it and when, and the delivery report: totals of waiting, delivered, blocked the bot and failed, which change live without reloading, and each recipient with their outcome and time (failed with a plain reason such as "account no longer exists" or "not confirmed — Telegram did not answer, not sent again"); the recipient who blocked the bot is shown as blocked and the contact is marked as having blocked the bot (a recipient already marked as blocked when their turn comes is not sent it and gets that outcome; one who unblocked before their turn is sent it); a send Telegram refuses for any reason other than a rate limit or a block ends that recipient as failed with its reason and is not tried again; when every recipient has an outcome the broadcast becomes "sent" with its finish time; if the service restarts while sending, sending continues with the recipients still waiting, no recipient who already has an outcome is sent the broadcast again, and a send that was in flight when the service stopped ends as "not confirmed"; a recipient whose send got no answer from Telegram is never sent it again automatically
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — cross-context

> **Given** "Acme Flowers" launches a broadcast to 3 000 contacts while operators keep answering customers, and another broadcast of the workspace is already sending
> **When** operators send replies during the broadcast, and Telegram answers the bot with a rate limit
> **Then** replies go out without waiting for the broadcasts to finish — a reply sent during a broadcast reaches the customer as fast as on a quiet day (§6); the bot's broadcast sending together stays below Telegram's per-bot limit with room left for replies, pings and the bot's own answers; two broadcasts sending at the same time take turns, so neither waits for the other to finish; on a rate-limit answer to any of the bot's sends the broadcasts pause for the time Telegram asked (the bot's send pause, as for pings) and then continue where they stopped, without skipping or doubling any recipient, while replies keep going as before; a broadcast of one workspace never slows the replies, pings or broadcasts of another workspace
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Queue names, zod payload schemas and `createBroadcastQueues(jobs)` (send with DLQ, dlq, measure) — `apps/api/src/modules/broadcasts/infra/jobs.ts`
- [ ] `registerBroadcastJobs(jobs, { sendLink, measureBlockedShare, logger })`: the send worker (16 per instance) calls T22's link, the DLQ handler logs and re-enqueues 60 s later, the measure worker calls `blocked-share.ts` — same file
- [ ] Expose the enqueue helpers the launch (T20), the link successor (T22) and the ending (T21) use through their ports (`enqueueSendLink(tx, ws, startAfter?)`, `enqueueBlockedShare(tx, ws, id)`) — same file
- [ ] `measureBlockedShare(ws, broadcastId)`: delivered recipients, those now blocked for `launch_telegram_bot_id`, `share`, one `broadcast.blocked_share` log line — `apps/api/src/modules/broadcasts/app/blocked-share.ts` (+ `.test.ts`)
- [ ] Create the queues and register the workers in the composition root after the notification jobs — `apps/api/src/app.ts`
- [ ] Integration tests: chain to the end, one active link across two workers, three throws → DLQ → fresh link 60 s later, restart mid-broadcast resumes, measure log shape — `apps/api/src/modules/broadcasts/infra/jobs.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| two instances pick up links of the same workspace | `stately` + `singletonKey` keep one active; the other waits (ADR-0007) |
| a link throws three times | lands in `broadcasts.send-dlq`; handler logs `workspace_id` only and queues a fresh link 60 s later |
| the process restarts between links | the queued link runs on any instance and continues with waiting recipients (AC-11) |
| a link is redelivered after it already ran | finds no waiting recipient of a settled broadcast; claims nothing twice |
| nothing of the workspace is sending any more | no successor is queued; the chain ends |
| a broadcast ended with 0 delivered | the measure logs `share: 0`, no division error |
| two endings of one broadcast queue the measure | `singletonKey` = broadcast id keeps one job |

## Definition of Done

- [ ] Integration tests prove a launch's queued link runs and its successors carry the chain to the end, at most one link per workspace is active across two workers, a link that throws three times lands in broadcasts.send-dlq whose handler logs the workspace id and queues a fresh link 60 s later, a restart mid-broadcast resumes with the waiting recipients, and the measure job logs broadcast.blocked_share with delivered_count, blocked_since_count and share and no text, name or chat id. Links of two workspaces run at the same time, so one workspace's broadcast never waits for another's (test plan).
- [ ] No job payload or log line written by this task carries the text, a contact name, a username or a chat id (asserted on the captured log lines).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
