---
id: T56
title: "Mask link tokens in absolute-form and trailing-dot-segment urls; fix the mask's comments"
layer: "infra"
deps: []
blocks: []
acs: []
files_hint: ["apps/api/src/platform/logger.ts", "apps/api/src/platform/logger.test.ts", "docs/features/workspace-operators/contracts/api-sync-report.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r8"
status: "done"
---

# T56 — Mask link tokens in absolute-form and trailing-dot-segment urls; fix the mask's comments

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r8.md](../_review/review-2026-10-11-r8.md) (AC1, AC2, *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- AC1 (stage-2, low). `maskLinkTokens` (`platform/logger.ts:33-44`) logs the raw token for (a) an absolute-form request target — `GET http://host/invite/tok` is routed by find-my-way to `/invite/:token`, but the mask sees `http:` as the first segment — and (b) a `..` after the token, which pops it before the check (`/invite/tok/..`, `/invite/tok/%2e%2e`, `/invite/tok%2F..`, `/invite/%2e%2e/tok`).
- AC2 (stage-2, low). The comments at `platform/logger.ts:18-20` and `logger.test.ts:18-20` say `//`, `%2F` and dot segments "all reach the same page" via the SPA router. React Router sends `//invite/t`, `/invite//t` and `/invite%2Ft` to `*`; dot segments are resolved by the browser.

## Acceptance criteria

None of these findings maps to a §5 AC. They enforce sad.md:716 ("link tokens are never logged") and CLAUDE.md ("secrets — never logged").

**Fallback:** read [sad.md](../sad.md) · [T55](./t55-mask-link-tokens-by-normalised-path.md) · [CLAUDE.md](../../../../CLAUDE.md) in full when unsure. Do not guess.

## Checklist

- [x] `platform/logger.ts`: before splitting, strip a leading `scheme://authority` (`^[a-z][a-z0-9+.-]*:\/\/[^/?]*`, any case) from the path.
- [x] `platform/logger.ts`: during the segment walk, mask whatever follows as soon as the normalised segments are exactly `[linkPrefix]` (prefix ignoring case) — a `[linkPrefix, x]` check would miss `/invite/%2e%2e/<t>`, where that state never occurs. Output stays `/<prefix as sent>/[redacted]` plus the original query.
- [x] Reword the comments at `logger.ts:18-20` and `logger.test.ts:18-20`: the mask covers a superset on purpose — every form the router or Fastify resolves to a link route, plus forms a raw client might send.
- [x] Add an api-sync-report line for this change (no operation, status or code changes).
- [x] Tests (unit, `logger.test.ts`): `http://host/invite/<t>`, `HTTP://host/Invite/<t>?x=1`, `http://host/reset-password/<t>`, `/invite/<t>/..`, `/invite/<t>/%2e%2e`, `/invite/<t>%2F..`, `/invite/%2e%2e/<t>`, plus every existing case. Unchanged: `http://host/assets/invite/x.js`, `http://host/`, and every existing unchanged case.
- [x] RED proof: the new masked cases fail against the current `maskLinkTokens`.

## Edge cases

| Case | Behaviour |
|---|---|
| `http://host/invite/<t>`, `HTTP://host/Invite/<t>?x=1` | No `<t>` in the logged url |
| `/invite/<t>/..`, `/invite/<t>%2F..`, `/invite/%2e%2e/<t>` | No `<t>` in the logged url |
| `/invite/<t>?x=1` | `/invite/[redacted]?x=1` (unchanged) |
| `http://host/assets/invite/x.js`, `/invitex/<t>`, `/invite`, `/invite/` | Unchanged |
| Undecodable segment | Kept raw; no throw from the serializer |

## Definition of Done

- [x] No `incoming request` line contains an invitation or reset token for any path the SPA router or Fastify would resolve to a link route (including absolute-form targets), nor for any url whose normalisation reaches `[linkPrefix]` before a further segment
- [x] The mask's comments state its real scope
- [x] The serializer never throws on a malformed url
- [x] Unit + integration green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds
