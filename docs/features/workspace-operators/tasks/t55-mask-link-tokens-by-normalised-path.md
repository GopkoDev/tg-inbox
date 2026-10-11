---
id: T55
title: "Mask link tokens by a normalised path, not a pattern"
layer: "infra"
deps: []
blocks: []
acs: []
files_hint: ["apps/api/src/platform/logger.ts", "apps/api/src/platform/logger.test.ts", "docs/features/workspace-operators/contracts/api-sync-report.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r7"
status: "todo"
---

# T55 — Mask link tokens by a normalised path, not a pattern

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r7.md](../_review/review-2026-10-11-r7.md) (AB1, *Fix now*). The finding number below is that record's.

## Review findings this task closes

- AB1 (stage-2, low). `LINK_TOKEN_PATH` (`platform/logger.ts:19`) still misses link forms the SPA serves: `GET /invite//<t>` (the regex needs a non-`/` character right after the prefix) and `GET /%69nvite/<t>` (React Router decodes each segment before matching, so the invitation page opens and the raw token is logged). Raw-client dot segments (`/./invite/<t>`, `/x/../invite/<t>`) are unmasked too. The T54 DoD claims "whatever the path's case or slashes".

## Acceptance criteria

None of these findings maps to a §5 AC. They enforce sad.md:716 ("link tokens are never logged"), CLAUDE.md ("secrets — never logged") and the T54 DoD.

**Fallback:** read [sad.md](../sad.md) · [T54](./t54-harden-link-token-log-masking.md) · [CLAUDE.md](../../../../CLAUDE.md) in full when unsure. Do not guess.

## Checklist

- [ ] `platform/logger.ts`: rewrite `maskLinkTokens` to work on a normalised path instead of a regex over the raw url. Split off the query; split the path on `/` (and on a decoded `%2F`); percent-decode each segment in a try/catch (an undecodable segment stays raw); drop empty and `.` segments and resolve `..`. When the first resulting segment equals `invite` or `reset-password` ignoring case and a further segment exists, log `/<prefix as sent>/[redacted]` plus the original query. Any other url is returned unchanged.
- [ ] The canonical form keeps its current output (`/invite/tok?x=1` → `/invite/[redacted]?x=1`). Non-canonical forms may log a normalised prefix; update the existing T54 unit expectations accordingly.
- [ ] Add an api-sync-report line for this change (no operation, status or code changes).
- [ ] Tests (unit, `logger.test.ts`): `/invite//<t>`, `/%69nvite/<t>`, `/%49NVITE/<t>`, `/./invite/<t>`, `/x/../invite/<t>`, `/reset-password//<t>`, plus every existing case. Unchanged: `/assets/invite/x.js`, `/invite`, `/invite/`, `/invitex/<t>`, `/`, `/api/health`, an undecodable `/%E0%A4%A`.
- [ ] RED proof: the new cases fail against the current regex.

## Edge cases

| Case | Behaviour |
|---|---|
| `/invite//<t>`, `/%69nvite/<t>`, `/./invite/<t>`, `/x/../invite/<t>` | No `<t>` in the logged url |
| `/invite/<t>?x=1` | `/invite/[redacted]?x=1` (unchanged from T54) |
| `/assets/invite/x.js`, `/invitex/<t>`, `/invite`, `/invite/` | Unchanged |
| Undecodable segment | Kept raw; no throw from the serializer |

## Definition of Done

- [ ] No `incoming request` line contains an invitation or reset token for any path the SPA router would resolve to `/invite/:token` or `/reset-password/:token`, nor for dot-segment variants
- [ ] The serializer never throws on a malformed url
- [ ] Unit + integration green; `pnpm lint` clean
- [ ] every Hard Rule in CLAUDE.md still holds
