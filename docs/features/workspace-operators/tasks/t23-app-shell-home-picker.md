---
id: T23
title: "Build the AppShell, SCR-06 workspace home and SCR-04 picker / switcher"
layer: "ui"
deps: ["T20"]
blocks: ["T24"]
acs: ["AC-11", "AC-12", "AC-15", "AC-17"]
files_hint: ["apps/web/src/shared/ui/app-shell.tsx", "apps/web/src/features/workspaces/picker/", "apps/web/src/features/workspaces/home/", "apps/web/src/pages/WorkspacesPage.tsx", "apps/web/src/pages/WorkspaceHomePage.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T23 — Build the AppShell, SCR-06 workspace home and SCR-04 picker / switcher

## Place in the sequence

- **Blocked by:** T20 — Build SCR-01 sign-in, the workspace resolution, SCR-05 no access and SCR-10 not found · **Blocks:** T24 — Build SCR-07 team screen (sits inside the AppShell) · **Wave:** 4, parallel with T21.
- **Lane:** own lane. Replaces T20's stubs `WorkspacesPage` and `WorkspaceHomePage`; does **not** touch `routes.tsx`.

## Why (user story)

> **As an** Operator
> **I want** to switch between the workspaces I am a member of
> **So that** I can work for several businesses with one account while seeing only one business's data at a time
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to sign in to the web panel with my email and password and sign out when I am done
> **So that** only I can act in the workspaces I belong to
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

This task delivers the workspace area frame (header, switcher, sign-out), the workspace home and the picker.

## Inlined context

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` […]. Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> | AppShell | The workspace area needs one header shared by SCR-06/07/08 — workspace switcher, role-dependent **Team** link, account menu with sign-out, collapsing into a menu at phone width — and the slot for the `access-removed` notice; shadcn/ui ships no app-layout primitive, and repeating the header per screen would let the owner-only Team entry drift. Composes shadcn:dropdown-menu, Button, shadcn:alert. Lives in `apps/web/src/shared/ui/app-shell.tsx`. |
>
> — `screens.md §New components, AppShell, verbatim` · full text: [screens.md](../screens.md)

> The last-used workspace for the next sign-in (AC-07, AC-12) is recorded on the membership when the panel opens a workspace, not in the session.
>
> — `adr/0003-carry-the-active-workspace-in-the-url-and-check-membership-on-every-request.md §Decision outcome, verbatim` · full text: [ADR-0003](../adr/0003-carry-the-active-workspace-in-the-url-and-check-membership-on-every-request.md)

**SCR-06 — Workspace home** (states to build):

> | State | Trigger / condition | Components |
> |---|---|---|
> | loading | Opening `/w/<workspaceId>` — `enterWorkspace` in flight; the header shows a name skeleton | NEW: AppShell, shadcn:skeleton |
> | default: owner | `enterWorkspace` 200, `role: owner` — header: workspace switcher (SCR-04 menu), **Team** link, account menu (email, **Sign out**); body: placeholder «Your inbox arrives here» (roadmap step 4) | NEW: AppShell, shadcn:dropdown-menu, Button, Card |
> | default: operator | `role: operator` — the same, **without** the Team link | NEW: AppShell, shadcn:dropdown-menu, Card |
> | access-removed | Arrived through the shared `403 ACCESS_REMOVED` handler — dismissible notice «Your access to Acme Flowers was removed» under the header | shadcn:alert (default) |
> | guard states | `401` / `403 ACCESS_REMOVED` / `404` on `enterWorkspace` → shared guard table | — |
> | error: unexpected | network failure / `500` on `enterWorkspace` — «Something went wrong» + Retry in the body | shadcn:alert (destructive), Button |
>
> — `screens.md §SCR-06, state table, abridged` · full text: [screens.md](../screens.md)

**SCR-04 — Workspace picker** (states to build):

> | State | Trigger / condition | Components |
> |---|---|---|
> | loading | `listMyWorkspaces` in flight | Card, shadcn:skeleton |
> | default: page | Several active workspaces and no usable last-used one — full page at `/workspaces`, one row per workspace: name + role badge | Card, Button (`variant="ghost"`, full-width row), shadcn:badge |
> | default: switcher | Opened from the workspace header on SCR-06/SCR-07 — the same list as a menu, the current workspace checked | shadcn:dropdown-menu, shadcn:badge |
> | access-removed | Arrived through the shared `403 ACCESS_REMOVED` handler — notice «Your access to Acme Flowers was removed» above the list | shadcn:alert (default) |
> | entering | A workspace was picked — `enterWorkspace` in flight, the picked row shows a spinner, others disabled | Button (disabled + `Loader2`) |
> | error: pick refused | `enterWorkspace` → `404` or `403 ACCESS_REMOVED` for the picked workspace — reload the list and show «That workspace is no longer available» | shadcn:alert (destructive) |
> | error: unexpected | network failure / `500` on the list — «Something went wrong» + Retry | shadcn:alert (destructive), Button |
> | has-more | `has_next: true` — fetched with `limit=100`; **Show more** fetches the next page with `after=next_cursor` | Button (`variant="outline"`) |
> | success | `enterWorkspace` 200 → SCR-06 of the picked workspace | — (navigation) |
>
> — `screens.md §SCR-04, state table, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Consumed (authored by T13/T14):

- `POST /api/workspaces/{workspaceId}/enter` (`enterWorkspace`) → `200 WorkspaceSummary { id, name, role }` · errors: `401`, `403 ACCESS_REMOVED`, `404 NOT_FOUND`.
- `GET /api/me/workspaces` (`listMyWorkspaces`) — `after`, `limit` → `200 WorkspaceSummaryPage` · `401`.
- `POST /api/auth/sign-out` (`signOut`) → `204` always, cookie cleared.

— `contracts/openapi.yaml, operationId enterWorkspace / listMyWorkspaces / signOut, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-11 — happy path

> **Given** a signed-in operator
> **When** they sign out
> **Then** their session ends on that device and opening the web panel again asks them to sign in
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — happy path

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently working in "Acme Flowers"
> **When** they switch to "Bolt Bikes"
> **Then** on that device the panel shows only "Bolt Bikes" data from then on, while their other signed-in devices stay in the workspace they were in; their next sign-in on any device opens "Bolt Bikes"
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — authorization

> **Given** an operator of "Acme Flowers" who is not a business owner
> **When** they try to invite someone or manage the team
> **Then** the system refuses and tells them that only business owners manage the team
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — cross-context

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently signed in to "Acme Flowers"
> **When** a business owner of "Acme Flowers" deactivates their membership
> **Then** from at most 5 seconds after the deactivation, every action or data load the operator makes in "Acme Flowers" is refused; at the first such refusal the panel removes "Acme Flowers" data from the screen and tells them their access to "Acme Flowers" was removed, then moves them to another workspace where they are active (or to the no-access screen of AC-10 when there is none); their account and their access to "Bolt Bikes" stay intact
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `apps/web/src/shared/ui/app-shell.tsx`: header (switcher slot, Team link only for `role: owner`, account menu with email + Sign out), phone collapse into a ☰ menu, `access-removed` notice slot (dismissible); composes dropdown-menu, Button, alert.
- [ ] `apps/web/src/features/workspaces/picker/`: shared list (page + switcher variants), entering state, pick-refused reload, Show more paging.
- [ ] `apps/web/src/features/workspaces/home/` + `apps/web/src/pages/WorkspaceHomePage.tsx`: `enterWorkspace` on open, store the workspace, placeholder body; on switch drop the previous workspace's store data before routing to `/w/<newId>`.
- [ ] `apps/web/src/pages/WorkspacesPage.tsx`: SCR-04 page variant with «Signed in as …» + Sign out.
- [ ] Sign out (AppShell, picker): `signOut` → clear stores → `/sign-in`.
- [ ] Tests: `app-shell.test.tsx` (Team link owner-only, phone menu), `WorkspaceHomePage.test.tsx`, `WorkspacesPage.test.tsx`, switcher test (switch clears old data, calls `enterWorkspace`).

## Edge cases

| Case | Behaviour |
|---|---|
| Operator role | No Team entry anywhere in the shell (desktop or phone menu) |
| Picked workspace removed meanwhile | List reloads, alert «That workspace is no longer available» |
| `403 ACCESS_REMOVED` on `enterWorkspace` | Shared guard handler: data cleared, resolution re-run, notice shown on the landing screen |
| Switching workspace | Old workspace data removed from stores before the new one renders; other devices untouched (URL-scoped) |
| More than 100 workspaces | **Show more** with `after=next_cursor` |
| Sign-out with an already-ended session | `204` anyway → sign-in screen |

## Definition of Done

- [ ] `app-shell.test.tsx` proves the Team link renders only for owners (AC-15 UI half).
- [ ] Switcher test proves only the new workspace's data is shown after a switch and `enterWorkspace` was called (AC-12).
- [ ] Sign-out test proves stores are cleared and the sign-in screen is shown (AC-11).
- [ ] Each SCR-04 and SCR-06 state above has a test.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
