---
id: T38
title: "Keep argon2 out of the sign-in lock transaction and bound the pg pool"
layer: "app"
deps: []
blocks: ["T40", "T42"]
acs: ["AC-08", "AC-09"]
files_hint: ["apps/api/src/modules/auth/app/credentials.ts", "apps/api/src/modules/auth/app/credentials.test.ts", "apps/api/src/modules/auth/app/ports.ts", "apps/api/src/modules/auth/infra/", "apps/api/src/modules/auth/http/routes.int.test.ts", "apps/api/src/platform/db.ts", "apps/api/src/platform/config.ts", ".env.example", "apps/api/src/deps.ts", "apps/api/src/test/postgres.ts", "apps/web/e2e/support/config.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
source: "review-2026-10-11-r2"
status: "done"
---

# T38 — Keep argon2 out of the sign-in lock transaction and bound the pg pool

## Place in the sequence

- **Blocked by:** — · **Blocks:** T40 — Let the loser of a same-email acceptance race continue through the existing-account path, T42 — Make Docker-backed tests remove their containers and data, even on failure
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r2.md](../_review/review-2026-10-11-r2.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- R1 (stage-2, medium) — `auth/infra/email-lock.ts:10-14` opens a transaction with `pg_advisory_xact_lock` and `credentials.ts:41-55` runs `hasher.verify` / `verifyDummy` (argon2id, 19 MiB, t=2) inside it, so every sign-in and accept-verify holds a pool connection across the hash. The pool is `new pg.Pool({ connectionString })` with defaults (`max` 10, no `connectionTimeoutMillis`, `platform/db.ts:10`): about 10 concurrent anonymous sign-ins occupy every connection and stall all other requests, including the per-request workspace guard.

## Acceptance criteria

### AC-08 — error

> **Given** a person on the sign-in screen
> **When** they enter an unknown email or a wrong password
> **Then** the system refuses with the same message in both cases, without revealing whether the email has an account
>
> — `spec.md §5, AC-08 (US-03), verbatim` · full text: [spec.md](../spec.md)

### AC-09 — domain invariant

> **Given** 10 failed sign-in attempts for the same email within 15 minutes
> **When** anyone tries to sign in to that email again within the next 15 minutes
> **Then** the system refuses even a correct password and tells them to try again later — "too many failed attempts"; it behaves exactly the same for an email that has no account, so the lockout never reveals whether an account exists. The 15 minutes count from the 10th failure; a successful sign-in or a password reset clears the failure count
>
> — `spec.md §5, AC-09 (US-03), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [x] Never hold a DB connection while hashing. Keep AC-09's guarantee (at most 10 failed verifications per email per 15 min under concurrency) with short transactions only — e.g. reserve-then-verify: in one short transaction under the email advisory lock, check the lockout and insert a provisional failure row (the attempt counts immediately), commit; verify the hash outside any transaction; on success delete that provisional row and clear the failures in a second short transaction. Equivalent designs are fine as long as no connection is held during argon2 and the parallel-burst test still holds.
- [x] Bound the pool explicitly: add `DATABASE_POOL_MAX` and `DATABASE_POOL_CONNECTION_TIMEOUT_MS` (sane defaults, e.g. 10 and 5000) to `platform/config.ts` and document them in `.env.example`; pass them in `platform/db.ts`. Update `testConfig` / e2e config if their `Config` objects must carry the new keys.
- [x] Tests: the existing 20-parallel test still passes (≤10 recorded failures, rest 429, also for an unknown email); a new test proves no connection is held during the hash (e.g. a fake hasher that blocks until a separate query on a pool of size 1–2 succeeds, or assert `pool.totalCount - pool.idleCount` while a verify is pending); a successful sign-in still clears the failure count (AC-09).

## Edge cases

| Case | Behaviour |
|---|---|
| 20 parallel wrong passwords, one email | ≤10 failures recorded, the rest 429 |
| Correct password during the burst | Counts as an attempt only until it verifies; success clears the failures |
| Pool exhausted | A request waits at most the configured timeout, then fails, instead of hanging |

## Definition of Done

- [x] No DB connection is held while argon2 runs
- [x] Pool max + connection timeout configured and documented
- [x] Unit + integration green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [x] the regression test for each closed finding fails without the fix (RED first)
