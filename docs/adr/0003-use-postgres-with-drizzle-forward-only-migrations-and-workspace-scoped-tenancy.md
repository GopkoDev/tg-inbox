---
status: Accepted
owner: "Dmytro Hopko"
reviewers: []
updated_at: "2026-10-11"
feature_size: ""
ticket: ""
---

# 0003 — Use PostgreSQL with Drizzle ORM, forward-only drizzle-kit migrations and workspace-scoped tenancy

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko + Claude (survey greenfield foundation session)

## Context

All product data is relational (workspaces → operators, bots → contacts → conversations → messages, tags) and multi-tenant. Background work (broadcasts throttled to ~30 msgs/s per bot, scheduled posts, operator pings) needs a durable queue. The persistence stack, migration discipline, ID strategy and tenancy model are hard to change once data exists.

## Decision drivers

- Relational data with integrity constraints; one datastore for data and jobs (no Redis in v1).
- Type-safe queries in TypeScript, schema defined in code.
- Owner preference: Drizzle ORM and its own migration tool.
- Tenant isolation that is simple enough for 5–10 pilots.

## Considered options

1. **PostgreSQL 16 + Drizzle ORM + drizzle-kit (generate + migrate), forward-only** — schema in TS, SQL generated and committed; rollback = a new corrective migration.
2. **PostgreSQL + Drizzle ORM, drizzle-kit only generates, dbmate/node-pg-migrate applies with hand-written down migrations** — reversible, but two tools and hand-maintained downs.
3. **PostgreSQL + Kysely + node-pg-migrate (SQL up/down)** — reversible plain SQL, but no schema-in-code and not the owner's preferred ORM.

## Decision outcome

**Chosen:** Option 1. Additionally:
- **IDs:** UUIDv7 generated in the app (`platform/ids.ts`), stored as `uuid`; Telegram ids stored as `bigint`.
- **Tenancy:** a non-null `workspace_id` on every tenant-owned table; every repository method requires `workspaceId` and filters by it. No Postgres RLS in v1.
- **Jobs:** pg-boss in the same database (its own `pgboss` schema, managed by pg-boss, not drizzle-kit).
- **Down migrations:** not run by any tool. A `*.down.sql` staged by `data-model` is kept only as a manual emergency reference.

## Consequences

**Positive**
- One tool chain: edit schema → `pnpm db:generate` → review SQL → `pnpm db:migrate`.
- One database to back up and operate; job state is transactional with data.

**Negative**
- No automatic revert: a bad migration is fixed forward; destructive changes need expand → migrate → contract across releases.
- Tenancy is enforced by convention — a missing `workspace_id` filter leaks data; mitigated by cross-workspace isolation integration tests per repository.

**Neutral**
- Postgres RLS can be layered on later without changing the schema shape (the `workspace_id` column is already there).
- pg-boss can be swapped for a dedicated broker if throughput demands it; job producers sit behind `platform/jobs.ts`.

## Links

- Architecture map: [[../architecture-map.md]] § Datastores, § Conventions (Persistence, Migrations, IDs)
- Related ADR: [[0001-use-a-typescript-pnpm-monorepo-on-node-26]], [[0002-organize-the-backend-as-a-modular-monolith-with-layered-modules]]
