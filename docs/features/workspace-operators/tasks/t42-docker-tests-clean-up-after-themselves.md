---
id: T42
title: "Make Docker-backed tests remove their containers and data, even on failure"
layer: "infra"
deps: ["T38"]
blocks: []
acs: []
files_hint: ["apps/api/src/test/postgres.ts", "apps/api/src/test/postgres.int.test.ts", "apps/web/e2e/global-setup.ts", "package.json", "scripts/clean-test-containers.sh"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r2"
status: "todo"
---

# T42 — Make Docker-backed tests remove their containers and data, even on failure

## Place in the sequence

- **Blocked by:** T38 — Keep argon2 out of the sign-in lock transaction and bound the pg pool · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r2.md](../_review/review-2026-10-11-r2.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- R12 (stage-2, medium; user request) — after the T28–T37 run, 5 `postgres:16-alpine` Testcontainers (one session; 4 running + 1 `Created`) and their 5 anonymous data volumes were left behind with no Ryuk reaper alive. Gaps: `stop()` relies on library defaults for container/volume removal (`apps/api/src/test/postgres.ts:17-29`); a failed migration in `startTestDatabase()` leaves the started container running; the Postgres image's `VOLUME /var/lib/postgresql/data` creates an anonymous volume per suite; `apps/web/e2e/global-setup.ts:11-33` leaks the container when setup fails after the database started (e.g. `app.listen` throws).

## Acceptance criteria

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [ ] `startTestDatabase()`: run the container with its data dir on tmpfs (`.withTmpFs({ '/var/lib/postgresql/data': 'rw' })`) so no volume is created; if migration (or anything after `start()`) throws, stop the container before rethrowing.
- [ ] `stop()`: `container.stop({ remove: true, removeVolumes: true })` explicitly; make `stop()` idempotent (a second call is a no-op).
- [ ] e2e `globalSetup`: wrap everything after `startTestDatabase()` so a failure closes the app (if started) and stops the database before rethrowing; teardown unchanged otherwise.
- [ ] Keep Ryuk enabled (do not set `TESTCONTAINERS_RYUK_DISABLED`) as the safety net for killed processes.
- [ ] Add `scripts/clean-test-containers.sh` + root script `test:docker:clean`: `docker ps -aq --filter label=org.testcontainers=true` → `docker rm -f -v`, then remove dangling anonymous volumes left by those containers. It must never touch containers/volumes without the `org.testcontainers` label (compose `tg-postgres-1`, `tg_pgdata`, anything else). Document it in CLAUDE.md §Tests and the commands table.
- [ ] Integration test `postgres.int.test.ts`: start → stop leaves no container with that id (`docker inspect` fails / container runtime client lookup) and no volume mounted by it; a forced migration failure (e.g. a bad migration folder via an injectable option) still removes the container.

## Edge cases

| Case | Behaviour |
|---|---|
| Migration throws during start | Container removed, error rethrown |
| stop() called twice | No error |
| Test process killed (Ctrl-C) | Ryuk reaps; `pnpm test:docker:clean` removes anything left |
| Compose Postgres running | Never touched by the cleanup |

## Definition of Done

- [ ] A full `pnpm test` run leaves zero `org.testcontainers` containers and no new anonymous volumes (check `docker ps -a` / `docker volume ls` before and after)
- [ ] Cleanup script removes only labelled test containers
- [ ] Unit + integration green; `pnpm lint` clean
- [ ] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [ ] the regression test for each closed finding fails without the fix (RED first)
