---
id: T30
title: "Shape route validation errors as the contract's field details and accept only JSON on mutating routes"
layer: "infra"
deps: []
blocks: ["T32"]
acs: ["AC-14", "AC-21"]
files_hint: ["apps/api/src/platform/errors.ts", "apps/api/src/platform/errors.test.ts", "apps/api/src/platform/content-type.ts", "apps/api/src/app.ts", "apps/api/src/app.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11"
status: "done"
---

# T30 — Shape route validation errors as the contract's field details and accept only JSON on mutating routes

## Place in the sequence

- **Blocked by:** — · **Blocks:** T32 — Move the session cookie helpers out of auth's HTTP layer, add response schemas, end the previous session on sign-in
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11.md](../_review/review-2026-10-11.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- #2 (stage-1) — route-level zod validation errors are sent with `details` = the fastify-type-provider-zod issue array and a message like `body/password The password must be at least 10 characters long` (`platform/errors.ts:117-121`). The contract documents `details: { field }` (openapi.yaml:155-164, 551-560), and SCR-08 / SCR-09 render `error.message` verbatim, so the `body/...` prefix reaches the user.
- #8 (stage-2, low) — body-less mutating POSTs (deactivate, reactivate, revoke, enter, sign-out) accept `text/plain` through Fastify's default parser, contradicting sad.md §8 CSRF row ("mutating routes accept only `application/json` bodies").

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

- [x] In `registerErrorHandler`, when `error.validation` is a zod issue list, answer `400 VALIDATION_ERROR` with `message` = the first issue's plain message (no `body/<path>` prefix) and `details` = `{ field: <last path segment of the first issue> }`.
- [x] Reject unsafe-method requests under `/api` whose `content-type` is present and not `application/json` with `415` (or remove the `text/plain` content-type parser) — a body-less POST with no content-type must still work for the panel's fetch client. Place the hook in `platform/` and register it in `buildApp()`.
- [x] Tests: a route with a zod body schema returns `{ error: { code: 'VALIDATION_ERROR', message: '<plain>', details: { field: 'password' } } }`; a `text/plain` POST to a body-less mutating route is refused; an empty JSON POST is accepted.

## Edge cases

| Case | Behaviour |
|---|---|
| Invite with a malformed email | 400, `details.field = email`, plain message |
| Redeem reset link with a short password | 400, `details.field = password` |
| `<form enctype=text/plain>` POST to `/api/.../deactivate` | Refused before the handler runs |

## Definition of Done

- [x] Every route-schema 400 matches the contract error shape
- [x] CSRF content-type rule enforced and tested
- [x] Unit + integration green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [x] the regression test for each closed finding fails without the fix (RED first)
