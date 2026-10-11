---
status: Accepted
owner: "Dmytro Hopko"
reviewers: []
updated_at: "2026-10-11"
feature_size: ""
ticket: ""
---

# 0002 — Organize the backend as a modular monolith with layered modules

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko + Claude (survey greenfield foundation session)

## Context

The roadmap (`docs/roadmap.md`) decomposes the product into ~11 steps: workspaces, bots, inbox, contacts, notifications, broadcasts, posts, AI drafts, MCP server. They share one database and one deploy, yet must stay separable so parallel roadmap waves (e.g. inbox ∥ contacts) don't collide and later capabilities (MCP server, AI) can call into existing modules cleanly.

## Decision drivers

- One deployable for 5–10 pilot businesses — no operational overhead of services.
- Clear ownership per roadmap step so waves can be built in parallel worktrees.
- Testable business rules without a database (fast unit tests).

## Considered options

1. **Modular monolith, each module layered `domain → app → infra → http`** — modules talk via app-layer calls; async work via pg-boss jobs.
2. **Flat layered app (`routes/`, `services/`, `repositories/` at top level)** — simplest start, but module boundaries erode as features grow.
3. **Microservices** — strong isolation, far too much infrastructure for a pre-pilot product.

## Decision outcome

**Chosen:** Option 1. One module per roadmap capability under `apps/api/src/modules/<m>/`; each owns its tables; the composition root `apps/api/src/app.ts` wires everything. Layers are kept light — a module with trivial logic may omit `domain/`.

## Consequences

**Positive**
- Parallel roadmap waves touch disjoint folders.
- A later MCP server or AI module reuses existing app-layer use cases instead of reaching into tables.

**Negative**
- More files per feature than a flat layout; cross-module reads go through app-layer functions instead of SQL joins.

**Neutral**
- A module can later be extracted into its own process (e.g. job workers) because it already communicates through explicit interfaces.

## Links

- Architecture map: [[../architecture-map.md]] § Module inventory, § Conventions
- Related ADR: [[0001-use-a-typescript-pnpm-monorepo-on-node-26]], [[0003-use-postgres-with-drizzle-forward-only-migrations-and-workspace-scoped-tenancy]]
