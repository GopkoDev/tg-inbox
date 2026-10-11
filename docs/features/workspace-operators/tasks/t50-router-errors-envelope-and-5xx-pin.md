---
id: T50
title: "Send router-level framework errors through the error envelope, pin the 5xx fallback, fix the stop() comment"
layer: "infra"
deps: []
blocks: []
acs: []
files_hint: ["apps/api/src/app.ts", "apps/api/src/platform/errors.ts", "apps/api/src/platform/errors.test.ts", "apps/api/src/app.int.test.ts", "apps/api/src/test/postgres.ts", "docs/features/workspace-operators/contracts/openapi.yaml", "docs/features/workspace-operators/contracts/api-sync-report.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r4"
status: "done"
---

# T50 — Send router-level framework errors through the error envelope, pin the 5xx fallback, fix the stop() comment

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r4.md](../_review/review-2026-10-11-r4.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- Y2 (stage-2, low; pre-existing) — `apps/api/src/app.ts:22` creates Fastify without `frameworkErrors`, so two router-level errors skip the error handler and answer Fastify's own body instead of the `{ error: { code, message } }` envelope:
  - `GET /api/workspaces/%E0%A4%A` answers `400 {"code":"FST_ERR_BAD_URL",…}`;
  - a path param over 100 characters answers `414 FST_ERR_MAX_PARAM_LENGTH`, a status that is in neither openapi nor `ErrorCode`.

  This breaks CLAUDE.md §Errors and openapi `ErrorEnvelope`, and the web client's envelope parse fails on both bodies.
- Y1 (stage-2, low) — nothing pins the 5xx → 500 `INTERNAL_ERROR` fallback (`platform/errors.ts:131,152-153`). In a mutation that widened the 4xx guard and mapped the fallback to 400, all 288 api tests stayed green.
- Y3 (nit) — the `TestDatabase.stop` doc comment (`test/postgres.ts:14`) says "calling it again is a no-op". After a failed disconnect wait, every later call rejects again, and `postgres.test.ts:13-15` pins that behaviour.

## Acceptance criteria

None of the findings maps to a §5 AC. They enforce the error contract: CLAUDE.md §Errors ("the one error handler returns `{ "error": { "code", "message", "details"? } }`") and the openapi `ErrorEnvelope` / `ErrorCode` table.

**Fallback:** read [openapi.yaml](../contracts/openapi.yaml) · [sad.md](../sad.md) · [CLAUDE.md](../../../../CLAUDE.md) in full when unsure. Do not guess.

## Checklist

- [x] `buildApp`: pass `frameworkErrors` (a small helper exported from `platform/errors.ts`) so that router-level framework errors go through the same mapping. A malformed URL and an over-long path param then answer 400 `VALIDATION_ERROR` in the envelope.
- [x] Contract: confirm every operation with a path param declares 400 with the envelope. Where one does not, add it to openapi and note the change in api-sync-report.md.
- [x] Tests:
  - an `app.inject` test checks that the malformed URL and the 120-character path param both answer 400 `VALIDATION_ERROR` in the envelope;
  - two cases go into `errors.test.ts`: a plain `throw new Error()` and an error with `statusCode: 503`. Both answer 500 `INTERNAL_ERROR`.
- [x] Reword the `stop()` doc comment: idempotent once it succeeded; a failed removal is retried; a failed wait is re-reported.

## Edge cases

| Case | Behaviour |
|---|---|
| Malformed percent-encoding in URL | 400 VALIDATION_ERROR envelope |
| Path param > maxParamLength | 400 VALIDATION_ERROR envelope (no 414) |
| Plain Error / statusCode 503 | 500 INTERNAL_ERROR, logged at error level |

## Definition of Done

- [x] No API response body outside the error envelope for any 4xx/5xx
- [x] Unit + integration green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [x] the regression test for each closed finding fails without the fix (RED first)
