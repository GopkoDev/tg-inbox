---
id: T14
title: "Expose the workspace guard and the me / workspaces / enter routes"
layer: "ports"
deps: ["T11", "T13"]
blocks: ["T15", "T16", "T17"]
acs: ["AC-07", "AC-10", "AC-12", "AC-13", "AC-17"]
files_hint: ["apps/api/src/modules/workspaces/http/guard.ts", "apps/api/src/modules/workspaces/http/routes.ts", "apps/api/src/app.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T14 — Expose the workspace guard and the me / workspaces / enter routes

## Place in the sequence

- **Blocked by:** T11 — Implement workspace access: guard check, my workspaces, enter · T13 — Expose the auth routes with the session cookie and resolver · **Blocks:** T15 — Expose the invitation lookup and acceptance routes, T16 — Expose the owner-only team routes, T17 — Extract the shared dependency builder, serve the SPA from one origin, update the conventions docs · **Wave:** 6 — needs the session resolver of T13; creates `registerWorkspaces` the next routes plug into.
- **Lane:** shares `apps/api/src/app.ts` with T13 → T17 and `workspaces/http/routes.ts` with T15, T16 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to sign in to the web panel with my email and password and sign out when I am done
> **So that** only I can act in the workspaces I belong to
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to switch between the workspaces I am a member of
> **So that** I can work for several businesses with one account while seeing only one business's data at a time
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to deactivate a member who left and reactivate them if they return
> **So that** former staff lose access to our customers at once
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task exports the workspace-access guard every workspace-scoped route sits behind and exposes the routes that resolve and enter a workspace.

## Inlined context

> The guard is a Fastify `preHandler` exported by the workspaces module and handed to every workspace-scoped module through the composition root:
> - no session → the request is unauthenticated;
> - no membership of this account in this workspace, or a workspace id that does not exist or is malformed → `NotFoundError` (AC-13, indistinguishable from a missing workspace);
> - a deactivated membership → a refusal with its own error code, so the panel can say access to this workspace was removed and move on (AC-17);
> - an active membership → the request carries `{ workspaceId, role }`, which repositories receive as their `workspaceId`; owner-only routes add a role check that answers `ForbiddenError` (AC-15).
>
> The last-used workspace for the next sign-in (AC-07, AC-12) is recorded on the membership when the panel opens a workspace, not in the session.
>
> — `adr/0003-carry-the-active-workspace-in-the-url-and-check-membership-on-every-request.md §Decision outcome, verbatim` · full text: [ADR-0003](../adr/0003-carry-the-active-workspace-in-the-url-and-check-membership-on-every-request.md)

> **QG-1a** How verify: every route under `/api/workspaces/:workspaceId/…` gets an `app.inject()` test calling it with a session that belongs to the other workspace.
> **QG-1b** How verify: an integration test opens two sessions for the member, deactivates the membership and asserts the next request from each session is refused with the access-removed code while a request to the member's other workspace still succeeds.
>
> — `sad.md §10, QG-1a + QG-1b, abridged` · full text: [sad.md](../sad.md)

> **Hard rule:** Tenancy is enforced by convention: a later module that skips the workspace guard or a `workspace_id` filter leaks another business's data — Mitigation: Every workspace-scoped route sits under `/api/workspaces/:workspaceId/…` behind the guard of ADR-0003; isolation tests per repository and per route in CI.
>
> — `sad.md §11, risk row 1, abridged` · full text: [sad.md](../sad.md)

> **Module wiring:** each module exports `register<Module>(app, deps)` from `modules/<m>/http/routes.ts`; only `buildApp()` constructs deps and registers modules. No self-registration, no globals.
>
> — `CLAUDE.md §Rules, Module wiring, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `GET /api/me` (`getMe`) → `200 Me {account {id, email, display_name}, last_used_workspace_id: uuid|null}` · errors: `401 UNAUTHENTICATED`.
- `GET /api/me/workspaces` (`listMyWorkspaces`; query `after`, `before`, `limit` 1–100 default 20) → `200 WorkspaceSummaryPage {items [{id, name, role}], has_next, has_prev, next_cursor}` — active memberships only, ordered by workspace id · errors: `400`, `401`.
- `POST /api/workspaces/{workspaceId}/enter` (`enterWorkspace`) → `200 WorkspaceSummary` · errors: `401 UNAUTHENTICATED`, `403 ACCESS_REMOVED` («Your access to this workspace was removed»), `404 NOT_FOUND` («Not found» — never a member, unknown or malformed id, indistinguishable).
- `X-Background-Request: 1` honoured on `getMe` and `listMyWorkspaces`.

— `contracts/openapi.yaml, operationIds getMe / listMyWorkspaces / enterWorkspace + responses WorkspaceNotFound, AccessRemoved, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-07 — happy path

> **Given** an operator with an active account and at least one active membership
> **When** they sign in with the correct email and password
> **Then** the system opens the workspace they used last; when they have exactly one active membership it opens that one; when the last-used workspace is no longer available to them (or there is none yet) and they have several active memberships, it shows the list of those workspaces and lets them pick one
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — authorization

> **Given** an operator whose every membership has been deactivated
> **When** they sign in with the correct email and password
> **Then** the system tells them they no longer have access to any workspace and shows no workspace data
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — happy path

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently working in "Acme Flowers"
> **When** they switch to "Bolt Bikes"
> **Then** on that device the panel shows only "Bolt Bikes" data from then on, while their other signed-in devices stay in the workspace they were in; their next sign-in on any device opens "Bolt Bikes"
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — authorization

> **Given** an operator who has never been a member of the "Bolt Bikes" workspace (a deactivated former member is covered by AC-17)
> **When** they try to open anything belonging to "Bolt Bikes" (for example through a link a colleague shared)
> **Then** the system behaves as if it does not exist — no data, no hint that the workspace or the item exists
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — cross-context

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently signed in to "Acme Flowers"
> **When** a business owner of "Acme Flowers" deactivates their membership
> **Then** from at most 5 seconds after the deactivation, every action or data load the operator makes in "Acme Flowers" is refused; at the first such refusal the panel removes "Acme Flowers" data from the screen and tells them their access to "Acme Flowers" was removed, then moves them to another workspace where they are active (or to the no-access screen of AC-10 when there is none); their account and their access to "Bolt Bikes" stay intact
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `apps/api/src/modules/workspaces/http/guard.ts` — exported `workspaceGuard` `preHandler`: runs after the T13 session resolver, calls T11 `guardWorkspace(accountId, workspaceId)`, a malformed `workspaceId` → `NotFoundError`, attaches `request.workspace = { workspaceId, role }`; an `ownerOnly` helper that throws `OwnerOnlyError` for `role !== 'owner'` (used by T16).
- [ ] `apps/api/src/modules/workspaces/http/routes.ts` — `registerWorkspaces(app, deps)`: `GET /api/me`, `GET /api/me/workspaces`, `POST /api/workspaces/:workspaceId/enter` with the T3 schemas.
- [ ] `apps/api/src/app.ts` — construct workspaces deps and register `registerWorkspaces` under `/api`, passing the session resolver from `auth`.
- [ ] `apps/api/src/modules/workspaces/http/routes.int.test.ts` — AC-07 / AC-12 (enter sets last used, next `getMe` returns it), AC-10 (empty list), AC-13 (other-workspace session → 404 identical to unknown id and malformed id — QG-1a for `enter`), AC-17 / QG-1b (two sessions → `403 ACCESS_REMOVED` on next request, other workspace still `200`).

## Edge cases

| Case | Behaviour |
|---|---|
| `workspaceId` not a UUID | `404 NOT_FOUND`, same body as a foreign workspace |
| Workspace exists, caller never a member | `404 NOT_FOUND` — no hint it exists |
| Workspace awaiting its first owner (no members) | `404 NOT_FOUND` for everyone |
| Membership deactivated | `403 ACCESS_REMOVED`; other workspaces unaffected |
| Last-used workspace now deactivated | `getMe.last_used_workspace_id` is `null` |
| No session | `401 UNAUTHENTICATED` before the guard runs |

## Definition of Done

- [ ] `routes.int.test.ts` passes for AC-07, AC-10, AC-12, AC-13, AC-17 incl. the QG-1a and QG-1b scenarios
- [ ] The guard is exported for reuse and is the only way a `workspaceId` reaches a repository from HTTP
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
