---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-23"
feature_size: "L"
ticket: "roadmap step 8 — broadcasts"
---

# 0001 — Add a broadcasts module that owns drafts, groups and recipients and reaches other modules through their app layers

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Architect (autonomous pipeline run, 2026-10-23), to be confirmed by the Tech Lead at review

## Context

Broadcasts are a new capability area (spec §1, size L): drafts with an audience, a frozen recipient list, a background send through the workspace's bot, a live report, and an item in each recipient's thread. They touch four shipped modules: `contacts` (who is in the audience, who blocked the bot), `bots` (the only module that talks to Telegram), `conversations` (the thread) and `workspaces` (roles and member names). The repo is a modular monolith where each table has one owning module and modules call each other's app layer only (repo ADR-0002). The map already reserves a future `broadcasts` module (architecture map, module inventory).

## Decision drivers

- One owner per table; cross-module work only through app layers, wired in `buildDeps()` (CLAUDE.md)
- `bots` stays the only module that talks to Telegram; `inbox` owns no tables
- The dependency graph stays acyclic (repo ADR-0002)
- The surfaces this feature builds: a backend capability and a web panel area (spec §4 roles, ux-flows SCR-24…SCR-32)

## Considered options

1. **A new `broadcasts` module** with its own tables (`broadcasts`, `broadcast_audience_tags`, `broadcast_group_contacts`, `broadcast_recipients`), its own routes under `/api/workspaces/:workspaceId/broadcasts…`, its own pg-boss queues, and static edges `broadcasts → {contacts, conversations, bots, workspaces}` plus `inbox → broadcasts` (thread enrichment). Surfaces: `backend-service` + `web-frontend`.
2. **Grow `contacts`** to own broadcasts, since audiences are contacts. Contacts would then need to send through `bots` and write into `conversations`, but `bots → contacts` and `conversations → contacts` already exist, so either edge would close a cycle.
3. **Grow `inbox`** as the orchestrator. `inbox` would then own tables, against its rule, and its routes would mix the operator inbox with a separate panel area.

## Decision outcome

**Chosen:** Option 1. It keeps the graph acyclic: nothing calls `broadcasts` back (blocks are learned in `bots` → `contacts`, tag deletes are detected at read time per ADR-0004, bot changes are detected by the sender per ADR-0008), so `broadcasts` needs no inbound port. Telegram stays inside `bots` (`sendBroadcastMessage`, ADR-0008) and the thread stays inside `conversations` (ADR-0010). The sender is a pg-boss job in the same process, so no separate `worker` surface.

## Consequences

**Positive**
- Broadcast rules (versions, launch, sending, stop, duplicates) live in one module with in-memory port fakes for unit tests.
- Contacts, conversations and bots gain small, explicit app-layer calls instead of broadcast logic.

**Negative**
- Audience evaluation crosses a module boundary on every draft read and at launch (ids passed to `contacts`, ADR-0004), instead of one SQL join.
- `inbox` gains a dependency (`inbox → broadcasts`) for the thread's broadcast item details.

**Neutral**
- Splitting the sender into its own process later needs no module change: the job is already isolated behind its queue.

## Links

- Spec: [[../spec.md]] §1, §4 US-01…US-08
- SAD: [[../sad.md]] §4 choice 1, §5
- Related ADR: [[0004-evaluate-audiences-in-contacts-with-the-contacts-filter-rules-and-return-the-breakdown-and-the-reachable-set]], [[0010-store-broadcast-items-as-a-conversations-thread-entry-that-never-touches-conversation-state]]
