---
id: T54
title: "Harden link-token log masking (raw packets, non-canonical paths) and pin the URL-error message"
layer: "infra"
deps: []
blocks: []
acs: []
files_hint: ["apps/api/src/platform/logger.ts", "apps/api/src/platform/logger.test.ts", "apps/api/src/app.int.test.ts", ".env.example", "docs/features/workspace-operators/contracts/api-sync-report.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r6"
status: "done"
---

# T54 — Harden link-token log masking (raw packets, non-canonical paths) and pin the URL-error message

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r6.md](../_review/review-2026-10-11-r6.md) (AA2, AA3, AA4, all *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- AA2 (stage-2, low). At `LOG_LEVEL=trace`, Fastify's default `clientErrorHandler` logs the parser error with `err.rawPacket`: the raw request bytes, `GET /invite/<t>` included. Reproduced on 400 (invalid header character) and 431 (headers too large). T52 only documented this (`.env.example:7`, `contracts/api-sync-report.md:164`), and `sad.md:716` still says link tokens are "never logged".
- AA3 (stage-2, low). `LINK_TOKEN_PATH` (`platform/logger.ts:16`) matches only the exact lowercase, single-slash form. `GET /Invite/<t>`, `GET //invite/<t>` and `GET /invite%2F<t>` each return 200 `index.html` with the raw token in the `incoming request` line. React Router matches case-insensitively (`apps/web/src/app/routes.tsx:15-16`), so a hand-retyped `/INVITE/<t>` link works.
- AA4 (stage-2, low; a test gap). Dropping `FST_ERR_MAX_PARAM_LENGTH` from `URL_ERROR_CODES` (`platform/errors.ts:103`) leaves every api test green: the URL-error tests (`app.int.test.ts:55-75`) assert only `message: expect.any(String)`.

## Acceptance criteria

None of these findings maps to a §5 AC. They enforce sad.md:716 ("link tokens are never logged"), CLAUDE.md ("secrets — never logged") and the T52 DoD.

**Fallback:** read [sad.md](../sad.md) · [T52](./t52-link-tokens-out-of-request-logs.md) · [CLAUDE.md](../../../../CLAUDE.md) in full when unsure. Do not guess.

## Checklist

- [x] `platform/logger.ts`: add `'err.rawPacket'` to `REDACT`, keeping every existing path.
- [x] `platform/logger.ts`: widen the mask to any number of leading slashes, any letter case, and `/` or `%2F` after the prefix (e.g. `/^(\/+(?:invite|reset-password)(?:\/|%2f))[^/?]+/i`). `/assets/invite/x.js` and `/invite` stay unmasked.
- [x] Drop the trace-level exception from `.env.example` and the api-sync-report entry; add an api-sync-report line for this change.
- [x] Tests:
  - unit (`logger.test.ts`): mask cases for `/Invite/<t>`, `/INVITE/<t>`, `//invite/<t>`, `/invite%2F<t>`, `/Reset-Password/<t>`; `err.rawPacket` is in the redact list, and a pino logger built with `loggerOptions` writes `[Redacted]` for it;
  - integration (`app.int.test.ts`): both URL-error tests assert `message: 'Invalid request URL'` and that the body does not contain the param / path.
- [x] RED proof for each: the new cases fail without the change (AA4: with `FST_ERR_MAX_PARAM_LENGTH` removed from the set).

## Edge cases

| Case | Behaviour |
|---|---|
| `GET /INVITE/<t>` / `//invite/<t>` / `/invite%2F<t>` | Logged url has `[redacted]` in place of `<t>` |
| `/assets/invite/x.js` | Unchanged |
| Parser error at `trace` | `err.rawPacket` logs as `[Redacted]`; the rest of the error is kept |
| Path param over the max length | 400 `VALIDATION_ERROR`, message `Invalid request URL`, no path in the body |

## Definition of Done

- [x] No log line at any level contains an invitation or reset token, whatever the path's case or slashes
- [x] Both URL-error codes are pinned by a test that fails when either is dropped
- [x] Unit + integration green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds
