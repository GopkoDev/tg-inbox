---
id: T49
title: "Key the access-removed notice by workspace and ignore guard refusals from a page the person has left"
layer: "ui"
deps: []
blocks: []
acs: ["AC-17", "AC-13"]
files_hint: ["apps/web/src/features/workspaces/store.ts", "apps/web/src/shared/api/guard.ts", "apps/web/src/shared/api/guard.test.ts", "apps/web/src/shared/ui/app-shell.tsx", "apps/web/src/shared/ui/app-shell.test.tsx", "apps/web/src/features/workspaces/useWorkspaceFromUrl.ts", "apps/web/src/features/workspaces/picker/WorkspacePicker.tsx", "apps/web/src/pages/NoAccessPage.tsx", "apps/web/src/pages/NoAccessPage.test.tsx", "apps/web/src/pages/TeamPage.test.tsx", "apps/web/src/pages/WorkspacesPage.test.tsx", "apps/web/src/pages/WorkspaceHomePage.test.tsx"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r4"
status: "todo"
---

# T49 — Key the access-removed notice by workspace and ignore guard refusals from a page the person has left

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r4.md](../_review/review-2026-10-11-r4.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- X1 (stage-2, low; regression of T46) — `shared/api/guard.ts:41`: the `!ws.accessRemovedNotice` condition keeps *any* notice still in the store, not only the one for the workspace being retried. Example: the operator loses access to "Acme" and does not dismiss the banner. They then open "Cozy", which they were also removed from but never entered. The banner keeps saying "Acme", and the removal from Cozy is never shown. The notice is cleared only by Dismiss or `clear()` (`features/workspaces/store.ts:24-26`). The Retry tests (`pages/TeamPage.test.tsx:247-269`) cover only the same-workspace case.
- X2 (stage-2, low; pre-existing) — `shared/ui/app-shell.tsx:38-48`: `shellGuard` always calls `guard(error, id)`, and `useTeam.run` does not check whether the page is still live (`features/workspaces/team/useTeam.ts:136-146`). So a late `ACCESS_REMOVED` for w1, arriving after the person has moved to w2, still sets the notice and runs the AC-07 resolution:
  - when w2 is SCR-10, a "this workspace" banner appears over it;
  - when w2 has been entered, the operator is moved from `/w/w2/team` to `/w/w2`.

  The late-failure test (`pages/TeamPage.test.tsx:271-293`) passes only because its mocked resolution rejects.

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

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [ ] Store: the notice carries the workspace it is about (e.g. `{ workspaceId, name }`), and every reader (shell, picker, no-access page) still shows the name.
- [ ] Guard: with nothing entered, keep an existing notice only when it is for the same workspace id (the Retry case). A refusal for a different workspace replaces it.
- [ ] Shell: `shellGuard` ignores a refusal for an id that is not the shell's current URL workspace. It does not call `guard`, so there is no notice, no resolution and no navigation, and it does not mark an error.
- [ ] Tests:
  - a removal from a second, never-entered workspace while an older notice is still shown names "this workspace", not the old name;
  - a late 403 from w1 after moving to w2 (both the SCR-10 case and the entered case) shows no notice and does not navigate;
  - the existing Retry tests still keep "Acme Flowers".

## Edge cases

| Case | Behaviour |
|---|---|
| Retry after a failed resolution, same workspace | Notice still names it |
| Older notice for A, refusal for never-entered B | Notice for B ("this workspace") |
| Late 403 for w1 after moving to w2 | Ignored: no notice, no navigation, no error row |

## Definition of Done

- [ ] The notice always names the workspace whose refusal produced it
- [ ] A refusal from a page the person has left has no visible effect
- [ ] Web unit tests green; `pnpm lint` clean
- [ ] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [ ] the regression test for each closed finding fails without the fix (RED first)
