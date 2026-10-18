---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: "M"
ticket: "roadmap step 4 — shared-inbox"
---

# 0003 — Fan out live signals through Postgres LISTEN/NOTIFY, published in the writing transaction

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

The changes the inbox must show live are committed by different modules and code paths: webhook capture and edits (`bots → conversations`), reply sends and the delivery worker (`inbox → conversations`), bot-state transitions (`bots`: health check, connect, rotate, disconnect) and deactivations (`workspaces`). The sockets that need them live in the `inbox` module (ADR-0002). bot-connection §7 states that a second API replica needs no code change, and the module rules forbid cycles (`inbox` depends on the others, not the other way round).

## Decision drivers

- Spec §6: live update p95 ≤ 3 s; availability 99.5 %.
- §2: one process today; a second replica must stay possible without code changes (bot-connection §7).
- Module rules: one-way dependencies, no module calls back into `inbox`; Postgres is the only datastore.
- A signal must never announce a change that was rolled back, nor be skipped for one that committed.

## Considered options

1. **Postgres `LISTEN/NOTIFY` via a platform publisher** — the writer calls `pg_notify` inside its own transaction (delivered only on commit); each instance holds one dedicated listening connection and dispatches to its sockets.
2. **pg-boss jobs as events** — writers enqueue a "changed" job; a worker forwards it to sockets.

## Decision outcome

**Chosen:** Option 1. It is transactional for free (a notification is delivered exactly when its transaction commits), works across replicas without new infrastructure, and adds latency in milliseconds. An in-process emitter was not considered viable: it breaks live updates the day a second replica exists (§2 constraint). Option 2 adds queue polling latency to every live update and turns a broadcast into a job per instance.

Shape: one channel; payload JSON ≤ 1 kB holding only the workspace id, the signal type and ids (never text, names or tokens — Postgres caps payloads at 8 000 bytes, and signals feed the refetch path of ADR-0002). Publishing goes through a `platform/realtime` publisher that takes the caller's transaction, so modules stay unaware of `inbox`; the listener reconnects with backoff and, after a gap, tells the hub to ask every client to resynchronise.

## Consequences

**Positive**
- Signals and data cannot disagree about what committed.
- No module depends on `inbox`; publishers know only the platform publisher.

**Negative**
- One extra database connection per instance, outside the pool.
- Signals sent while an instance's listener is reconnecting are lost; clients recover by resynchronising (a refetch storm at reconnect, bounded by open tabs).

**Neutral**
- Replacing the transport (e.g. by a broker) later keeps the publisher and hub interfaces.

## Links

- Spec: [[../spec.md]] AC-09, AC-13, AC-14, AC-15; §6
- SAD: [[../sad.md]] §4, §5, §7, §8, §11
- Related ADR: [[0002-push-change-signals-over-a-per-tab-workspace-bound-websocket-and-refetch-through-the-reads]], [[0007-add-an-inbox-module-that-orchestrates-conversations-contacts-bots-and-workspaces]]
