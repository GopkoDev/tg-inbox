---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-23"
feature_size: "L"
ticket: "roadmap step 8 — broadcasts"
---

# 0007 — Send through a per-workspace pg-boss chain that claims each recipient before its send

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Architect (autonomous pipeline run, 2026-10-23), to be confirmed by the Tech Lead at review

## Context

After launch, every recipient must get an outcome: delivered, blocked the bot, failed with a reason, not confirmed, or not sent because stopped (AC-11, AC-18). A recipient is sent at most once, including after a restart mid-send or a double launch; a send in flight when the service stopped ends "not confirmed" and is never sent again (AC-11, spec §6). Sending resumes after a restart with the recipients still waiting. Several API instances may run. pg-boss is the job system; the closest precedents are the reply drain (`inbox.deliver-replies`, `stately` per conversation, in-flight attempt mark) and the ping sweep (`notifications.send-pings`, `stately` per workspace, a chain, plus a cron backstop that needed a new tenancy exception). CLAUDE.md asks for no new tenancy exception unless unavoidable.

## Decision drivers

- AC-11, AC-12, AC-15, AC-18; spec §6 at most once, broadcast completion (1 000 in 90 s, 10 000 in 10 minutes)
- One sender per bot across instances, so the pace (ADR-0008) holds
- No cross-workspace scan (no new tenancy exception)
- Resume after a restart with no manual step

## Considered options

1. **A per-workspace chain with a committed claim per recipient.** Queue `broadcasts.send` (policy `stately`, `singletonKey` = workspace id, retry limit 3 with back-off, expire 60 s, dead-letter queue `broadcasts.send-dlq`). The payload is the workspace id only. A link runs at most 20 s: it first resolves every recipient of the workspace still `sending` (left by a dead predecessor, since only one link is active per workspace) to **not confirmed** and writes its broadcast item at the claim time (AC-16); then it serves the workspace's sending broadcasts in turns (ADR-0008). Per recipient: re-check the block mark for the launch bot; claim with a single-row conditional update `waiting → sending` (with the claim time) and commit; send; record the outcome (and the broadcast item, ADR-0010) in a second transaction. It waits for its in-flight sends (each bounded by the 10 s send timeout) before it ends, and enqueues its successor in its last transaction while any broadcast of the workspace is still sending (with `startAfter` = the send pause end when paused). Launch enqueues the first link in the launch transaction. The dead-letter handler (payload: the workspace id) logs an error and enqueues a fresh link 60 s later.
2. **One job per recipient** (10 000 jobs per broadcast, `singletonKey` = recipient). pg-boss gives at-most-once-ish execution per job, but pacing across jobs, turn-taking between broadcasts and a stop that must cancel thousands of queued jobs all fight the queue.
3. **One long-running job per broadcast.** Natural, but two broadcasts of one bot would run as two senders that must share one pace, and a 10-minute job exceeds any sane `expire`.
4. **An in-process sender started at boot** that scans for sending broadcasts. Simple loop, but the boot scan and the "which workspaces send" sweep are cross-workspace reads (a seventh tenancy exception), and several instances would each start one.

## Decision outcome

**Chosen:** Option 1. The claim commits before the Telegram call, so no recipient can be sent twice: a recipient that is not `waiting` is never claimed again, and one left `sending` by a crash becomes not confirmed. `stately` per workspace keeps exactly one active link (one sender per bot) and lets the active link enqueue its successor. Because each link is enqueued in a transaction that also writes progress, and pg-boss retries and the dead-letter handler re-enqueue, every sending broadcast always has a link queued without any read across workspaces: **no new tenancy exception**. A 20 s link plus a 10 s send timeout stays well inside the 60 s expire, so a timed-out predecessor cannot still be sending when its successor starts.

## Consequences

**Positive**
- Restart-safe and multi-instance-safe with the existing job system, and testable against the fake Telegram (restart mid-send, unanswered send).
- Stop and abort are plain row updates (ADR-0009), not job cancellations.

**Negative**
- Two small transactions per recipient (about 50 per second per sending workspace at full pace).
- A recipient claimed just before a crash is reported not confirmed even if the HTTP request never left the process. That is the conservative side the spec asks for.

**Neutral**
- Moving the worker to its own process later needs only a different `buildApp()` registration.

## Links

- Spec: [[../spec.md]] AC-11, AC-12, AC-15, AC-18, §6 at most once, broadcast completion
- SAD: [[../sad.md]] §4 choice 7, §6 flow 2, §7, §8 tenancy
- Related ADR: [[0008-pace-broadcasts-at-25-per-second-per-bot-in-turns-and-wait-for-the-send-pause]], [[0009-end-stop-or-abort-a-broadcast-by-settling-every-waiting-recipient-in-one-transaction]], operator-notifications ADR-0005, shared-inbox reply drain
