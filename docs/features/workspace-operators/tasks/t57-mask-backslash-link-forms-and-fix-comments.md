---
id: T57
title: "Mask backslash link forms; state which forms no router resolves"
layer: "infra"
deps: []
blocks: []
acs: []
files_hint: ["apps/api/src/platform/logger.ts", "apps/api/src/platform/logger.test.ts", "docs/features/workspace-operators/contracts/api-sync-report.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r9"
status: "done"
---

# T57 — Mask backslash link forms; state which forms no router resolves

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r9.md](../_review/review-2026-10-11-r9.md) (AD1, AD2, *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- AD1 (stage-2, low). The comments at `platform/logger.ts:20-21` and `logger.test.ts:19-20` call `//` and `%2F` "forms only a raw client sends". A browser sends them as typed; what sets them apart is that no router resolves them. Only dot segments and `\` are forms a browser never sends.
- AD2 (stage-2, low). `maskLinkTokens` splits only on `/` and `%2f` (`platform/logger.ts:41`), so `GET /invite\<t>` from a raw client logs the token verbatim.

## Acceptance criteria

None of these findings maps to a §5 AC. They enforce sad.md:716 ("link tokens are never logged") and CLAUDE.md ("secrets — never logged").

**Fallback:** read [sad.md](../sad.md) · [T56](./t56-mask-absolute-form-and-trailing-dot-segments.md) · [CLAUDE.md](../../../../CLAUDE.md) in full when unsure. Do not guess.

## Checklist

- [x] `platform/logger.ts`: split the path on `\` as well as `/` and `%2f` (any case).
- [x] Reword the comments at `logger.ts:20-21` and `logger.test.ts:19-20`: the superset is every form the SPA router or Fastify resolves to a link route, plus forms no router resolves but a client may still send (`//`, `%2F`, `\`, `.` / `..` segments).
- [x] Add an api-sync-report line for this change (no operation, status or code changes).
- [x] Tests (unit, `logger.test.ts`): `/invite\<t>`, `\invite\<t>`, `/reset-password\<t>`, plus every existing case.
- [x] RED proof: the new masked cases fail against the current `maskLinkTokens`.

## Edge cases

| Case | Behaviour |
|---|---|
| `/invite\<t>`, `\invite\<t>`, `/reset-password\<t>` | No `<t>` in the logged url |
| Every case pinned by T54–T56 | Unchanged behaviour |
| Undecodable segment | Kept raw; no throw from the serializer |

## Definition of Done

- [x] No `incoming request` line contains an invitation or reset token for a backslash-separated link form
- [x] The mask's comments state which forms a router resolves and which only a client may send
- [x] The serializer never throws on a malformed url
- [x] Unit + integration green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds
