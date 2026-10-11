---
id: T39
title: "Keep Fastify's own 4xx statuses, refuse untyped bodies, document 415 in the contract"
layer: "infra"
deps: []
blocks: []
acs: ["AC-14", "AC-21"]
files_hint: ["apps/api/src/platform/errors.ts", "apps/api/src/platform/errors.test.ts", "apps/api/src/platform/content-type.ts", "apps/api/src/platform/content-type.test.ts", "apps/api/src/app.int.test.ts", "packages/shared/src/errors.ts", "docs/features/workspace-operators/contracts/openapi.yaml", "docs/features/workspace-operators/contracts/api-sync-report.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r2"
status: "done"
---

# T39 — Keep Fastify's own 4xx statuses, refuse untyped bodies, document 415 in the contract

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r2.md](../_review/review-2026-10-11-r2.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- R2 (stage-2, medium) — `platform/errors.ts:130-131` maps every non-`AppError`, non-validation error to `500 INTERNAL_ERROR` and logs it at error level, so a malformed JSON body (`{`), an empty body with `content-type: application/json`, and a body sent with no content-type (`FST_ERR_CTP_INVALID_MEDIA_TYPE`) all answer 500. contracts/api-sync-report.md:151 requires Fastify's own 4xx (415, 400 malformed JSON) to keep their status. The new 415 (`platform/content-type.ts:16`) answers with code `VALIDATION_ERROR`, which openapi.yaml:754-758 pins to 400; no operation lists 415.

## Acceptance criteria

### AC-14 — happy path

> **Given** a business owner of "Acme Flowers"
> **When** they invite a new hire's email address as an operator
> **Then** a pending invitation valid for 7 days appears in the team list and the owner sees its link to copy once, right after creating it (a lost link is replaced by inviting the same email again); any earlier pending invitation for the same email stops working
>
> — `spec.md §5, AC-14 (US-05), verbatim` · full text: [spec.md](../spec.md)

### AC-21 — happy path

> **Given** a person who forgot the password of their account and asked the tg-inbox team for help
> **When** a platform admin issues a password-reset link for that account and the person sets a new valid password through it
> **Then** the person is signed in on that device with the new password, every other session of that account ends, the failure count of AC-09 is cleared, and the link cannot be used again; the platform admin sees the link once, right after issuing it, and issuing a new reset link for the same account makes any earlier unused one stop working
>
> — `spec.md §5, AC-21 (US-08), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [x] Error handler: a non-`AppError` with a 4xx `statusCode` (Fastify `FST_ERR_CTP_*`, body-parser `SyntaxError`, `FST_ERR_CTP_EMPTY_JSON_BODY`, …) keeps its status and answers the standard envelope — 400 → `VALIDATION_ERROR`; 415 → a dedicated code (add e.g. `UNSUPPORTED_MEDIA_TYPE` to `packages/shared/src/errors.ts`); log at info/warn, not error. 5xx and unknown errors stay `INTERNAL_ERROR`.
- [x] `requireJsonBodies`: also refuse with 415 a request that carries a body (`content-length` > 0 or `transfer-encoding`) but no content-type; a body-less POST with no content-type still passes.
- [x] Contract: add a shared `UnsupportedMediaType` (415) response to openapi.yaml for the mutating operations (or document it once as a cross-cutting response) and the new code in the status table; note the change in api-sync-report.md.
- [x] Integration tests (app.inject): malformed JSON → 400 `VALIDATION_ERROR`; empty JSON body → 400; body without content-type → 415 with the new code; `text/plain` → 415 with the new code; no error-level log for any of them.

## Edge cases

| Case | Behaviour |
|---|---|
| `{` with application/json | 400 VALIDATION_ERROR |
| Empty body with application/json | 400 |
| Body, no content-type | 415 |
| No body, no content-type (deactivate) | Passes to the handler |

## Definition of Done

- [x] No client-triggerable 4xx answers 500
- [x] 415 documented in openapi.yaml with its own code
- [x] Unit + integration green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [x] the regression test for each closed finding fails without the fix (RED first)
