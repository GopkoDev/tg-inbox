---
id: T48
title: "Remove test containers on every failure path and drop the named-volume loop from the clean script"
layer: "infra"
deps: []
blocks: []
acs: []
files_hint: ["apps/api/src/test/postgres.ts", "apps/api/src/test/postgres.int.test.ts", "apps/web/e2e/global-setup.ts", "scripts/clean-test-containers.sh"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r3"
status: "todo"
---

# T48 — Remove test containers on every failure path and drop the named-volume loop from the clean script

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r3.md](../_review/review-2026-10-11-r3.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- B2 (stage-2, low) — `test/postgres.ts:46-48`: `stop()` skips `remove()` when `waitForClientsToDisconnect` throws, and memoises the rejected promise, so a second `stop()` cannot clean up either.
- B3 (stage-2, low) — `test/postgres.int.test.ts:15-22` leaks its container when an assertion fails before `stop()`; `e2e/global-setup.ts:38-39` skips `database.stop()` when `started.close()` throws.
- B4 (stage-2, low) — `scripts/clean-test-containers.sh:15-17`: `docker rm -f -v` already removes anonymous volumes, so the `docker volume rm` loop can only ever hit named volumes, contradicting the header (:3-4) that it never touches them.

## Acceptance criteria

None — test infrastructure (CLAUDE.md §Tests: Docker-backed suites remove their container and data, even on failure).

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [ ] `stop()`: `try { await waitForClientsToDisconnect } finally { await remove() }`; the memoised promise still removes on a failed wait.
- [ ] `postgres.int.test.ts` and the e2e teardown: `try/finally` so the container is stopped even when an assertion or `close()` throws.
- [ ] Clean script: drop the volume loop (anonymous volumes go with `rm -v`); keep the label filter.
- [ ] Test: a `stop()` whose disconnect wait rejects still removes the container (unit test with a fake container, or integration).

## Edge cases

| Case | Behaviour |
|---|---|
| Disconnect wait throws | Container removed, error surfaced |
| close() throws in e2e teardown | Database still stopped |

## Definition of Done

- [ ] No failure path in test setup/teardown leaves a container or volume
- [ ] Unit + integration green; `pnpm lint` clean; `docker ps -a --filter label=org.testcontainers=true` empty after the run
- [ ] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [ ] the regression test for each closed finding fails without the fix (RED first)
