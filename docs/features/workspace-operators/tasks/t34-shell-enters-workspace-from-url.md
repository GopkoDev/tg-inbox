---
id: T34
title: "Make the app shell enter the workspace in the URL, guard late responses, keep the access-removed notice"
layer: "ui"
deps: []
blocks: ["T35", "T37"]
acs: ["AC-12", "AC-13", "AC-17"]
files_hint: ["apps/web/src/shared/ui/app-shell.tsx", "apps/web/src/shared/ui/app-shell.test.tsx", "apps/web/src/pages/TeamPage.tsx", "apps/web/src/pages/TeamPage.test.tsx", "apps/web/src/pages/WorkspaceHomePage.tsx", "apps/web/src/pages/WorkspaceHomePage.test.tsx", "apps/web/src/features/workspaces/home/WorkspaceHome.tsx", "apps/web/src/features/workspaces/picker/useEnterWorkspace.ts", "apps/web/src/features/workspaces/api.ts", "apps/web/src/features/workspaces/store.ts", "apps/web/src/features/auth/api.ts", "apps/web/src/features/auth/accept-invitation/AcceptInvitationForm.tsx", "apps/web/src/shared/api/guard.ts", "apps/web/src/shared/api/guard.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
source: "review-2026-10-11"
status: "todo"
---

# T34 — Make the app shell enter the workspace in the URL, guard late responses, keep the access-removed notice

## Place in the sequence

- **Blocked by:** — · **Blocks:** T35 — Guard Team 'Show more', render SCR-10 in place without nested landmarks, link the invite form errors, T37 — Exercise last-used workspace and direct Team loads in the browser flows
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11.md](../_review/review-2026-10-11.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- #13 (stage-2, high) — the Team page never enters its workspace (`pages/TeamPage.tsx:6-13`, `team/useTeam.ts:54-73`; only `WorkspaceHome.tsx:25-26` and `useEnterWorkspace.ts:25-26` call `setCurrent`). Opening `/w/<id>/team` directly (reload, shared link, 401 return) leaves `current` null — the switcher is a permanent skeleton; going `/w/A/team` → `/w/B/team` keeps A's name/role in the header while writes go to B, against ADR-0003. Tests hide it (`TeamPage.test.tsx:86` presets the store; `e2e/flows.spec.ts:11-16` routes through home on purpose).
- #14 (stage-2, medium) — the `ACCESS_REMOVED` notice is set only when `ws.current?.id === id` (`shared/api/guard.ts:35-41`); with `current` null the person is moved away silently, but AC-17 requires telling them their access was removed.
- #15 (stage-2, medium) — `WorkspaceHome.tsx:25-30,37-44`: the `live` flag guards only `setStatus`; `setCurrent` and `guard()` still run after unmount or a URL change, so a late response for A rewrites the header or redirects away from B.
- #17 (stage-2, medium) — the SCR-06 "guard 404" test (`pages/WorkspaceHomePage.test.tsx:100-105`) resolves on the always-present sr-only `<h1>` and passes even if NotFound never renders.
- #23 (stage-2, low) — duplicate `enterWorkspace` client in `features/auth/api.ts:30-31` (no `encodeURIComponent`) and a redundant second enter after accept (`AcceptInvitationForm.tsx:100`).

## Acceptance criteria

### AC-12 — happy path

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently working in "Acme Flowers"
> **When** they switch to "Bolt Bikes"
> **Then** on that device the panel shows only "Bolt Bikes" data from then on, while their other signed-in devices stay in the workspace they were in; their next sign-in on any device opens "Bolt Bikes"
>
> — `spec.md §5, AC-12 (US-04), verbatim` · full text: [spec.md](../spec.md)

### AC-13 — authorization

> **Given** an operator who has never been a member of the "Bolt Bikes" workspace (a deactivated former member is covered by AC-17)
> **When** they try to open anything belonging to "Bolt Bikes" (for example through a link a colleague shared)
> **Then** the system behaves as if it does not exist — no data, no hint that the workspace or the item exists
>
> — `spec.md §5, AC-13 (US-04), verbatim` · full text: [spec.md](../spec.md)

### AC-17 — cross-context

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently signed in to "Acme Flowers"
> **When** a business owner of "Acme Flowers" deactivates their membership
> **Then** from at most 5 seconds after the deactivation, every action or data load the operator makes in "Acme Flowers" is refused; at the first such refusal the panel removes "Acme Flowers" data from the screen and tells them their access to "Acme Flowers" was removed, then moves them to another workspace where they are active (or to the no-access screen of AC-10 when there is none); their account and their access to "Bolt Bikes" stay intact
>
> — `spec.md §5, AC-17 (US-06), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [ ] One place enters the workspace: the shell (or one shared hook used by every `/w/:workspaceId/*` page) calls `enterWorkspace(workspaceId)` whenever `current?.id !== workspaceId`, clearing the previous `current` first so the header never shows another workspace.
- [ ] Ignore late results: skip `setCurrent` and the guard call when the effect was cleaned up or the response id differs from the URL's `workspaceId` (cancellation flag or `AbortSignal`).
- [ ] `shared/api/guard.ts`: on 403 `ACCESS_REMOVED` with an unknown name, still set a notice — fall back to the server `message` (screens.md §Copy: show server messages) or a cached name from `listMyWorkspaces`.
- [ ] Delete the auth copy of `enterWorkspace`; after accept, navigate to `/w/<id>` and let the shell enter (no second call).
- [ ] Tests: TeamPage with an empty store renders the header name after entering; switching `/w/A/team` → `/w/B/team` shows B in the header; a late A response after moving to B changes nothing; 403 `ACCESS_REMOVED` with `current` null shows the notice; the SCR-06 404 test asserts `findByText('Page not found')` and the "Go to my workspace" button and that no workspace name is shown.

## Edge cases

| Case | Behaviour |
|---|---|
| Reload on `/w/<id>/team` | Header shows the workspace; switcher usable |
| Address change A → B | Header never shows A while B's data is visible |
| Deactivated member reloads a bookmark | Moved away and told access was removed |
| Late 403 for A after moving to B | Ignored |

## Definition of Done

- [ ] No `/w/:id/*` page can render with a header for another workspace
- [ ] AC-17 notice shown regardless of store state
- [ ] Web unit tests green; `pnpm lint` clean
- [ ] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [ ] the regression test for each closed finding fails without the fix (RED first)
