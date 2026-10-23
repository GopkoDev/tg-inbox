---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 6 — operator-notifications"
---

# 0001 — Add a notifications module that owns Telegram links, presence and pings and is reached through ports

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

The feature adds four kinds of state:
- Telegram links (a membership's personal Telegram account through the workspace bot);
- connect links;
- per-tab presence;
- a ping ledger.

It also adds two kinds of behaviour. Background jobs decide and send pings. A capture-time check keeps linked members and connect-link starts out of `conversations`. The data it reads belongs to three modules: conversations (waiting, assignee, read state), workspaces (active memberships, names) and bots (bot state, the only Telegram client). Capture runs in `bots`, which already depends on `conversations`. Deactivation runs in `workspaces`, which depends on no feature module. The surface question is also settled here: what the feature builds, backend and/or web and/or a separate worker.

## Decision drivers

- `CLAUDE.md`: one module per roadmap capability, one-way dependencies, cross-module only through app layers, tables owned by one module; the architecture map already reserves a future `notifications` module
- `bots` is the only module that talks to Telegram, and its token stays inside it
- `inbox` is an orchestrator that owns no tables (shared-inbox ADR-0007)
- Precedent for reaching a dependent module: `workspaces.onMembershipDeactivated`, a port filled in `buildDeps()` (assignment-statuses ADR-0005)
- Spec goals: never leak, never flood. One owner for the due rules and the ledger makes those invariants testable in one place

## Considered options

1. **A new `notifications` module.** It owns the four tables, the due rules, the jobs and the Settings — Notifications routes. Static edges: `notifications → {conversations, workspaces, bots}` and `inbox → notifications` (the hub reports presence). Runtime edges through ports: `bots` declares an inbound interceptor and a bot-connected hook; `workspaces`' deactivation port becomes a composition built in `buildDeps()`.
2. **Put links and pings inside `bots`.** `bots` already talks to Telegram and sees every inbound update, so capture skipping and sending would be local. But `bots` would then need presence (fed by the inbox hub) and conversation-level due rules, and would grow from "the bot connection" into the notification product.
3. **Put it inside `inbox`.** `inbox` already reads every module and owns the hub, so presence would be local. But `inbox` owns no tables by decision, and capture in `bots` would need an edge `bots → inbox`, which closes a cycle (`inbox → bots`).

## Decision outcome

**Chosen:** Option 1. It keeps each existing module's responsibility intact. Notification rules, links and the ledger have one owner with one test surface (goals 1 and 2). The graph stays acyclic by reusing the decided port pattern. `bots` still holds the only Telegram client: `notifications` asks it to send through `sendMemberMessage` and never sees a token.

**Target surfaces:** `backend-service` + `web-frontend`. The ping jobs are pg-boss workers in the same API process, like the reply drain and health checks, so no `worker` surface is declared (shared-inbox, bot-connection precedent).

## Consequences

**Positive**
- The due rules, the ping text and the presence predicate are pure domain code in one module, unit-testable with fakes.
- `bots` keeps a narrow job: classify, intercept through the port, capture, send.
- Adding another channel later (email, push) extends one module.

**Negative**
- Construction order in `buildDeps()` gets longer (bots core → notifications → bots' ports → team), and the ports need fakes in `bots` and `workspaces` unit tests.
- Two runtime edges (`bots ⇢ notifications`, `workspaces ⇢ notifications`) are invisible in the import graph and must be documented in the architecture map.

**Neutral**
- Moving links into `bots` later is a table move plus port removal, a few days of work.

## Links

- Spec: [[../spec.md]] §1, §5 AC-04, AC-07, AC-11
- SAD: [[../sad.md]] §4, §5
- Related ADR: [[0003-intercept-connect-link-starts-and-linked-members-messages-in-bots-before-capture-through-a-port]], assignment-statuses ADR-0005, shared-inbox ADR-0007
