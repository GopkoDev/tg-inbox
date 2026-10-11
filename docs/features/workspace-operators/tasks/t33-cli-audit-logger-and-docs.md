---
id: T33
title: "Route the CLI audit through the platform logger, fix the admin script, update the architecture map"
layer: "wiring"
deps: []
blocks: []
acs: ["AC-01", "AC-01b", "AC-21"]
files_hint: ["apps/api/src/cli/io.ts", "apps/api/src/cli/io.test.ts", "apps/api/src/cli/admin.ts", "apps/api/src/cli/admin.int.test.ts", "apps/api/package.json", "docs/architecture-map.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11"
status: "done"
---

# T33 — Route the CLI audit through the platform logger, fix the admin script, update the architecture map

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11.md](../_review/review-2026-10-11.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- #5 (stage-1) — the CLI audit line is hand-built JSON on stderr (`cli/io.ts:23-30`), bypassing `platform/logger.ts` (redaction, level), against contracts/cli.md:29 ("structured pino line … through `platform/logger.ts`").
- #12 (stage-2, low) — `"admin": "tsx src/cli/admin.ts"` (`apps/api/package.json:10`) has no `--conditions=development` (the `dev` script does), so it validates with a stale `packages/shared/dist`; it also needs devDependency `tsx`, so there is no production entry.
- #6 (stage-1) — `docs/architecture-map.md:72` still lists `auth` / `workspaces` as *(future)* modules.

## Acceptance criteria

### AC-01 — happy path

> **Given** a platform admin and a pilot business named "Acme Flowers" together with its owner's email address
> **When** the platform admin creates the workspace with that name and owner email
> **Then** the workspace exists, awaiting its first business owner, with an invitation carrying the business owner role issued for that email, and the platform admin sees the invitation link once, right after creation, to pass on; until that invitation is accepted nobody can see or act in the workspace
>
> — `spec.md §5, AC-01 (US-01), verbatim` · full text: [spec.md](../spec.md)

### AC-01b — happy path

> **Given** a workspace still awaiting its first business owner, whose owner invitation has expired or whose link was lost
> **When** a platform admin re-issues the first business owner invitation for that workspace
> **Then** the earlier invitation stops working, a new 7-day invitation with the business owner role is issued for the same email, and the platform admin sees its link once, right after issuing it
>
> — `spec.md §5, AC-01b (US-01), verbatim` · full text: [spec.md](../spec.md)

### AC-21 — happy path

> **Given** a person who forgot the password of their account and asked the tg-inbox team for help
> **When** a platform admin issues a password-reset link for that account and the person sets a new valid password through it
> **Then** the person is signed in on that device with the new password, every other session of that account ends, the failure count of AC-09 is cleared, and the link cannot be used again; the platform admin sees the link once, right after issuing it, and issuing a new reset link for the same account makes any earlier unused one stop working
>
> — `spec.md §5, AC-21 (US-08), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [x] Build the audit logger with `pino(loggerOptions(config))` (from `platform/logger.ts`) writing to stderr (fd 2); keep the audit fields (ids only, never a token or link); stdout keeps carrying only the command result.
- [x] `admin` script → `tsx --conditions=development src/cli/admin.ts`; add `admin:prod` (or document) `node dist/cli/admin.js`, and make sure `tsconfig.build.json` emits the CLI.
- [x] architecture-map: add `auth` and `workspaces` module rows (path, layers, registered in `app.ts`, tables owned — see data-model.md) and remove them from the *(future)* row.
- [x] Tests: the audit line is valid pino JSON on stderr with the expected fields and contains no link/token.

## Edge cases

| Case | Behaviour |
|---|---|
| Audit with a link in the result | Link on stdout only, never in the stderr audit line |

## Definition of Done

- [x] CLI audit uses the platform logger
- [x] `pnpm admin --help` works with fresh shared sources
- [x] architecture-map reflects the two modules
- [x] Unit + integration green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [x] the regression test for each closed finding fails without the fix (RED first)
