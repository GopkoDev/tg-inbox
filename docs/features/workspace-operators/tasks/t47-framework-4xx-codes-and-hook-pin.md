---
id: T47
title: "Give every framework 4xx a contract code (413 included) and pin the untyped-body hook branch"
layer: "infra"
deps: []
blocks: []
acs: ["AC-14", "AC-21"]
files_hint: ["apps/api/src/platform/errors.ts", "apps/api/src/platform/errors.test.ts", "apps/api/src/platform/content-type.ts", "apps/api/src/platform/content-type.test.ts", "apps/api/src/app.int.test.ts", "packages/shared/src/errors.ts", "packages/shared/src/errors.test.ts", "docs/features/workspace-operators/contracts/openapi.yaml", "docs/features/workspace-operators/contracts/api-sync-report.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r3"
status: "done"
---

# T47 — Give every framework 4xx a contract code (413 included) and pin the untyped-body hook branch

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r3.md](../_review/review-2026-10-11-r3.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- B1 (stage-2, low) — `platform/errors.ts:131-141` answers every Fastify 4xx other than 415 with code `VALIDATION_ERROR` and the framework's status; a body over `bodyLimit` answers `413 VALIDATION_ERROR`, while openapi.yaml:775 ties `VALIDATION_ERROR` to 400 only (api-sync-report.md:151).
- B5 (stage-2, low) — the `requireJsonBodies` branch that refuses a body with no content-type (`platform/content-type.ts:17-20`) is not pinned: with it removed, `content-type.test.ts:28` and `app.int.test.ts:37` still pass because Fastify's own `FST_ERR_CTP_INVALID_MEDIA_TYPE` yields the same 415 envelope. The branch is the CSRF defence in sad.md:726.

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

- [x] Error handler: map framework 4xx explicitly — 400 → `VALIDATION_ERROR`, 413 → a new `PAYLOAD_TOO_LARGE` code (add to `packages/shared/src/errors.ts`), 415 → `UNSUPPORTED_MEDIA_TYPE`; any other framework 4xx → 400 `VALIDATION_ERROR`, so every status/code pair the API can emit is in the contract. 5xx unchanged.
- [x] Contract: add a cross-cutting `PayloadTooLarge` (413) response to the operations that take a body and the code to the status table; note it in api-sync-report.md.
- [x] Tests: an over-`bodyLimit` body → 413 `PAYLOAD_TOO_LARGE`; a test of `requireJsonBodies` registered without `registerErrorHandler` that asserts `UNSUPPORTED_MEDIA_TYPE` for a body with no content-type (only the hook produces that code).

## Edge cases

| Case | Behaviour |
|---|---|
| Body over bodyLimit | 413 PAYLOAD_TOO_LARGE |
| Body, no content-type | 415 UNSUPPORTED_MEDIA_TYPE from the hook |

## Definition of Done

- [x] Every status/code pair the error handler can produce is in openapi.yaml
- [x] Unit + integration green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [x] the regression test for each closed finding fails without the fix (RED first)
