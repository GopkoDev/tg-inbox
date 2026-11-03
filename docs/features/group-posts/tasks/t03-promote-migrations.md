---
id: T3
title: "Promote staged migrations 01\u201304 (workspaces.time_zone, destinations, destination_codes, posts) and regenerate DB types"
layer: "migration"
deps: []
blocks: ["T7", "T8"]
acs: ["AC-04"]
files_hint: ["apps/api/migrations/", "docs/features/group-posts/migrations/", "apps/api/src/platform/db.types.gen.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
status: "done"
step: "COMMIT"
---

# T3 — Promote staged migrations 01–04 (workspaces.time_zone, destinations, destination_codes, posts) and regenerate DB types

## Place in the sequence

- **Blocked by:** — · **Blocks:** T7 — Add workspaces.timeZone and setTimeZone in the workspaces ap, T8 — Build the posts repositories for destinations, destination c · **Wave:** 1 (after its deps).
- **Lane:** migration lane (serialized).

## Why (user story)

> **As a** Business owner
> **I want** to connect the business's Telegram channel or group to the workspace by posting a code from the panel into it
> **So that** the team can post there through the business bot, and no other chat can be posted to by mistake
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to write a post for one of the workspace's destinations and save it as a draft the team can see and edit
> **So that** posts are prepared together before an owner sends them
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

This task delivers: promote staged migrations 01–04 (workspaces.time_zone, destinations, destination_codes, posts) and regenerate DB types.

## Inlined context

> Every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it.
>
> — `CLAUDE.md §Rules «Tenancy», abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> Promote-time convention hint. The repo uses kysely-ctl TypeScript migrations … wrapping the SQL in sql`…`.execute(db) with a "Promoted from docs/features/<slug>/migrations/…" header … next ≈ `1791681110021` … `1791681110024` in ordinal order; `implement` assigns the real numbers and runs `pnpm db:codegen`.
>
> — `_audit/data-model-2026-11-03.md, abridged` · full text: [_audit/data-model-2026-11-03.md](../_audit/data-model-2026-11-03.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Staged pairs → live: `01_add_workspaces_time_zone`, `02_create_destinations`, `03_create_destination_codes`, `04_create_posts` (full SQL in `docs/features/group-posts/migrations/`). Tables: `destinations` UNIQUE `(workspace_id, chat_id)`; `destination_codes` UNIQUE `(workspace_id, code_hash)`; `posts` with 8 states + checks; composite FKs to `memberships` and `destinations`.

— `data-model.md §Entities, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-04 — authorization

> **Given** members of "Acme Flowers" and of "Bolt Bikes"
> **When** a member of "Bolt Bikes" opens, edits or publishes a post or a destination of "Acme Flowers" by its address
> **Then** the system refuses as if it did not exist and reveals nothing about it; each workspace sees and posts only to its own destinations, through its own bot
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] create `apps/api/migrations/1791681110021_add_workspaces_time_zone.ts` … `…024_create_posts.ts` wrapping each staged up/down SQL
- [ ] `pnpm db:migrate` then `pnpm db:rollback` ×4 then migrate again on a local DB
- [ ] `pnpm db:codegen` → commit `db.types.gen.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| re-run of a partly applied migration | IF NOT EXISTS makes it a no-op |
| rollback | drops posts → codes → destinations → column, in reverse order |

## Definition of Done

- [ ] migrations apply and revert cleanly (integration harness `src/test/postgres.ts` applies them)
- [ ] db types regenerated and committed
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
