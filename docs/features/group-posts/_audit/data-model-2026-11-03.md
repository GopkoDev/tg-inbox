# Data-model audit — group-posts (2026-11-03)

**Migrations are staged — not yet in the live `apps/api/migrations/` tree; `implement` promotes them.**

| Staged pair | Change |
|---|---|
| `docs/features/group-posts/migrations/01_add_workspaces_time_zone.{up,down}.sql` | new nullable column + check on an existing table (no rewrite, no backfill) |
| `docs/features/group-posts/migrations/02_create_destinations.{up,down}.sql` | new table |
| `docs/features/group-posts/migrations/03_create_destination_codes.{up,down}.sql` | new table |
| `docs/features/group-posts/migrations/04_create_posts.{up,down}.sql` | new table |

**Promote-time convention hint.** The repo uses kysely-ctl TypeScript migrations named `<timestamp-like sequence>_<verb>_<entity>.ts`, each wrapping the SQL in ``sql`…`.execute(db)`` with a "Promoted from docs/features/<slug>/migrations/…" header (see `1791681110016_create_broadcasts.ts`). The last is `1791681110020_add_bots_needs_token_at.ts`, so the next ≈ `1791681110021` … `1791681110024` in ordinal order; `implement` assigns the real numbers and runs `pnpm db:codegen`.

**Self-check (4/4).**
- Naming follows the repo (`<table>_<cols>_key`, `_fkey`, `_check`, `_idx`).
- Reversibility: every CREATE TABLE / INDEX / ADD COLUMN has its DROP in the `.down`.
- FK indexes: every FK (incl. composite member FKs) has an index or is the leading prefix of a unique key (`workspace_id` via the `(workspace_id, …)` uniques).
- Convention adherence: no DB defaults, app-written timestamps, CHECKs for implied rules — as broadcasts.

**Deviations:** none. **Breaking changes:** none (only an added nullable column on `workspaces`). **Drift:** none — all tables are new; `workspaces` has no domain field for `time_zone` yet (added with the code). **TBD:** none.

**Not validated against a live database at this stage** (no local Postgres image); the integration suite (Testcontainers) applies them at `implement`.
