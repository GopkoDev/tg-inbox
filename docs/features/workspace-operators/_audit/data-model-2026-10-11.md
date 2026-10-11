# Audit — data-model — workspace-operators — 2026-10-11

Mode: greenfield (only the UTC baseline migration exists; no tables, no domain layer yet).

## Staged migrations

> Migrations are **staged** — not yet in the live `apps/api/migrations/` tree; `implement` promotes them.

| Ordinal | Up | Down |
|---|---|---|
| 01 | `docs/features/workspace-operators/migrations/01_create_accounts.up.sql` | `01_create_accounts.down.sql` |
| 02 | `docs/features/workspace-operators/migrations/02_create_sessions.up.sql` | `02_create_sessions.down.sql` |
| 03 | `docs/features/workspace-operators/migrations/03_create_sign_in_failures.up.sql` | `03_create_sign_in_failures.down.sql` |
| 04 | `docs/features/workspace-operators/migrations/04_create_password_reset_links.up.sql` | `04_create_password_reset_links.down.sql` |
| 05 | `docs/features/workspace-operators/migrations/05_create_workspaces.up.sql` | `05_create_workspaces.down.sql` |
| 06 | `docs/features/workspace-operators/migrations/06_create_memberships.up.sql` | `06_create_memberships.down.sql` |
| 07 | `docs/features/workspace-operators/migrations/07_create_invitations.up.sql` | `07_create_invitations.down.sql` |

**Promote-time hint:** kysely-ctl, `apps/api/migrations/<epoch-ms>_<name>.ts` exporting `up(db: Kysely<any>)` / `down(db: Kysely<any>)`; the latest is `1791681109971_baseline.ts`, so the next timestamp is anything later — `implement` assigns it with `pnpm db:new` at promotion. Per the architecture map, the staged pairs are run via `sql.raw`; promote either one TS migration per ordinal (keeps rollback granular — recommended) or one per module, keeping the ordinal order. After promotion: `pnpm db:migrate` → `pnpm db:codegen`, commit `db.types.gen.ts`.

**Verified:** applied to a throwaway `postgres:16-alpine` — up ×2 (idempotent, `IF NOT EXISTS`), constraint smoke (non-normalised email, second pending invitation, inconsistent `deactivated_at` all rejected), down in reverse order (0 tables left), up again.

## Conventions — sources and decisions

| Topic | Decision | Source |
|---|---|---|
| Naming | `snake_case`, plural tables, `<table>_<cols>_{key,idx,fkey,check}` | architecture map (`workspace_id`), SAD (`last_used_at`); confirmed |
| PK | `uuid`, UUIDv7 from `newId()`, no DB default | repo ADR-0004, map §Conventions |
| Timestamps | app-supplied through a clock port, no `DEFAULT now()` | owner, 2026-10-11 (SAD §8 updated — it said "database clock") |
| Audit columns | `created_at` everywhere + domain timestamps; no `updated_at` | owner, 2026-10-11 |
| Types | `text` + `CHECK` for roles, states and lengths; no `ENUM` | owner, 2026-10-11 |
| Constraints | FK / UNIQUE / NOT NULL / CHECK; no triggers | map §Persistence ("constraints welcome") |
| Cross-module FK | `memberships.account_id → accounts(id)` kept (constraint only) | owner, 2026-10-11 |
| Delete strategy | state columns; hard delete only for sessions and cleared sign-in failures | spec ACs + SAD flows 6, 12 |

## Convention deviations

- **SAD §8 "expiry is compared against the database clock"** — superseded by the app-clock decision; SAD §8 edited in this pass.
- SAD §5 table names were "indicative"; fixed now as `accounts`, `sessions`, `sign_in_failures`, `password_reset_links`, `workspaces`, `memberships`, `invitations`.

## Drift

None — no domain layer exists yet (`apps/api/src/modules/` has only `health`). No `_drift/` files.

## Breaking-change decompositions

None — every migration creates a new table.

## Open items (`<!-- TBD -->`)

- `accounts.display_name` and `workspaces.name` upper bound — spec sets none; CHECK uses 200 chars. `api` fixes the limit in the zod schema; adjust the CHECK if it differs before promotion.
- KPI "active operators in the last 7 days" (spec §7) needs per-workspace user activity; no column stores it (`sessions.last_seen_at` is per account, `memberships.last_used_at` only changes on workspace entry). Intended source: request logs (workspace id is in every scoped URL). Confirm at `plan-tests` / `ship`.
- AC-18 (at least one active owner) is enforced in the app layer under the workspace row lock, not by the DB — covered by the concurrency integration test.

## Self-check

| Check | Result |
|---|---|
| Naming matches the repo convention | pass |
| Down reversibility (every CREATE TABLE / CREATE INDEX has a DROP) | pass — verified by executing down |
| FK indexes | pass — `sessions.account_id`, `password_reset_links.account_id`, `memberships.account_id`, `memberships.workspace_id` (leading col of the unique), `invitations.workspace_id` |
| Convention adherence | pass — one documented deviation (SAD §8 clock), resolved |
| Mermaid `erDiagram` | structural lint pass (`mmdc` not installed): valid cardinality glyphs, `type name [PK|FK|UK] "comment"` attribute lines |
| PII in seeds / fixtures | pass — no seeds; fixtures use `@example.test`, `Test User` |

## Next stage

`/sdd:api workspace-operators`
