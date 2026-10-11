---
id: T1
title: "Promote the seven staged migrations and regenerate DB types"
layer: "migration"
deps: []
blocks: ["T5", "T6"]
acs: ["AC-01", "AC-09", "AC-14", "AC-16", "AC-21"]
files_hint: ["docs/features/workspace-operators/migrations/", "apps/api/migrations/", "apps/api/src/platform/db.types.gen.ts", "apps/api/src/test/migrations.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T1 — Promote the seven staged migrations and regenerate DB types

## Place in the sequence

- **Blocked by:** — · **Blocks:** T5 — Build the auth repositories and the argon2id password hasher, T6 — Build the workspaces repositories with cross-workspace isolation tests · **Wave:** 1 — the schema has no upstream; every repository needs the tables and the generated `DB` types.
- **Lane:** `layer: migration` — always serialized; owns `db.types.gen.ts` (no other task regenerates it).

## Why (user story)

> **As a** Platform admin
> **I want** to create a workspace for a pilot business together with an invitation for its first business owner
> **So that** the business can start using tg-inbox without a self-serve signup
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to sign in to the web panel with my email and password and sign out when I am done
> **So that** only I can act in the workspaces I belong to
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

This task creates the seven tables every later task of the feature reads and writes (accounts, sessions, sign-in failures, reset links, workspaces, memberships, invitations); the stories US-05 and US-08 rest on the same tables.

## Inlined context

> **Migrations:** reversible — every migration exports a working `up` **and** `down`. After migrating, run `pnpm db:codegen` and commit the regenerated types. … **DB:** … `DB` is generated into `src/platform/db.types.gen.ts` — never hand-edit it. No triggers or stored procedures; constraints are fine.
>
> — `CLAUDE.md §Rules, Migrations + DB, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> Timestamps are supplied by the application through a clock port — no `DEFAULT now()` … Roles and states are `text` with a `CHECK (… IN (…))` … no Postgres `ENUM` types, no triggers. … Link and session tokens are never stored — only their SHA-256 hash as a 32-byte `bytea`. … The one cross-module FK, `memberships.account_id → accounts(id)`, is kept as a constraint only.
>
> — `data-model.md §Conventions applied, abridged` · full text: [data-model.md](../data-model.md)

> Staged under `migrations/` — **not** in `apps/api/migrations/` yet; `implement` promotes them in ordinal order (FK dependencies follow the order). … **Seeds:** none.
>
> — `data-model.md §Migrations (staged), verbatim` · full text: [data-model.md](../data-model.md)

> Migrations take Kysely<any> — they are frozen in time and must not depend on the generated DB types.
>
> — `apps/api/migrations/1791681109971_baseline.ts, header comment, verbatim` · full text: [baseline](../../../../apps/api/migrations/1791681109971_baseline.ts)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Staged pairs (promote in this order, each into one Kysely TS migration whose `up`/`down` run the SQL through the `sql` template):

| Ordinal | Staged pair | Creates |
|---|---|---|
| 01 | `01_create_accounts.up.sql` / `.down.sql` | `accounts` |
| 02 | `02_create_sessions.up.sql` / `.down.sql` | `sessions` |
| 03 | `03_create_sign_in_failures.up.sql` / `.down.sql` | `sign_in_failures` |
| 04 | `04_create_password_reset_links.up.sql` / `.down.sql` | `password_reset_links` |
| 05 | `05_create_workspaces.up.sql` / `.down.sql` | `workspaces` |
| 06 | `06_create_memberships.up.sql` / `.down.sql` | `memberships` (needs 01, 05) |
| 07 | `07_create_invitations.up.sql` / `.down.sql` | `invitations` |

— `data-model.md §Migrations (staged), table, verbatim` · full text: [data-model.md](../data-model.md)

Load-bearing constraints the promoted SQL must keep unchanged:

| Table | Constraint / index | Change |
|---|---|---|
| `accounts` | `email` UNIQUE + CHECK `email = lower(btrim(email))` | added |
| `sessions`, `password_reset_links`, `invitations` | `token_hash bytea` UNIQUE, CHECK 32 bytes | added |
| `sign_in_failures` | no FK on `email`; index `(email, failed_at)` | added |
| `memberships` | UNIQUE `(workspace_id, account_id)`; CHECK `(state = 'deactivated') = (deactivated_at IS NOT NULL)` | added |
| `invitations` | partial UNIQUE `(workspace_id, email) WHERE state = 'pending'`; CHECK `(state = 'pending') = (closed_at IS NULL)` | added |

— `data-model.md §Indexes + §Entities, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-01 — happy path

> **Given** a platform admin and a pilot business named "Acme Flowers" together with its owner's email address
> **When** the platform admin creates the workspace with that name and owner email
> **Then** the workspace exists, awaiting its first business owner, with an invitation carrying the business owner role issued for that email, and the platform admin sees the invitation link once, right after creation, to pass on; until that invitation is accepted nobody can see or act in the workspace
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — domain invariant

> **Given** 10 failed sign-in attempts for the same email within 15 minutes
> **When** anyone tries to sign in to that email again within the next 15 minutes
> **Then** the system refuses even a correct password and tells them to try again later — "too many failed attempts"; it behaves exactly the same for an email that has no account, so the lockout never reveals whether an account exists. The 15 minutes count from the 10th failure; a successful sign-in or a password reset clears the failure count
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — happy path

> **Given** a business owner of "Acme Flowers"
> **When** they invite a new hire's email address as an operator
> **Then** a pending invitation valid for 7 days appears in the team list and the owner sees its link to copy once, right after creating it (a lost link is replaced by inviting the same email again); any earlier pending invitation for the same email stops working
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — domain invariant

> **Given** a business owner of "Acme Flowers" and a person who already has a membership there (active or deactivated)
> **When** the owner invites that person's email
> **Then** the system refuses and tells the owner the person is already a member — reactivate them instead if they are deactivated
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

### AC-21 — happy path

> **Given** a person who forgot the password of their account and asked the tg-inbox team for help
> **When** a platform admin issues a password-reset link for that account and the person sets a new valid password through it
> **Then** the person is signed in on that device with the new password, every other session of that account ends, the failure count of AC-09 is cleared, and the link cannot be used again; the platform admin sees the link once, right after issuing it, and issuing a new reset link for the same account makes any earlier unused one stop working
>
> — `spec.md §5, AC-21, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] For each ordinal 01–07, run `pnpm db:new <name>` (e.g. `create_accounts`) so the files sort in ordinal order after the baseline — `apps/api/migrations/`
- [ ] Paste the staged `*.up.sql` into `up(db: Kysely<any>)` and the `*.down.sql` into `down`, via `` sql`…`.execute(db) `` like the baseline; keep constraint and index names verbatim — `apps/api/migrations/<ts>_create_*.ts`
- [ ] `docker compose up -d`, `pnpm db:migrate`, then `pnpm db:rollback` seven times and `pnpm db:migrate` again — every `down` must revert cleanly
- [ ] `pnpm db:codegen` and commit the regenerated `apps/api/src/platform/db.types.gen.ts` (never hand-edit)
- [ ] Add a migration smoke integration test: after `startTestDatabase()` the seven tables exist and a non-normalised `accounts.email` insert and a duplicate pending invitation per (workspace, email) are rejected — `apps/api/src/test/migrations.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Insert `accounts.email = ' Bob@x.com'` | rejected by the normalised CHECK |
| Two pending invitations for the same (workspace, email) | second insert violates `invitations_workspace_id_email_pending_key` |
| Second membership for the same (workspace, account) | rejected by `memberships_workspace_id_account_id_key` (AC-16 backstop) |
| Sign-in failure for an email with no account | insert succeeds — no FK on `sign_in_failures.email` (AC-09) |
| `memberships.state = 'deactivated'` with null `deactivated_at` | rejected by the CHECK |
| Rolling back past 06 while 07 exists | not possible out of order — `down` runs newest-first |

## Definition of Done

- [ ] staged migration is promoted to live `apps/api/migrations/`, then applies and reverts cleanly (all seven, full rollback + re-migrate)
- [ ] `db.types.gen.ts` regenerated and committed; `pnpm typecheck` passes
- [ ] `migrations.int.test.ts` passes against Testcontainers Postgres
- [ ] no `DEFAULT now()`, no DB-generated ids, no triggers in any promoted file
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
