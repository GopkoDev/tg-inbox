---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 6 — operator-notifications"
---

# 0002 — Track presence as per-tab leases in Postgres refreshed by the workspace live socket

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

A member is **away from the web** for a workspace when none of their tabs, on any device, has the panel open with a live connection that works now and has been on screen within the last 10 minutes (spec §1 D1). The ping job must answer "is this member away?" at send time. Today the inbox hub keeps sockets in memory per API instance. It knows owner and session but not visibility. It never reads client frames, and only the inbox page opens a socket. The architecture runs one process in v1, but nothing may assume one instance: a second replica, or a restart, must not turn present members into "away" and cause pings.

## Decision drivers

- Spec §6: presence freshness "≤ 60 s" (closed, asleep or lost connection) and "≤ 10 min + 60 s after it left the screen" (hidden tab)
- Correct with several API instances and across restarts (§7: a second replica needs no change)
- Reuse the existing socket: it already proves a live session and membership (re-validated every 5 s, shared-inbox AC-09)
- AC-01 / D1: any workspace page counts, not only the inbox

## Considered options

1. **Per-tab lease rows in Postgres, refreshed by the socket.** On open the hub inserts a row (connection id, workspace, account, `live_until` = now + 50 s, `on_screen`). Every pong extends the lease. A client `presence { onScreen }` frame on open and on `visibilitychange` updates `on_screen` and stamps `last_on_screen_at` when the tab leaves the screen. A clean close deletes the row. Away = no row with a live lease and (on screen, or on screen within 10 min).
2. **In-memory presence in each instance's hub.** No writes, and accurate within one process. But a job on instance A cannot see sockets on instance B. A restart forgets everyone until the sockets reconnect, so present members are briefly "away" and could be pinged.
3. **An HTTP heartbeat endpoint** that each tab calls every N seconds, writing `last_seen` per membership. It does not depend on the socket. But background tabs throttle timers (to about once a minute in Chromium), which breaks the 60 s target. It also duplicates the liveness the socket already proves, and it needs its own auth and rate limit.

## Decision outcome

**Chosen:** Option 1. It is the only option correct across instances and restarts. It reuses the socket's keep-alive (every 25 s, handled by the browser even in background tabs) for liveness. A 50 s lease means a dead connection stops counting within 50 s of its last pong, which is inside the 60 s target. Page Visibility's `visible` state is exactly "the selected tab of a window that is not minimised". To make any workspace page count, the **live socket moves from the inbox store to the workspace frame**: one connection per tab per workspace, shared by subscribers.

## Consequences

**Positive**
- One predicate, one table, testable with a controllable clock. Presence and the ping decision read the same source.
- No new infrastructure, and multi-instance safe by construction.

**Negative**
- One `UPDATE` per open tab every 25 s (under 5 writes per second at pilot scale, §7 threshold for batching).
- The socket now reads client frames. Only `presence` is accepted, zod-parsed, within the 1024-byte cap and coalesced per socket.
- The frame-owned socket is a refactor of the inbox store's live handling (§11).

**Neutral**
- The browser is trusted for visibility. A tab that lies can only make its own member look present (spec's safe direction).
- An activity heartbeat (mouse or keyboard) could be added later as another column.

## Links

- Spec: [[../spec.md]] §1 D1, §6 presence rows, AC-01, AC-07
- SAD: [[../sad.md]] §4 choice 2, §8 Events, §10 QG-3
- Related ADR: shared-inbox ADR-0002, [[0005-decide-pings-in-a-per-workspace-sweep-every-20-s-with-a-per-period-ledger-written-before-the-send]]
