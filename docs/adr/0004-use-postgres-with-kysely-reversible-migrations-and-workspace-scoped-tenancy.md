---
status: Accepted
owner: "Dmytro Hopko"
reviewers: []
updated_at: "2026-10-11"
feature_size: ""
ticket: ""
---

# 0004 — Use PostgreSQL with Kysely, reversible Kysely migrations via kysely-ctl and workspace-scoped tenancy

- **Status:** Accepted — supersedes [[0003-use-postgres-with-drizzle-forward-only-migrations-and-workspace-scoped-tenancy]]
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko + Claude (survey foundation revision, before any code was scaffolded)

## Context

ADR-0003 chose Drizzle ORM with forward-only drizzle-kit migrations. Before the skeleton was materialized the owner reverted the data-access choice to Kysely. With Drizzle gone, drizzle-kit no longer fits, so the migration tool is re-decided too. The rest of ADR-0003 (PostgreSQL 16, UUIDv7 ids, `workspace_id` tenancy, pg-boss) is unchanged and restated here so this ADR stands alone.

## Decision drivers

- Owner preference: Kysely — SQL-shaped, type-safe queries without ORM abstractions.
- Reversible migrations — the pipeline's `data-model` stage emits paired up/down SQL; a runner that executes `down` keeps them meaningful.
- One tool chain around the query layer, minimal moving parts.
- Relational data with integrity constraints; one datastore for data and jobs (no Redis in v1).

## Considered options

1. **Kysely + Kysely Migrator via kysely-ctl, types from kysely-codegen** — TS migrations with `up`/`down`, CLI for make/latest/down, `DB` interface generated from the migrated database.
2. **Kysely + node-pg-migrate (plain SQL Up/Down) + kysely-codegen** — tool-agnostic SQL, closest to data-model's `.sql` pairs, but a second tool unrelated to the query layer.
3. **Kysely for queries + Drizzle schema with drizzle-kit (forward-only)** — two sources of truth for types, no rollback.

## Decision outcome

**Chosen:** Option 1. Migrations live in `apps/api/migrations/<timestamp>_<name>.ts` and each exports `up` and `down`; `kysely-ctl` runs them (`pnpm db:migrate` / `pnpm db:rollback` / `pnpm db:new`). After migrating, `pnpm db:codegen` regenerates `apps/api/src/platform/db.types.gen.ts` (committed). Additionally (carried over from ADR-0003):
- **IDs:** UUIDv7 generated in the app (`platform/ids.ts`), stored as `uuid`; Telegram ids stored as `bigint`.
- **Tenancy:** a non-null `workspace_id` on every tenant-owned table; every repository method requires `workspaceId` and filters by it. No Postgres RLS in v1.
- **Jobs:** pg-boss in the same database (its own `pgboss` schema, managed by pg-boss).

## Consequences

**Positive**
- Rollback works: `down` is executed by the same tool that applies `up`.
- Queries read like SQL and stay fully typed; no ORM runtime between code and Postgres.
- data-model's staged `*.up.sql` / `*.down.sql` map 1:1 onto a migration's `up` / `down`.

**Negative**
- Table types come from code generation against a live DB — forgetting `pnpm db:codegen` leaves stale types.
- Every migration needs a hand-written `down`; a `down` that drops data is not a true undo, so destructive changes still need expand → migrate → contract.
- Tenancy is enforced by convention — a missing `workspace_id` filter leaks data; mitigated by cross-workspace isolation integration tests per repository.

**Neutral**
- Postgres RLS can be layered on later without changing the schema shape.
- pg-boss can be swapped for a dedicated broker if throughput demands it; producers sit behind `platform/jobs.ts`.

## Links

- Architecture map: [[../architecture-map.md]] § Stack, § Datastores, § Conventions (Persistence, Migrations, IDs)
- Supersedes: [[0003-use-postgres-with-drizzle-forward-only-migrations-and-workspace-scoped-tenancy]]
- Related ADR: [[0001-use-a-typescript-pnpm-monorepo-on-node-26]], [[0002-organize-the-backend-as-a-modular-monolith-with-layered-modules]]
