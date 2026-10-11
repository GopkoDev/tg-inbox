---
id: T43
title: "Render page bodies only after the shell entered the workspace; fit SCR-10 inside the shell"
layer: "ui"
deps: []
blocks: []
acs: ["AC-17", "AC-13"]
files_hint: ["apps/web/src/shared/ui/app-shell.tsx", "apps/web/src/shared/ui/app-shell.test.tsx", "apps/web/src/features/workspaces/useWorkspaceFromUrl.ts", "apps/web/src/pages/NotFoundPage.tsx", "apps/web/src/pages/TeamPage.test.tsx", "apps/web/src/pages/WorkspaceHomePage.test.tsx", "docs/design-system.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r2"
status: "done"
---

# T43 — Render page bodies only after the shell entered the workspace; fit SCR-10 inside the shell

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r2.md](../_review/review-2026-10-11-r2.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- R8 (stage-2, low) — `app-shell.tsx:128-129` renders `children` while the entry is `entering`: after a Team call gets 403 `ACCESS_REMOVED` the guard clears `current`, the shell drops to `entering` but `useTeam`'s member list stays visible until resolution finishes (indefinitely if it fails) — AC-17 says the panel removes the workspace's data at the first refusal; on a direct `/w/<id>/team` load Team's list calls race the entry, so a 401/403 is handled twice (two resolutions, two navigations) (`useWorkspaceFromUrl.ts:56-57`, `team/useTeam.ts:61`).
- R9 (stage-2, low) — the shell-level SCR-10 (`app-shell.tsx:115-116`) uses the full-page `NotFoundPage` (`<main>` with `min-h-svh`, `NotFoundPage.tsx:46`) under the header, making the page taller than the viewport.
- R11 (stage-2, low) — `docs/design-system.md:12` still describes AppShell as a frame + guard wiring; it now enters the URL's workspace and renders the SCR-10 / Retry slots.

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

- [x] Render `children` only when the entry status is `ready`; show the body skeleton while entering. One guard call per entry on a direct load.
- [x] Shell-level SCR-10: `<main className="p-4"><NotFoundCard headingLevel={1} /></main>` (or equivalent) — one `main`, one `h1`, no `min-h-svh` inside the shell.
- [x] Update the AppShell row in docs/design-system.md (entry responsibility, not-found and error/Retry slots).
- [x] Tests: a 403 `ACCESS_REMOVED` on a Team action removes the member rows before `resolveWorkspaces` resolves; a direct Team load with a 403 calls the guard once; the shell-level 404 has one `main`, one `h1` and no `min-h-svh` class.

## Edge cases

| Case | Behaviour |
|---|---|
| 403 on deactivate, resolution slow | Rows gone immediately, skeleton shown |
| Direct load, entry 404 | SCR-10 inside the shell, Team never requested |

## Definition of Done

- [x] No workspace data visible while not entered
- [x] Web unit tests green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [x] the regression test for each closed finding fails without the fix (RED first)
