---
id: T58
title: "Mask encoded-backslash (`%5C`) link forms"
layer: "infra"
deps: []
blocks: []
acs: []
files_hint: ["apps/api/src/platform/logger.ts", "apps/api/src/platform/logger.test.ts", "docs/features/workspace-operators/contracts/api-sync-report.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r10"
status: "todo"
---

# T58 — Mask encoded-backslash (`%5C`) link forms

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r10.md](../_review/review-2026-10-11-r10.md) (AE1, *Fix now*). The finding number below is that record's.

## Review findings this task closes

- AE1 (stage-2, low). `maskLinkTokens` splits on `/`, `\` and `%2f` but not on `%5c` (`platform/logger.ts:40`), so `GET /invite%5C<t>` logs the token verbatim. A browser sends `%5C` as typed; no router resolves it.

## Acceptance criteria

None of these findings maps to a §5 AC. They enforce sad.md:716 ("link tokens are never logged") and CLAUDE.md ("secrets — never logged").

**Fallback:** read [sad.md](../sad.md) · [T57](./t57-mask-backslash-link-forms-and-fix-comments.md) · [CLAUDE.md](../../../../CLAUDE.md) in full when unsure. Do not guess.

## Checklist

- [ ] `platform/logger.ts`: split the path on `%5c` (any case) as well as `/`, `\` and `%2f`.
- [ ] Mention `%5C` next to `\` in the comments at `logger.ts:20-21` and `logger.test.ts:19-20`.
- [ ] Add an api-sync-report line for this change (no operation, status or code changes).
- [ ] Tests (unit, `logger.test.ts`): `/invite%5Ctok123`, `/invite%5ctok123`, `/reset-password%5Ctok123`, plus every existing case.
- [ ] RED proof: the new masked cases fail against the current `maskLinkTokens`.

## Edge cases

| Case | Behaviour |
|---|---|
| `/invite%5C<t>`, `/invite%5c<t>`, `/reset-password%5C<t>` | No `<t>` in the logged url |
| Every case pinned by T54–T57 | Unchanged behaviour |
| Undecodable segment | Kept raw; no throw from the serializer |

## Definition of Done

- [ ] No `incoming request` line contains an invitation or reset token for a link form separated by `\` or `%5C`
- [ ] The mask's comments list `%5C` among the forms no router resolves
- [ ] The serializer never throws on a malformed url
- [ ] Unit + integration green; `pnpm lint` clean
- [ ] every Hard Rule in CLAUDE.md still holds
