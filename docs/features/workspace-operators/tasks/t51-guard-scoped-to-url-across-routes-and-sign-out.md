---
id: T51
title: "Scope the shell guard to the URL workspace across routes and sign-out"
layer: "ui"
deps: []
blocks: []
acs: ["AC-17", "AC-13"]
files_hint: ["apps/web/src/shared/ui/app-shell.tsx", "apps/web/src/features/workspaces/store.ts", "apps/web/src/features/workspaces/useWorkspaceFromUrl.ts", "apps/web/src/shared/api/guard.ts", "apps/web/src/pages/TeamPage.test.tsx", "apps/web/src/pages/WorkspaceHomePage.test.tsx", "apps/web/src/shared/ui/app-shell.test.tsx"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r5"
status: "todo"
---

# T51 — Scope the shell guard to the URL workspace across routes and sign-out

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r5.md](../_review/review-2026-10-11-r5.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- Z1 (stage-2, low; the remainder of X2 after T49) — `shared/ui/app-shell.tsx:37-40,46`. Each page renders its own `<AppShell>` (`pages/TeamPage.tsx:9`, `pages/WorkspaceHomePage.tsx:9`), and `/w/:id` and `/w/:id/team` are separate routes (`app/routes.tsx:19-20`). The switcher always navigates to `/w/${id}` (`features/workspaces/picker/useEnterWorkspace.ts:27`).
  - Going from `/w/w1/team` to `/w/w2` therefore unmounts the team shell, and its per-instance `urlRef` stays `'w1'`.
  - The pending `useTeam.run` (`features/workspaces/team/useTeam.ts:136-146`) still holds that unmounted shell's `shellGuard`. A late `ACCESS_REMOVED` for w1 passes the check at `app-shell.tsx:46` and runs the full guard.
    - When w2 is SCR-10, the notice "this workspace" appears over it and the operator is moved away.
    - When w2 has been entered, the AC-07 resolution still runs and can bounce the operator from `/w/w2/team` back to `/w/w2`.
  - Sign-out mid-action has the same cause. `clear()` runs first, and then the late refusal sets a "this workspace" notice that survives into the next session's landing screen.
  - The T49 tests (`pages/TeamPage.test.tsx:299-359`) move only within one route (`/w/w1/team` → `/w/w2/team`), so the shell instance is reused.

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

**Fallback:** if this is insufficient or contradicted by the code, read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [ ] One "workspace of the current address" value shared by every shell, not a per-instance ref. Suggested: a store field in `features/workspaces/store.ts`, set from the shell's (or `useWorkspaceFromUrl`'s) layout effect. On unmount, the shell resets it only if it still holds its own id, so the shell that mounts next is never overwritten. Reading the router location is also acceptable.
- [ ] `shellGuard` compares the refusal's id with that shared value. Once the shell for w1 is gone, or the person has signed out, a refusal for w1 has no effect: no notice, no resolution, no navigation, no error row.
- [ ] A refusal for the workspace still in the address keeps working on every route of that workspace. For example, an action started on `/w/w1/team` and refused after a move to `/w/w1` must still show the notice and resolve.
- [ ] Tests (render the real `WorkspaceHomePage` on `/w/:workspaceId` beside `TeamPage`):
  - a late 403 `ACCESS_REMOVED` for w1 after the switcher-style jump `/w/w1/team` → `/w/w2`, in the SCR-10 case: no notice, `resolveWorkspace` not called, the operator stays on `/w/w2`;
  - the same jump, in the entered-w2 case: no notice, no resolution, stays;
  - sign-out while the action is pending, then the late refusal: no notice left in the store;
  - a late 403 for w1 after `/w/w1/team` → `/w/w1`: notice + resolution still happen (AC-17);
  - the existing T49 same-route tests and the Retry tests stay green.

## Edge cases

| Case | Behaviour |
|---|---|
| `/w/w1/team` → `/w/w2` (different route), late 403 for w1 | Ignored |
| `/w/w1/team` → `/w/w1`, late 403 for w1 | Handled (notice + AC-07 resolution) |
| Sign-out mid-action, late 403 | Ignored; no notice survives |
| Same-route move `/w/w1/team` → `/w/w2/team` | Ignored (T49 behaviour kept) |

## Definition of Done

- [ ] A refusal for a workspace that is no longer in the address has no visible effect, whatever route the person moved to
- [ ] A refusal for the workspace in the address still runs AC-17 on every route of that workspace
- [ ] Web unit tests green; `pnpm lint` clean
- [ ] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [ ] the regression test for each closed finding fails without the fix (RED first)
