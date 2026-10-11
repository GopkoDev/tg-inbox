---
id: T52
title: "Keep link tokens out of request logs; document the transport-level error exceptions"
layer: "infra"
deps: []
blocks: []
acs: []
files_hint: ["apps/api/src/platform/logger.ts", "apps/api/src/platform/logger.test.ts", "apps/api/src/platform/errors.ts", "apps/api/src/platform/errors.test.ts", "apps/api/src/app.int.test.ts", "docs/features/workspace-operators/contracts/api-sync-report.md", "docs/features/workspace-operators/tasks/t50-router-errors-envelope-and-5xx-pin.md", "docs/features/workspace-operators/tasks.json"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r5"
status: "done"
---

# T52 — Keep link tokens out of request logs; document the transport-level error exceptions

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r5.md](../_review/review-2026-10-11-r5.md) (Z2 *Fix now*, Z3 *Document*). The finding numbers below are that record's.

## Review findings this task closes

- Z2 (stage-2, medium; older than round 5). Invitation and reset links are `${base}/invite/${token}` (`modules/workspaces/app/team.ts:199`, `app/admin.ts:69`) and `${base}/reset-password/${token}` (`modules/auth/app/reset-links.ts:65`).
  - With `WEB_DIST_DIR` set, the API serves those SPA pages itself (`app.ts:27-33`). Fastify's default `incoming request` line logs `req.url` at info level, and `REDACT` (`platform/logger.ts:5-12`) does not cover it.
  - The router-error path (`platform/errors.ts:126`, `request.log.info({ err }, 'client error')`) also logs `err.message`. For `FST_ERR_BAD_URL` that message contains the raw path. The 400 response message (`errors.ts:144`) echoes `error.message` too.
  - Anyone who can read the logs can redeem a reset link within its TTL. This breaks sad.md:716 ("passwords, session tokens and link tokens are never logged") and `tasks/t15-invitation-routes.md:42`.
- Z3 (stage-2, low, *Document*). The T50 DoD says "no API response body outside the error envelope for any 4xx/5xx". Two Fastify transport paths still answer with Fastify's own body:
  - `return503OnClosing` answers 503 during graceful shutdown;
  - the default `clientErrorHandler` answers 400 / 408 / 431 at the socket level, e.g. when the headers are too large.

  503, 408 and 431 are in neither openapi nor `ErrorCode`. The client already falls back to `INTERNAL_ERROR` (`apps/web/src/shared/api/client.ts:62-67`).

## Acceptance criteria

None of these findings maps to a §5 AC. They enforce sad.md:716 (logging), CLAUDE.md §Telegram/§Errors ("secrets — never logged") and the openapi `ErrorEnvelope` contract.

**Fallback:** read [sad.md](../sad.md) · [openapi.yaml](../contracts/openapi.yaml) · [CLAUDE.md](../../../../CLAUDE.md) in full when unsure. Do not guess.

## Checklist

- [x] `platform/logger.ts`: a `req` serializer that logs `method`, a masked `url`, and the remote address / host, as Fastify's default does. The segment after `/invite/` and `/reset-password/` becomes e.g. `[redacted]`, and the query string is kept. Keep every existing `REDACT` path.
- [x] Router-level errors must not carry the raw path. Either:
  - log a fixed message / the error `code` instead of `err.message` for `FST_ERR_BAD_URL` / `FST_ERR_MAX_PARAM_LENGTH`; or
  - mask `err.message` through the same masking helper.

  The 400 response for those two codes answers a fixed message (e.g. `Invalid request URL`), not Fastify's text with the path in it.
- [x] Tests:
  - unit (`logger.test.ts`): the masking helper / serializer masks `/invite/<t>`, `/reset-password/<t>` and `/invite/<t>?x=1`, and leaves other URLs unchanged;
  - integration (`app.int.test.ts`, with `WEB_DIST_DIR` set and the log captured to a stream at info level): `GET /invite/<t>` and `GET /reset-password/<t>`, plus a malformed variant (`/reset-password/<t>%E0%A4%A`). No captured log line contains `<t>`, and the malformed response body does not contain `<t>` either.
- [x] Z3 docs:
  - `contracts/api-sync-report.md`: add an entry listing the transport-level exceptions (503 from `return503OnClosing` during shutdown; 400/408/431 from Fastify's `clientErrorHandler` at the socket level). Say that they are outside the envelope by design and that the web client maps an unparseable body to `INTERNAL_ERROR`.
  - Narrow the T50 DoD wording (task file + `tasks.json` `dod`) to "router and handler paths".

## Edge cases

| Case | Behaviour |
|---|---|
| `GET /invite/<t>` (SPA served) | Logged url `/invite/[redacted]` |
| `GET /reset-password/<t>%E0%A4%A` | 400 VALIDATION_ERROR envelope; neither the log nor the body contains `<t>` |
| `GET /api/workspaces/<id>` | Logged url unchanged |
| Token in a JSON body (`/api/invitations/accept`) | Still redacted by `*.token` (unchanged) |

## Definition of Done

- [x] No log line written by the API contains an invitation or reset token
- [x] The transport-level exceptions are documented and the T50 DoD no longer claims more than the code does
- [x] Unit + integration green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [x] the regression test for each closed finding fails without the fix (RED first)
