---
id: T46
title: "Show the shell's error row with Retry when the access-removed resolution fails; fix stale SCR-10 comments"
layer: "ui"
deps: []
blocks: []
acs: ["AC-17", "AC-13"]
files_hint: ["apps/web/src/shared/ui/app-shell.tsx", "apps/web/src/shared/ui/app-shell.test.tsx", "apps/web/src/features/workspaces/useWorkspaceFromUrl.ts", "apps/web/src/shared/api/guard.ts", "apps/web/src/features/workspaces/team/useTeam.ts", "apps/web/src/pages/TeamPage.test.tsx", "apps/web/src/pages/NotFoundPage.tsx"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r3"
status: "done"
---

# T46 — Show the shell's error row with Retry when the access-removed resolution fails; fix stale SCR-10 comments

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r3.md](../_review/review-2026-10-11-r3.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- W2 (stage-2, low) — the shell can hang on the body skeleton: a page call gets 403 `ACCESS_REMOVED`, the guard clears `current` (shell → `entering`), then the AC-07 resolution (`getMe` / `listMyWorkspaces`) fails on a network error or 500. The guard rethrows into `useTeam.fail`, which updates an unmounted hook; the entry effect (deps `[workspaceId, attempt]`) does not re-run and no `failure` is set, so the user sees the notice plus an endless skeleton with no Retry (`shared/ui/app-shell.tsx:132-136`, `features/workspaces/useWorkspaceFromUrl.ts:30-55`, `shared/api/guard.ts:36-46`, `features/workspaces/team/useTeam.ts:58-63`). screens.md:51: network failure / 500 → the screen's own error row (Retry).
- W4 (stage-2, low) — `pages/NotFoundPage.tsx:8` says `NotFoundPage` is used by the shell when the workspace is unknown (the shell now uses `NotFoundCard`); `:43` says `NotFoundCard` is an `h2` under the page's `h1` (the shell renders it with `h1`).

## Acceptance criteria

### AC-17 — cross-context

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently signed in to "Acme Flowers"
> **When** a business owner of "Acme Flowers" deactivates their membership
> **Then** from at most 5 seconds after the deactivation, every action or data load the operator makes in "Acme Flowers" is refused; at the first such refusal the panel removes "Acme Flowers" data from the screen and tells them their access to "Acme Flowers" was removed, then moves them to another workspace where they are active (or to the no-access screen of AC-10 when there is none); their account and their access to "Bolt Bikes" stay intact
>
> — `spec.md §5, AC-17 (US-06), verbatim` · full text: [spec.md](../spec.md)

### AC-13 — authorization

> **Given** an operator who has never been a member of the "Bolt Bikes" workspace (a deactivated former member is covered by AC-17)
> **When** they try to open anything belonging to "Bolt Bikes" (for example through a link a colleague shared)
> **Then** the system behaves as if it does not exist — no data, no hint that the workspace or the item exists
>
> — `spec.md §5, AC-13 (US-04), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [x] The shell wraps the guard it provides through `ShellGuardContext`: if the wrapped guard rejects after the current workspace was cleared (the resolution failed), set the shell's `failure = { id: workspaceId, kind: 'error' }` so the error row with **Retry** shows; Retry re-runs the entry.
- [x] Keep R8 intact: no workspace data visible while not entered; one guard call per direct load.
- [x] Reword the two SCR-10 comments in NotFoundPage.tsx to match the code.
- [x] Test: a 403 `ACCESS_REMOVED` on a Team action plus a rejecting `resolveWorkspace` (network error, and 500) shows «Something went wrong» and Retry; Retry with a resolving resolution lands on the next workspace.

## Edge cases

| Case | Behaviour |
|---|---|
| 403 then resolution 500 | Error row + Retry, no workspace data |
| 403 then resolution succeeds | Unchanged: notice + next workspace |

## Definition of Done

- [x] No reachable state leaves the shell on an endless skeleton
- [x] Web unit tests green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [x] the regression test for each closed finding fails without the fix (RED first)
